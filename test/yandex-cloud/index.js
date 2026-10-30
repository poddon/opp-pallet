/**
 * API теста ОПП для Яндекс Облака: Cloud Functions (Node.js 22) + YDB serverless (Document API).
 * Без внешних зависимостей — код можно вставить прямо в редактор функции.
 *
 * Переменные окружения функции:
 *   DOCAPI_ENDPOINT        — «Document API эндпоинт» базы YDB (https://docapi.serverless.yandexcloud.net/ru-central1/…/…)
 *   AWS_ACCESS_KEY_ID      — идентификатор статического ключа сервисного аккаунта (роль ydb.editor)
 *   AWS_SECRET_ACCESS_KEY  — секретный ключ
 *   ADMINS                 — администраторы: «ФИО=пароль», через точку с запятой
 *   ALLOWED_ORIGINS        — необязательно, по умолчанию https://poddon.github.io
 *
 * Запросы (те же, что у сайта):
 *   GET  ?action=health
 *   POST ?action=results        GET ?action=results  (админ)
 *   POST ?action=live           GET ?action=live     (админ)
 *   GET/POST ?action=access     POST ?action=check   POST ?action=grant (админ)
 */
"use strict";
const crypto = require("crypto");

const T_RESULTS = process.env.TABLE_RESULTS || "opp_results";
const T_LIVE = process.env.TABLE_LIVE || "opp_live";
const REGION = "ru-central1";

/* ---------------- подпись AWS SigV4 ---------------- */
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s, "utf8").digest();

function signRequest({ method, url, headers, body, accessKey, secretKey, region, service, amzDate }) {
  const u = new URL(url);
  const date = amzDate.slice(0, 8);
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  h["host"] = u.host;
  h["x-amz-date"] = amzDate;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => n + ":" + h[n] + "\n").join("");
  const signedHeaders = names.join(";");
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => k + "=" + v).join("&");
  const canonical = [method, u.pathname || "/", query, canonicalHeaders, signedHeaders, sha256hex(body || "")].join("\n");
  const scope = [date, region, service, "aws4_request"].join("/");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretKey, date), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return {
    headers: h,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/* ---------------- клиент Document API ---------------- */
let iamToken = ""; // запасной вариант: токен сервисного аккаунта функции
async function ddb(op, payload) {
  const endpoint = process.env.DOCAPI_ENDPOINT;
  if (!endpoint) throw new Error("Не задана переменная DOCAPI_ENDPOINT");
  const body = JSON.stringify(payload);
  const base = { "content-type": "application/x-amz-json-1.0", "x-amz-target": "DynamoDB_20120810." + op };
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  let headers;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const s = signRequest({
      method: "POST", url: endpoint, headers: base, body, amzDate,
      accessKey: process.env.AWS_ACCESS_KEY_ID, secretKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: REGION, service: "dynamodb",
    });
    headers = { ...s.headers, authorization: s.authorization };
    delete headers.host;
  } else if (iamToken) {
    headers = { ...base, authorization: "Bearer " + iamToken };
  } else {
    throw new Error("Не заданы AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY");
  }
  const r = await fetch(endpoint, { method: "POST", headers, body });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!r.ok) {
    const type = String(data.__type || "").split("#").pop();
    const e = new Error(type + ": " + (data.message || data.Message || r.status));
    e.type = type; e.status = r.status;
    throw e;
  }
  return data;
}

/* типы DynamoDB <-> обычные значения */
function m(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === "boolean") return { BOOL: v };
  if (typeof v === "number") return { N: String(v) };
  return { S: String(v) };
}
const mItem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, m(v)]));
function u(a) {
  if (!a) return undefined;
  if ("S" in a) return a.S;
  if ("N" in a) return Number(a.N);
  if ("BOOL" in a) return a.BOOL;
  if ("NULL" in a) return null;
  return undefined;
}
const uItem = (it) => Object.fromEntries(Object.entries(it || {}).map(([k, v]) => [k, u(v)]));

