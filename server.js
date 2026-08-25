/**
 * Локальный сервер ОПП: отдаёт сайт и пишет результаты в PostgreSQL на этом ноутбуке.
 * Запуск: npm install  →  npm start
 * Сайт: http://127.0.0.1:8787
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { Pool } = require("pg");

const ROOT = __dirname;
const PORT = Number(process.env.OPP_PORT || 8787);
const cfgPath = path.join(ROOT, "db-config.json");
if (!fs.existsSync(cfgPath)) {
  console.error("Нет db-config.json. Скопируйте db-config.example.json и впишите пароль PostgreSQL.");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const pool = new Pool({
  host: cfg.host || "127.0.0.1",
  port: Number(cfg.port || 5432),
  database: cfg.database || "opp",
  user: cfg.user || "postgres",
  password: String(cfg.password || ""),
});

function normName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_results (
    id SERIAL PRIMARY KEY,
    taken_at TEXT NOT NULL,
    student_name TEXT NOT NULL,
    group_code TEXT NOT NULL,
    module_id TEXT NOT NULL DEFAULT '1',
    status TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    pct INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS module_access (
    module_id TEXT PRIMARY KEY,
    is_open BOOLEAN NOT NULL DEFAULT TRUE
  )`);
  await pool.query(`INSERT INTO module_access (module_id, is_open) VALUES ('1', TRUE) ON CONFLICT (module_id) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fio_done (
    name_norm TEXT PRIMARY KEY,
    name_display TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fio_grants (
    id SERIAL PRIMARY KEY,
    name_norm TEXT NOT NULL,
    name_display TEXT,
    granted_by TEXT,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

function send(res, code, data, type) {
  const body = type ? data : JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": (type || "application/json; charset=utf-8"),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function handleApi(req, res, action) {
  if (action === "health") {
    await pool.query("SELECT 1");
    return send(res, 200, { ok: true, db: "postgresql" });
  }
  if (action === "results" && req.method === "GET") {
    const r = await pool.query(
      `SELECT taken_at AS date, student_name AS name, group_code AS "group",
              module_id AS modules, status, correct, total, pct, xp,
              duration_sec AS duration
         FROM quiz_results WHERE status <> $1 ORDER BY id DESC LIMIT 2000`,
      ["СПИСЫВАНИЕ"]
    );
    return send(res, 200, { ok: true, rows: r.rows });
  }
  if (action === "results" && req.method === "POST") {
    const b = await readBody(req);
    if (b.status === "СПИСЫВАНИЕ") return send(res, 200, { ok: true, skipped: "cheat" });
    const name = String(b.name || "").trim();
    const group = String(b.group || "").trim();
    if (!name || !group) return send(res, 400, { ok: false, error: "fields" });
    await pool.query(
      `INSERT INTO quiz_results
        (taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        String(b.date || new Date().toLocaleString("ru-RU")),
        name, group, String(b.modules || "1"),
        String(b.status || "Пройден"),
        Number(b.correct || 0), Number(b.total || 0), Number(b.pct || 0),
        Number(b.xp || 0), Number(b.duration || 0),
      ]
    );
    console.log("Запись в quiz_results:", name, group, b.pct);
    if ((b.status || "Пройден") === "Пройден") {
      const n = normName(name);
      await pool.query(
        `INSERT INTO fio_done (name_norm, name_display, updated_at)
         VALUES ($1,$2,now())
         ON CONFLICT (name_norm) DO UPDATE SET updated_at = now(), name_display = EXCLUDED.name_display`,
        [n, name]
      );
      await pool.query(
        `UPDATE fio_grants SET used = TRUE WHERE id = (
           SELECT id FROM fio_grants WHERE name_norm = $1 AND used = FALSE ORDER BY id LIMIT 1)`,
        [n]
      );
    }
    return send(res, 200, { ok: true });
  }
  if (action === "access" && req.method === "GET") {
    const r = await pool.query("SELECT module_id, is_open FROM module_access");
    const access = { "1": true };
    r.rows.forEach((row) => { access[String(row.module_id)] = !!row.is_open; });
    return send(res, 200, { ok: true, access });
  }
  if (action === "access" && req.method === "POST") {
    const b = await readBody(req);
    const id = String(b.id || "1");
    const open = !!b.open;
    await pool.query(
      `INSERT INTO module_access (module_id, is_open) VALUES ($1,$2)
       ON CONFLICT (module_id) DO UPDATE SET is_open = EXCLUDED.is_open`,
      [id, open]
    );
    return send(res, 200, { ok: true, id, open });
  }
  if (action === "check" && req.method === "POST") {
    const b = await readBody(req);
    const n = normName(b.name);
    const done = await pool.query("SELECT 1 FROM fio_done WHERE name_norm = $1", [n]);
    const g = await pool.query(
      "SELECT COUNT(*)::int AS n FROM fio_grants WHERE name_norm = $1 AND used = FALSE",
      [n]
    );
    const isDone = done.rowCount > 0;
    const free = g.rows[0].n;
    return send(res, 200, { ok: true, allowed: !isDone || free > 0, done: isDone, grant: free });
  }
  if (action === "grant" && req.method === "POST") {
    const b = await readBody(req);
    const name = String(b.name || "").trim();
    if (!name) return send(res, 400, { ok: false, error: "fields" });
    await pool.query(
      "INSERT INTO fio_grants (name_norm, name_display, granted_by) VALUES ($1,$2,$3)",
      [normName(name), name, String(b.by || "").trim()]
    );
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { ok: false, error: "unknown_action" });
}

function safeFile(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/") p = "/index.html";
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/api.php" || u.pathname === "/api") {
      return await handleApi(req, res, u.searchParams.get("action") || "");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { ok: false, error: "method" });
    }
    const file = safeFile(u.pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 404, { ok: false, error: "not_found" });
    }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: "server", hint: e.message });
  }
});

ensureSchema()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log("ОПП: http://127.0.0.1:" + PORT);
      console.log("Проверка базы: http://127.0.0.1:" + PORT + "/api.php?action=health");
    });
  })
  .catch((e) => {
    console.error("PostgreSQL не открылся. Проверьте, что служба запущена и пароль в db-config.json верный.");
    console.error(e.message);
    process.exit(1);
  });
