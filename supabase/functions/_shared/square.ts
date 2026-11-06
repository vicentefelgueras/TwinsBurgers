// Utilidades compartidas para Square (Twins Burgers)
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const ENV = (Deno.env.get("SQUARE_ENV") ?? "sandbox").trim().toLowerCase() === "production" ? "production" : "sandbox";
export const BASE = ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
export const VERSION = "2024-12-18";
export const SITE_URL = "https://vicentefelgueras.github.io/TwinsBurgers/";
export const PANEL_URL = SITE_URL + "panel.html";
export const PROJECT_URL = "https://qpwjbdqxheceoavusjca.supabase.co";
export const WEBHOOK_URL = PROJECT_URL + "/functions/v1/square-webhook";
export const SCOPES = ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "PAYMENTS_WRITE", "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS", "ORDERS_READ", "ORDERS_WRITE"];

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const adminClient = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

export async function sq(path: string, token: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Square-Version": VERSION, "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Square " + r.status + ": " + JSON.stringify(j.errors ?? j).slice(0, 600));
  return j;
}

export async function obtainToken(body: Record<string, unknown>) {
  const r = await fetch(BASE + "/oauth2/token", {
    method: "POST",
    headers: { "Square-Version": VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: Deno.env.get("SQUARE_APP_ID"), client_secret: Deno.env.get("SQUARE_APP_SECRET"), ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("OAuth " + r.status + ": " + JSON.stringify(j).slice(0, 600));
  return j;
}

// Token del dueño cargado como secreto en Supabase (SQUARE_ACCESS_TOKEN). Si no existe, se usa el de OAuth.
export const ENV_TOKEN = (Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "").trim();

// El de OAuth (si se usara) se renueva cuando vence en menos de 7 días.
export async function sellerAuth(db: SupabaseClient) {
  const { data: a, error } = await db.from("square_auth").select("*").eq("id", 1).maybeSingle();
  if (error || !a) throw new Error("Square no está conectado");
  if (ENV_TOKEN) {
    if (a.env !== ENV) throw new Error("Square se verificó en otro modo (" + a.env + "); verifícalo de nuevo");
    return { ...a, access_token: ENV_TOKEN };
  }
  if (a.env !== ENV) throw new Error("Square está conectado en otro modo (" + a.env + "); vuelve a conectarlo");
  if (a.refresh_token && a.expires_at && Date.parse(a.expires_at) - Date.now() < 7 * 864e5) {
    const t = await obtainToken({ grant_type: "refresh_token", refresh_token: a.refresh_token });
    await db.from("square_auth").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? a.refresh_token, expires_at: t.expires_at }).eq("id", 1);
    a.access_token = t.access_token;
  }
  return a;
}

// Teléfono australiano a formato internacional (+61...). Si no se reconoce, no se envía.
export function auPhone(p: string): string | null {
  const d = (p ?? "").replace(/[^\d+]/g, "");
  if (/^\+61\d{9}$/.test(d)) return d;
  if (/^61\d{9}$/.test(d)) return "+" + d;
  if (/^0\d{9}$/.test(d)) return "+61" + d.slice(1);
  return null;
}
