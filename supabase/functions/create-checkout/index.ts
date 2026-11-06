// Crea el link de pago de Square para un pedido pendiente. El dinero va completo a la cuenta del dueño.
import { adminClient, auPhone, cors, json, sellerAuth, SITE_URL, sq } from "../_shared/square.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { order_id } = await req.json().catch(() => ({} as any));
  if (!/^[0-9a-f-]{36}$/.test(order_id ?? "")) return json({ error: "Invalid order." }, 400);
  const db = adminClient();
  const { data: o } = await db.from("orders").select("*,order_items(*)").eq("id", order_id).maybeSingle();
  if (!o) return json({ error: "Order not found." }, 404);
  if (o.pay_status === "pagado") return json({ paid: true });
  if (o.status !== "pago_pendiente") return json({ error: "This order can't be paid online." }, 409);
  if (Date.now() - Date.parse(o.created_at) > 60 * 60e3) return json({ error: "This order expired. Please place it again." }, 410);
  if (o.checkout_url) return json({ url: o.checkout_url });
  try {
    const a = await sellerAuth(db);
    const items = (o.order_items ?? []).slice().sort((x: any, y: any) => x.id - y.id);
    const body: Record<string, unknown> = {
      idempotency_key: o.id,
      description: "Twins Burgers #" + o.num,
      order: {
        location_id: a.location_id,
        reference_id: String(o.num),
        line_items: items.map((i: any) => ({
          name: i.name + (i.options?.length ? " (" + i.options.join(", ") + ")" : ""),
          quantity: String(i.qty),
          base_price_money: { amount: i.unit_cents, currency: "AUD" },
        })),
      },
      checkout_options: {
        redirect_url: SITE_URL + "?order=" + o.id,
        ask_for_shipping_address: false,
        allow_tipping: false,
      },
      payment_note: "Twins Burgers pedido #" + o.num,
    };
    const ph = auPhone(o.customer_phone);
    if (ph) body.pre_populated_data = { buyer_phone_number: ph };
    const r = await sq("/v2/online-checkout/payment-links", a.access_token, body);
    const link = r.payment_link;
    await db.from("orders").update({ square_order_id: link.order_id, checkout_url: link.url }).eq("id", o.id);
    return json({ url: link.url });
  } catch (e) {
    console.error("create-checkout", e);
    return json({ error: "Online payment is not available right now. Please try again in a moment." }, 502);
  }
});
