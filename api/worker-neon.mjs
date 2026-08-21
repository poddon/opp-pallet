/**
 * Cloudflare Worker + Neon serverless (HTTP)
 * Secrets: DATABASE_URL, ADMIN_TOKEN
 */
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    if (path !== "/results" && path !== "/") return json({ ok: false, error: "not_found" }, 404);
    if (!env.DATABASE_URL) return json({ ok: false, error: "DATABASE_URL not set" }, 500);

    const sql = neon(env.DATABASE_URL);

    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      const date = String(body.date || "").slice(0, 80);
      const name = String(body.name || "").slice(0, 120);
      const group = String(body.group || "").slice(0, 40);
      const modules = String(body.modules || "1").slice(0, 8);
      const status = body.status === "СПИСЫВАНИЕ" ? "СПИСЫВАНИЕ" : "Пройден";
      const correct = Number(body.correct) || 0;
      const total = Number(body.total) || 0;
      const pct = Number(body.pct) || 0;
      const xp = Number(body.xp) || 0;
      const duration = Number(body.duration) || 0;
      if (!name || !group) return json({ ok: false, error: "name_group_required" }, 400);
      try {
        await sql`INSERT INTO quiz_results (taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec)
          VALUES (${date}, ${name}, ${group}, ${modules}, ${status}, ${correct}, ${total}, ${pct}, ${xp}, ${duration})`;
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: String(e.message || e) }, 500);
      }
    }

    if (request.method === "GET") {
      const token = request.headers.get("X-Admin-Token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ ok: false, error: "forbidden" }, 403);
      try {
        const rows = await sql`
          SELECT taken_at AS date, student_name AS name, group_code AS "group",
                 module_id AS modules, status, correct, total, pct, xp,
                 duration_sec AS duration
          FROM quiz_results ORDER BY id DESC LIMIT 500`;
        return json({ ok: true, rows });
      } catch (e) {
        return json({ ok: false, error: String(e.message || e) }, 500);
      }
    }
    return json({ ok: false, error: "method" }, 405);
  },
};
