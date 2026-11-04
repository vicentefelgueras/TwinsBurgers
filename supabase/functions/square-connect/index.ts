// Genera el link para que el dueño conecte su cuenta Square. Solo administradores.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, BASE, cors, ENV, json, SCOPES } from "../_shared/square.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: isAdmin } = await user.rpc("is_admin");
  if (isAdmin !== true) return json({ error: "Solo un administrador puede conectar Square." }, 403);
  const appId = Deno.env.get("SQUARE_APP_ID");
  if (!appId || !Deno.env.get("SQUARE_APP_SECRET")) return json({ error: "Faltan las claves de la app de Square en Supabase." }, 500);
  const db = adminClient();
  await db.from("square_oauth_state").delete().lt("created_at", new Date(Date.now() - 3 * 864e5).toISOString());
  const state = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const { error } = await db.from("square_oauth_state").insert({ state });
  if (error) return json({ error: "No se pudo preparar el link." }, 500);
  const url = BASE + "/oauth2/authorize?" + new URLSearchParams({ client_id: appId, scope: SCOPES.join(" "), session: "false", state });
  return json({ url, env: ENV });
});
