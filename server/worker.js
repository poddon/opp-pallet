export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "https://poddon.github.io");
    const cors = {
      "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin", "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };
    const reply = (obj, status=200) => new Response(JSON.stringify(obj), {status, headers:cors});
    if (request.method === "OPTIONS") return new Response(null, {headers:cors});
    if (origin && origin !== allowed) return reply({ok:false,error:"origin"},403);
    const action = new URL(request.url).searchParams.get("action");
    const isAdmin = !!env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY;
    const body = request.method === "POST" ? await request.json().catch(()=>null) : null;
    const clean = s => String(s||"").trim().replace(/\\s+/g," ");
    if (action === "results" && request.method === "POST") {
      if (!body || !clean(body.name) || !clean(body.group)) return reply({ok:false,error:"invalid"},400);
      const name=clean(body.name), group=clean(body.group), status=clean(body.status);
      if (!["Пройден","СПИСЫВАНИЕ"].includes(status)) return reply({ok:false,error:"status"},400);
      const row = {date:clean(body.date).slice(0,64),name:name.slice(0,150),group:group.slice(0,100),
        modules:clean(body.modules).slice(0,15),status,
        correct:Math.max(0,Number(body.correct)||0),total:Math.max(0,Number(body.total)||0),
        pct:Math.max(0,Math.min(100,Number(body.pct)||0)),xp:Math.max(0,Number(body.xp)||0),
        duration:Math.max(0,Number(body.duration)||0)};
      const normalized=name.toLocaleLowerCase("ru-RU");
      const counted=await env.DB.prepare("SELECT COUNT(*) AS n FROM results WHERE name_norm=? AND status='Пройден'").bind(normalized).first();
      const granted=await env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE name_norm=?").bind(normalized).first();
      if (status === "Пройден" && Number(counted.n) >= 1+Number(granted.n)) return reply({ok:false,error:"already_completed"},409);
      await env.DB.prepare("INSERT INTO results (date,name,name_norm,group_code,modules,status,correct,total,pct,xp,duration) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(row.date,row.name,normalized,row.group,row.modules,row.status,row.correct,row.total,row.pct,row.xp,row.duration).run();
      return reply({ok:true});
    }
    if (action === "check" && request.method === "POST") {
      const n=clean(body?.name).toLocaleLowerCase("ru-RU");
      const counted=await env.DB.prepare("SELECT COUNT(*) AS n FROM results WHERE name_norm=? AND status='Пройден'").bind(n).first();
      const granted=await env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE name_norm=?").bind(n).first();
      return reply({ok:true,allowed:Number(counted.n)<1+Number(granted.n)});
    }
    if (!isAdmin) return reply({ok:false,error:"admin_auth_required"},401);
    if (action === "results" && request.method === "GET") {
      const result=await env.DB.prepare("SELECT date,name,group_code AS 'group',modules,status,correct,total,pct,xp,duration FROM results ORDER BY id DESC LIMIT 5000").all();
      return reply({ok:true,rows:result.results});
    }
    if (action === "grant" && request.method === "POST") {
      const n=clean(body?.name).toLocaleLowerCase("ru-RU");
      if (!n) return reply({ok:false},400);
      await env.DB.prepare("INSERT INTO grants (name_norm) VALUES (?)").bind(n).run();
      return reply({ok:true});
    }
    return reply({ok:false,error:"unknown_action"},404);
  }
};