/* таблицы создаются сами при первом обращении */
const ready = {};
async function ensureTable(name) {
  if (ready[name]) return;
  try {
    const d = await ddb("DescribeTable", { TableName: name });
    if (d.Table && d.Table.TableStatus && d.Table.TableStatus !== "ACTIVE") await waitActive(name);
  } catch (e) {
    if (e.type !== "ResourceNotFoundException") throw e;
    try {
      await ddb("CreateTable", {
        TableName: name,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      });
    } catch (e2) { if (e2.type !== "ResourceInUseException") throw e2; }
    await waitActive(name);
  }
  ready[name] = true;
}
async function waitActive(name) {
  for (let i = 0; i < 30; i++) {
    try {
      const d = await ddb("DescribeTable", { TableName: name });
      if (!d.Table || !d.Table.TableStatus || d.Table.TableStatus === "ACTIVE") return;
    } catch (e) { if (e.type !== "ResourceNotFoundException") throw e; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
async function call(table, op, payload) {
  await ensureTable(table);
  return ddb(op, { TableName: table, ...payload });
}
async function scanAll(table, max = 20000) {
  const out = [];
  let start;
  do {
    const d = await call(table, "Scan", start ? { ExclusiveStartKey: start } : {});
    for (const it of d.Items || []) out.push(uItem(it));
    start = d.LastEvaluatedKey;
  } while (start && out.length < max);
  return out;
}

/* ---------------- помощники ---------------- */
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").replace(/ё/g, "е").replace(/Ё/g, "Е").toLocaleLowerCase("ru");
const cut = (s, n) => String(s ?? "").trim().slice(0, n);
const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const nowMsk = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

function admins() {
  const map = {};
  for (const part of String(process.env.ADMINS || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map[norm(part.slice(0, i))] = part.slice(i + 1).trim();
  }
  return map;
}
function isAdmin(h) {
  let name = "";
  try { name = decodeURIComponent(h["x-admin-name"] || ""); } catch { return false; }
  const pass = String(h["x-admin-password"] || "");
  const expected = admins()[norm(name)];
  if (!name || !pass || !expected) return false;
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------------- обработчик ---------------- */
exports.handler = async function (event, context) {
  if (context && context.token && context.token.access_token) iamToken = context.token.access_token;
  const h = {};
  for (const [k, v] of Object.entries((event && event.headers) || {})) h[k.toLowerCase()] = v;
  const method = String((event && event.httpMethod) || "GET").toUpperCase();
  const q = (event && event.queryStringParameters) || {};
  const action = String(q.action || "");

  const origin = h["origin"] || "";
  const allowed = String(process.env.ALLOWED_ORIGINS || "https://poddon.github.io").split(",").map((s) => s.trim());
  const cors = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Name, X-Admin-Password",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) cors["Access-Control-Allow-Origin"] = origin;
  const out = (code, data) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
    body: JSON.stringify(data),
  });
  if (method === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  let b = {};
  if (method === "POST" && event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      b = JSON.parse(raw.slice(0, 65536)) || {};
    } catch { b = {}; }
  }

  try {
    if (action === "health") {
      await ensureTable(T_RESULTS); await ensureTable(T_LIVE);
      return out(200, { ok: true, db: "ydb", server: "yandex-cloud" });
    }

    if (action === "results" && method === "POST") {
      const name = cut(b.name, 160), group = cut(b.group, 80);
      if (!name || !group) return out(400, { ok: false, error: "fields" });
      const status = b.status === "СПИСЫВАНИЕ" ? "СПИСЫВАНИЕ" : "Пройден";
      const date = cut(b.date, 80) || nowMsk();
      const total = num(b.total, 0, 500), correct = Math.min(total, num(b.correct, 0, 500));
      const pct = num(b.pct, 0, 100), xp = num(b.xp, 0, 1e6), duration = num(b.duration, 0, 86400);
      const modules = cut(b.modules || "1", 30) || "1";
      // один результат приходит дважды (app.js и cloud-sync.js) — ключ по содержимому склеивает дубли
      const fp = crypto.createHash("sha256")
        .update([date, norm(name), norm(group), modules, status, correct, total, duration].join("|")).digest("hex");
      let duplicate = false;
      try {
        await call(T_RESULTS, "PutItem", {
          Item: mItem({
            id: "r#" + fp, kind: "r", date, name, group, modules, status, correct, total, pct, xp, duration,
            submission_id: isUuid(b.submission_id) ? b.submission_id.toLowerCase() : undefined,
            created: Date.now(),
          }),
          ConditionExpression: "attribute_not_exists(id)",
        });
      } catch (e) {
        if (e.type === "ConditionalCheckFailedException") duplicate = true; else throw e;
      }
      if (status === "Пройден" && !duplicate) {
        const n = norm(name);
        await call(T_RESULTS, "PutItem", { Item: mItem({ id: "d#" + n, kind: "d", name, updated: Date.now() }) });
        try {
          await call(T_RESULTS, "UpdateItem", {
            Key: { id: { S: "g#" + n } },
            UpdateExpression: "SET #f = #f - :one",
            ConditionExpression: "#f > :zero",
            ExpressionAttributeNames: { "#f": "free" },
            ExpressionAttributeValues: { ":one": { N: "1" }, ":zero": { N: "0" } },
          });
        } catch (e) { if (e.type !== "ConditionalCheckFailedException") throw e; }
      }
      return out(200, { ok: true, duplicate });
    }

    if (action === "results" && method === "GET") {
      if (!isAdmin(h)) return out(401, { ok: false, error: "Неверные данные администратора" });
      const rows = (await scanAll(T_RESULTS)).filter((r) => r.kind === "r")
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .map((r) => ({ date: r.date, name: r.name, group: r.group, modules: r.modules, status: r.status,
          correct: r.correct, total: r.total, pct: r.pct, xp: r.xp, duration: r.duration }));
      return out(200, { ok: true, rows });
    }

    if (action === "live" && method === "POST") {
      const name = cut(b.name, 160), group = cut(b.group, 80);
      if (!isUuid(b.session_id) || !name || !group) return out(400, { ok: false });
      await call(T_LIVE, "PutItem", {
        Item: mItem({
          id: b.session_id.toLowerCase(), name, group_code: group,
          question: num(b.question, 1, 500), total: num(b.total, 1, 500),
          seconds_left: num(b.seconds_left, 0, 600), status: cut(b.status || "Проходит", 30), updated: Date.now(),
        }),
      });
      return out(200, { ok: true });
    }

    if (action === "live" && method === "GET") {
      if (!isAdmin(h)) return out(401, { ok: false, error: "Неверные данные администратора" });
      const all = await scanAll(T_LIVE, 5000);
      const now = Date.now();
      const old = all.filter((r) => now - (r.updated || 0) > 24 * 3600e3).slice(0, 25);
      for (const r of old) await call(T_LIVE, "DeleteItem", { Key: { id: { S: r.id } } }).catch(() => {});
      const rows = all.filter((r) => now - (r.updated || 0) < 25000)
        .sort((a, b) => b.updated - a.updated)
        .map((r) => ({ name: r.name, group_code: r.group_code, question: r.question, total: r.total,
          seconds_left: r.seconds_left, status: r.status, updated_at: new Date(r.updated).toISOString() }));
      return out(200, { ok: true, rows });
    }

    if (action === "access" && method === "GET") {
      const d = await call(T_RESULTS, "GetItem", { Key: { id: { S: "a#1" } } });
      const it = uItem(d.Item);
      return out(200, { ok: true, access: { "1": it.open === undefined ? true : !!it.open } });
    }

    if (action === "access" && method === "POST") {
      if (!isAdmin(h)) return out(401, { ok: false, error: "Неверные данные администратора" });
      const id = cut(b.id || "1", 30) || "1", open = !!b.open;
      await call(T_RESULTS, "PutItem", { Item: mItem({ id: "a#" + id, kind: "a", open }) });
      return out(200, { ok: true, id, open });
    }

    if (action === "check" && method === "POST") {
      const n = norm(b.name);
      const [d, g] = await Promise.all([
        call(T_RESULTS, "GetItem", { Key: { id: { S: "d#" + n } } }),
        call(T_RESULTS, "GetItem", { Key: { id: { S: "g#" + n } } }),
      ]);
      const done = !!d.Item, free = Math.max(0, Number(uItem(g.Item).free) || 0);
      return out(200, { ok: true, allowed: !done || free > 0, done, grant: free });
    }

    if (action === "grant" && method === "POST") {
      if (!isAdmin(h)) return out(401, { ok: false, error: "Неверные данные администратора" });
      const name = cut(b.name, 160);
      if (!name) return out(400, { ok: false, error: "fields" });
      await call(T_RESULTS, "UpdateItem", {
        Key: { id: { S: "g#" + norm(name) } },
        UpdateExpression: "SET #k = :k, #n = :n, #b = :by ADD #f :one",
        ExpressionAttributeNames: { "#k": "kind", "#n": "name", "#b": "granted_by", "#f": "free" },
        ExpressionAttributeValues: { ":k": { S: "g" }, ":n": { S: name }, ":by": { S: cut(b.by, 160) }, ":one": { N: "1" } },
      });
      return out(200, { ok: true });
    }

    return out(400, { ok: false, error: "unknown_action" });
  } catch (e) {
    console.error("OPP API:", e && e.message);
    return out(500, { ok: false, error: "server", hint: String((e && e.message) || "").slice(0, 200) });
  }
};

exports._signRequest = signRequest; // для теста подписи
