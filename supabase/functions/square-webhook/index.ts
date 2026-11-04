// Square avisa aquí cuando cambia un pago. Si se completó, el pedido entra al panel como nuevo.
import { adminClient, WEBHOOK_URL } from "../_shared/square.ts";

async function validSignature(raw: string, sig: string, key: string) {
  if (!sig || !key) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(WEBHOOK_URL + raw)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const ok = await validSignature(raw, req.headers.get("x-square-hmacsha256-signature") ?? "", Deno.env.get("SQUARE_WEBHOOK_KEY") ?? "");
  if (!ok) return new Response("invalid signature", { status: 403 });
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const p = ev?.data?.object?.payment;
  if (!p?.order_id) return new Response("ignored");
  const db = adminClient();
  const { data: o } = await db.from("orders").select("id,status,pay_status,total_cents").eq("square_order_id", p.order_id).maybeSingle();
  if (!o) return new Response("unknown order");
  if (p.status === "COMPLETED" && o.pay_status !== "pagado") {
    const paid = Number(p.total_money?.amount ?? p.amount_money?.amount ?? 0);
    if (paid < o.total_cents) {
      console.error("square-webhook: monto menor al pedido", o.id, paid, o.total_cents);
      return new Response("amount mismatch");
    }
    await db.from("orders").update({
      pay_status: "pagado", pay_method: "Square online", square_payment_id: p.id,
      status: o.status === "pago_pendiente" ? "nuevo" : o.status,
    }).eq("id", o.id);
  } else if ((p.status === "FAILED" || p.status === "CANCELED") && o.pay_status === "pendiente") {
    await db.from("orders").update({ pay_status: "fallido" }).eq("id", o.id);
  }
  return new Response("ok");
});
