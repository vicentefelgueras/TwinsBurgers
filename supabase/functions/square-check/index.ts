// Verifica el token de Square del dueño (secreto SQUARE_ACCESS_TOKEN) y guarda su local. Solo administradores.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, cors, ENV, ENV_TOKEN, json, sq } from "../_shared/square.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: isAdmin } = await user.rpc("is_admin");
  if (isAdmin !== true) return json({ error: "Only an admin can verify Square." }, 403);
  if (!ENV_TOKEN) return json({ error: "The owner's Square token is missing in Supabase." }, 400);
  if (!Deno.env.get("SQUARE_WEBHOOK_KEY")) return json({ error: "The Square webhook key is missing in Supabase." }, 400);
  try {
    const locs = await sq("/v2/locations", ENV_TOKEN);
    const list = locs.locations ?? [];
    const loc = list.find((l: any) => l.status === "ACTIVE" && l.currency === "AUD") ?? list.find((l: any) => l.status === "ACTIVE");
    if (!loc) return json({ error: "The Square account has no active location." }, 400);
    const { error } = await adminClient().from("square_auth").upsert({
      id: 1, env: ENV, merchant_id: loc.merchant_id ?? "", access_token: "(secreto en Supabase)", refresh_token: null,
      expires_at: null, location_id: loc.id, location_name: loc.name ?? "", connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true, env: ENV, location_name: loc.name ?? "", currency: loc.currency ?? "" });
  } catch (e) {
    console.error("square-check", e);
    const msg = String(e).includes("401") ? "The Square token is invalid or from another mode (sandbox/production)." : "Couldn't verify Square. Check the token.";
    return json({ error: msg }, 400);
  }
});
