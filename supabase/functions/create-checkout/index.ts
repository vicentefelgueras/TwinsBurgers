// Crea el link de pago de Square para un pedido pendiente. El dinero va completo a la cuenta del dueño.
import { adminClient, auPhone, BASE, cors, json, sellerAuth, SITE_URL, sq, VERSION } from "../_shared/square.ts";

// Hamburguesas del catálogo de Square del dueño (categoría Food) y su precio en Square, en centavos.
const BURGERS: Record<string, { id: string; price: number }> = {
  t1: { id: "J3F3QFERJ3CVH4OPGM4X7KMI", price: 1900 }, // Twin I
  t2: { id: "2MQJUPUW5JVPKXSFUWGOOU4X", price: 2000 }, // Twin II
  ok: { id: "PZFA7U32LPSR3HYJMAZQR2CB", price: 1900 }, // Oklahoma
};

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
    // Cargo online: lo que falta entre la suma de productos y el total del pedido (hoy 0: el 3% lo asume el dueño).
    const fee = Math.max(0, o.total_cents - items.reduce((s: number, i: any) => s + i.unit_cents * i.qty, 0));
    const ph = auPhone(o.customer_phone);
    const pickup = [{
      type: "PICKUP",
      state: "PROPOSED",
      pickup_details: {
        recipient: { display_name: String(o.customer_name || "Customer").slice(0, 60), ...(ph ? { phone_number: ph } : {}) },
        schedule_type: "ASAP",
        prep_time_duration: "PT15M",
        ...(o.notes ? { note: String(o.notes).slice(0, 500) } : {}),
      },
    }];
    const adhoc = (i: any) => ({
      name: i.name + (i.options?.length ? " (" + i.options.join(", ") + ")" : ""),
      quantity: String(i.qty),
      base_price_money: { amount: i.unit_cents, currency: "AUD" },
    });
    // Hamburguesas como productos reales del catálogo de Square (categoría Food) para que el perfil de cocina
    // imprima solo eso. Los extras van en la nota (cocina los ve) y su costo en una línea aparte sin categoría.
    const lines = (catalog: boolean) => {
      const out: any[] = [];
      for (const i of items) {
        const c = catalog ? BURGERS[i.item_id] : undefined;
        if (c && i.unit_cents >= c.price) {
          out.push({ catalog_object_id: c.id, quantity: String(i.qty), ...(i.options?.length ? { note: i.options.join(", ") } : {}) });
          if (i.unit_cents > c.price) out.push({ name: i.name + " extras (" + (i.options ?? []).join(", ") + ")", quantity: String(i.qty), base_price_money: { amount: i.unit_cents - c.price, currency: "AUD" } });
        } else out.push(adhoc(i));
      }
      if (fee > 0) out.push({ name: "Online service fee (3%)", quantity: "1", base_price_money: { amount: fee, currency: "AUD" } });
      return out;
    };
    const mk = (catalog: boolean, withPickup: boolean, key: string) => ({
      idempotency_key: key,
      description: "Twins Burgers #" + o.num,
      order: {
        location_id: a.location_id,
        reference_id: String(o.num),
        line_items: lines(catalog),
        ...(withPickup ? { fulfillments: pickup } : {}),
      },
      checkout_options: {
        redirect_url: SITE_URL + "?order=" + o.id,
        ask_for_shipping_address: false,
        allow_tipping: false,
      },
      payment_note: "Twins Burgers order #" + o.num,
      ...(ph ? { pre_populated_data: { buyer_phone_number: ph } } : {}),
    });
    const hasBurger = items.some((i: any) => BURGERS[i.item_id]);
    let r: any = null;
    if (hasBurger) {
      // Intento con catálogo. Solo se usa si Square cobra exactamente el total del pedido; si no, se borra y se sigue como antes.
      try {
        r = await sq("/v2/online-checkout/payment-links", a.access_token, mk(true, true, o.id + "-c"));
        const so = await sq("/v2/orders/" + r.payment_link.order_id, a.access_token);
        if (so.order?.total_money?.amount !== o.total_cents) {
          console.error("create-checkout: total con catálogo no coincide", so.order?.total_money?.amount, o.total_cents);
          await fetch(BASE + "/v2/online-checkout/payment-links/" + r.payment_link.id, { method: "DELETE", headers: { "Square-Version": VERSION, Authorization: "Bearer " + a.access_token } }).catch(() => {});
          r = null;
        }
      } catch (e) {
        console.error("create-checkout: catálogo falló, sigo sin catálogo", e);
        r = null;
      }
    }
    if (!r) {
      try {
        r = await sq("/v2/online-checkout/payment-links", a.access_token, mk(false, true, o.id));
      } catch (e) {
        // Si Square rechaza el retiro, el cobro no se puede caer: se reintenta sin él.
        console.error("create-checkout: con retiro falló, reintento sin retiro", e);
        r = await sq("/v2/online-checkout/payment-links", a.access_token, mk(false, false, o.id + "-nf"));
      }
    }
    const link = r.payment_link;
    await db.from("orders").update({ square_order_id: link.order_id, checkout_url: link.url }).eq("id", o.id);
    return json({ url: link.url });
  } catch (e) {
    console.error("create-checkout", e);
    return json({ error: "Online payment is not available right now. Please try again in a moment." }, 502);
  }
});
