// Square vuelve aquí después de que el dueño autoriza la app. Guarda el token y el local.
import { adminClient, ENV, obtainToken, PANEL_URL, sq } from "../_shared/square.ts";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const back = (q: string) => Response.redirect(PANEL_URL + "?square=" + q, 302);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state) return back("cancelado");
  const db = adminClient();
  const { data: st } = await db.from("square_oauth_state").delete().eq("state", state).select().maybeSingle();
  if (!st || Date.now() - Date.parse(st.created_at) > 3 * 864e5) return back("expirado");
  try {
    const t = await obtainToken({ grant_type: "authorization_code", code });
    const locs = await sq("/v2/locations", t.access_token);
    const list = locs.locations ?? [];
    const loc = list.find((l: any) => l.status === "ACTIVE" && l.currency === "AUD") ?? list.find((l: any) => l.status === "ACTIVE");
    if (!loc) return back("sin_local");
    const { error } = await db.from("square_auth").upsert({
      id: 1, env: ENV, merchant_id: t.merchant_id, access_token: t.access_token, refresh_token: t.refresh_token ?? null,
      expires_at: t.expires_at ?? null, location_id: loc.id, location_name: loc.name ?? "", connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    return back("ok");
  } catch (e) {
    console.error("square-oauth", e);
    return back("error");
  }
});
