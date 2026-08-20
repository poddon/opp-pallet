(function () {
  const ADMIN = "лукьянчиков егор игоревич";
  const PASS = "Qwerty123*";
  const TMAX = 55;
  const KEY = "opp_results_v2";

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ["boot", "start", "quiz", "result", "admin"].forEach((n) => {
      const el = $(n);
      if (!el) return;
      el.classList.toggle("hidden", n !== id);
    });
    $("cheat").classList.add("hidden");
  }
  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  function prepare(id) {
    const src = (typeof QUESTIONS !== "undefined" ? QUESTIONS : [])
      .filter((q) => String(q.module) === String(id));
    return shuffle(src).map((q) => {
      const opts = q.options || q.a;
      const right = (q.correct != null) ? q.correct : q.i;
      const order = shuffle(opts.map((_, i) => i));
      return { q: q.text || q.q, a: order.map((i) => opts[i]), correct: order.indexOf(right) };
    });
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  }
  function save(rows) { localStorage.setItem(KEY, JSON.stringify(rows)); }

  let ac;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function tone(f, d, type, g, at) {
    const c = audio();
    const o = c.createOscillator();
    const v = c.createGain();
    o.type = type; o.frequency.value = f;
    v.gain.setValueAtTime(0.0001, c.currentTime + at);
    v.gain.exponentialRampToValueAtTime(g, c.currentTime + at + 0.02);
    v.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + d);
    o.connect(v); v.connect(c.destination);
    o.start(c.currentTime + at); o.stop(c.currentTime + at + d + 0.02);
  }
  function sfxOk() { tone(523, 0.09, "sine", 0.08, 0); tone(784, 0.12, "sine", 0.07, 0.07); }
  function sfxBad() { tone(180, 0.22, "sawtooth", 0.06, 0); }
  function siren() {
    const c = audio();
    const o = c.createOscillator();
    const v = c.createGain();
    o.type = "sawtooth"; v.gain.value = 0.22;
    o.connect(v); v.connect(c.destination);
    let t = c.currentTime, hi = true;
    while (t < c.currentTime + 7) { o.frequency.setValueAtTime(hi ? 880 : 620, t); t += 0.32; hi = !hi; }
    o.start(); o.stop(c.currentTime + 7);
  }
  function speak() {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const say = (delay) => setTimeout(() => {
      const u = new SpeechSynthesisUtterance("Вы списали. Обратитесь к преподавателю.");
      u.lang = "ru-RU"; u.volume = 1; u.rate = 0.92;
      speechSynthesis.speak(u);
    }, delay);
    say(400); say(3200);
  }

  /* ---- factory ---- */
  const factory = { cue: "idle", cueUntil: 0 };
  function startFactory() {
    const canvas = $("fx");
    const ctx = canvas.getContext("2d", { alpha: false });
    let w = 0, h = 0, t0 = performance.now();
    let boards = 3, held = false, outgoing = 0;
    const sparks = [];
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth || innerWidth;
      h = canvas.clientHeight || innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener("resize", resize);
    function rr(x, y, bw, bh, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, r);
      ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + bw, y, r);
      ctx.closePath();
    }
    function capsule(x1, y1, x2, y2, r, fill) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len, px = -ny, py = nx;
      ctx.beginPath();
      ctx.moveTo(x1 + px * r, y1 + py * r);
      ctx.arc(x1, y1, r, Math.atan2(py, px), Math.atan2(-py, -px));
      ctx.lineTo(x2 - px * r, y2 - py * r);
      ctx.arc(x2, y2, r, Math.atan2(-py, -px), Math.atan2(py, px));
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    }
    function metal(x1, y1, x2, y2) {
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, "#fff"); g.addColorStop(0.4, "#F2F6FB"); g.addColorStop(1, "#8FA0B8");
      return g;
    }
    function joint(x, y, r) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
      g.addColorStop(0, "#fff"); g.addColorStop(1, "#7E90A8");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1E6FD4"; ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, Math.PI * 2); ctx.fill();
    }
    function board(x, y, s) {
      ctx.save(); ctx.translate(x, y);
      const g = ctx.createLinearGradient(-48 * s, 0, 48 * s, 0);
      g.addColorStop(0, "#F3C984"); g.addColorStop(1, "#C4893A");
      ctx.fillStyle = g; rr(-48 * s, -6 * s, 96 * s, 11 * s, 2); ctx.fill();
      ctx.restore();
    }
    function pallet(px, py, layers, s) {
      const bw = 110 * s, bh = 12 * s;
      ctx.save(); ctx.translate(px, py);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.beginPath(); ctx.ellipse(0, 8, bw * 0.48, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6B3E18";
      [-0.36, 0, 0.36].forEach((k) => ctx.fillRect(k * bw - 6 * s, 0, 12 * s, bh));
      for (let i = 0; i < layers; i++) {
        const y = -i * (bh + 2);
        const g = ctx.createLinearGradient(-bw / 2, y, bw / 2, y);
        g.addColorStop(0, "#F0C57A"); g.addColorStop(1, "#A86A28");
        ctx.fillStyle = g; rr(-bw / 2, y - bh, bw, bh, 3); ctx.fill();
      }
      ctx.restore();
    }
    function frame(now) {
      const dt = Math.min(0.033, (now - t0) / 1000); t0 = now;
      const s = Math.min(w, h) / 520;
      const u = ((now / 1000) % 5.6) / 5.6;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0B3A72"); sky.addColorStop(0.7, "#0A2F5C"); sky.addColorStop(1, "#071E3E");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const lx = w * (0.14 + i * 0.24), ly = h * 0.07;
        const cone = ctx.createRadialGradient(lx, ly, 8, lx, h * 0.55, h * 0.5);
        cone.addColorStop(0, "rgba(210,230,255,.2)"); cone.addColorStop(1, "rgba(210,230,255,0)");
        ctx.fillStyle = cone;
        ctx.beginPath(); ctx.moveTo(lx - 16, ly); ctx.lineTo(lx + 16, ly);
        ctx.lineTo(lx + 170 * s, h * 0.72); ctx.lineTo(lx - 170 * s, h * 0.72); ctx.fill();
        ctx.fillStyle = "#F4FAFF"; rr(lx - 26, ly - 7, 52, 12, 4); ctx.fill();
      }
      const floorY = h * 0.82;
      ctx.fillStyle = "#143A66"; ctx.fillRect(0, floorY, w, h - floorY);
      const convY = floorY - 22 * s;
      ctx.fillStyle = "#1C334F"; rr(w * 0.03, convY - 14 * s, w * 0.94, 28 * s, 8); ctx.fill();
      ctx.fillStyle = "#2B4668"; ctx.fillRect(w * 0.04, convY - 6 * s, w * 0.92, 14 * s);
      const bx = ((now / 1000 * 56) % (w * 0.32)) + w * 0.05;
      board(bx, convY - 16 * s, s); board(bx - 110 * s, convY - 16 * s, s);

      const baseX = w * 0.36, baseY = floorY - 6 * s;
      const l1 = 155 * s, l2 = 142 * s;
      const pick = { x: baseX - 190 * s, y: convY - 18 * s };
      const place = { x: baseX + 210 * s, y: convY - 18 * s - boards * 14 * s };
      let target = pick, grip = 0, hold = false;
      if (u < 0.16) {
        const k = ease(u / 0.16);
        target = { x: lerp(baseX + 30 * s, pick.x, k), y: lerp(baseY - 190 * s, pick.y, k) };
        grip = 1 - k * 0.85;
      } else if (u < 0.24) {
        target = pick; grip = lerp(0.15, 0.92, (u - 0.16) / 0.08); hold = grip > 0.5;
      } else if (u < 0.48) {
        const k = ease((u - 0.24) / 0.24);
        target = { x: lerp(pick.x, place.x, k), y: lerp(pick.y, place.y - 42 * s, k) - Math.sin(k * Math.PI) * 64 * s };
        grip = 0.92; hold = true;
      } else if (u < 0.58) {
        const k = ease((u - 0.48) / 0.1);
        target = { x: place.x, y: lerp(place.y - 42 * s, place.y, k) }; grip = 0.92; hold = true;
      } else if (u < 0.68) {
        target = place; grip = lerp(0.92, 0.12, (u - 0.58) / 0.1); hold = grip > 0.55;
        if (!hold && held) {
          boards = Math.min(8, boards + 1);
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 100;
            sparks.push({ x: place.x, y: place.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
          }
        }
      } else {
        const k = ease((u - 0.68) / 0.32);
        target = { x: lerp(place.x, baseX + 30 * s, k), y: lerp(place.y, baseY - 190 * s, k) };
        grip = 0.12;
        if (boards >= 7) { outgoing = 1; boards = 3; }
      }
      held = hold;
      if (factory.cue === "place" && now < factory.cueUntil) boards = Math.min(8, boards);
      if (factory.cue === "drop" && now < factory.cueUntil) { grip = 0.1; hold = false; }

      const sx = baseX, sy = baseY - 70 * s;
      const dx = target.x - sx, dy = target.y - sy;
      const dist = clamp(Math.hypot(dx, dy), 24, l1 + l2 - 6);
      const a2 = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
      const a1 = Math.atan2(dy, dx) - Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
      const ex = sx + Math.cos(a1) * l1, ey = sy + Math.sin(a1) * l1;
      const wx = ex + Math.cos(a1 + a2) * l2, wy = ey + Math.sin(a1 + a2) * l2;
      const flat = lerp(a1 + a2, 0, 0.82);

      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(baseX, floorY + 8, 90 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = metal(baseX - 60 * s, baseY, baseX + 60 * s, baseY - 70 * s);
      rr(baseX - 58 * s, baseY - 66 * s, 116 * s, 66 * s, 14); ctx.fill();
      ctx.fillStyle = "#1E6FD4"; rr(baseX - 36 * s, baseY - 36 * s, 72 * s, 22 * s, 6); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 " + 14 * s + "px Manrope,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("KUKA", baseX, baseY - 25 * s);
      capsule(sx, sy, ex, ey, 18 * s, metal(sx, sy, ex, ey));
      capsule(ex, ey, wx, wy, 14 * s, metal(ex, ey, wx, wy));
      joint(sx, sy, 20 * s); joint(ex, ey, 16 * s); joint(wx, wy, 13 * s);
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(flat);
      const open = (1 - grip) * 12 * s;
      ctx.fillStyle = "#FFB020"; rr(-11 * s, 10 * s, 22 * s, 14 * s, 3); ctx.fill();
      ctx.fillStyle = "#E89412";
      ctx.fillRect(-24 * s - open, 20 * s, 18 * s, 8 * s);
      ctx.fillRect(6 * s + open, 20 * s, 18 * s, 8 * s);
      if (hold) board(0, 36 * s, s);
      ctx.restore();
      outgoing = Math.max(0, outgoing - dt * 0.55);
      pallet(baseX + 210 * s + outgoing * 50, convY - 4 * s, boards, s);
      pallet(w * 0.86, convY - 4 * s, 6, s * 0.92);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.life -= dt * 2; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.fillStyle = "#FFE7A8";
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---- quiz ---- */
  let mod = null, qs = [], idx = 0, locked = false, picked = null;
  let correctN = 0, xp = 0, streak = 0, left = TMAX, timer = null;
  let live = false, saved = false, started = 0, fio = "", group = "";

  document.querySelectorAll(".mod").forEach((el) => {
    el.onclick = () => {
      document.querySelectorAll(".mod").forEach((m) => m.classList.remove("on"));
      el.classList.add("on");
      mod = el.dataset.m;
    };
  });
  $("fio").addEventListener("input", () => {
    const admin = $("fio").value.trim().toLowerCase().replace(/\s+/g, " ") === ADMIN;
    $("pwdbox").classList.toggle("hidden", !admin);
    $("go").textContent = admin ? "Войти в панель" : "Начать тест";
  });

  function tick() {
    left -= 1;
    $("qt").textContent = "0:" + String(Math.max(0, left)).padStart(2, "0");
    if (left <= 0) answer(-1);
  }
  function renderQ() {
    const q = qs[idx];
    $("qn").textContent = "Вопрос " + (idx + 1) + " / " + qs.length;
    $("qv").textContent = "Верно: " + correctN;
    $("qtext").textContent = q.q;
    $("pb").style.width = (idx / qs.length * 100) + "%";
    $("qx").textContent = "XP " + xp;
    $("qs").classList.toggle("hidden", streak < 2);
    $("qs").textContent = "серия " + streak;
    $("opts").innerHTML = "";
    q.a.forEach((t, i) => {
      const b = document.createElement("button");
      b.className = "opt"; b.type = "button"; b.textContent = t;
      b.onclick = () => answer(i);
      $("opts").appendChild(b);
    });
  }
  function persist(row) {
    if (saved) return;
    saved = true;
    const all = load(); all.unshift(row); save(all);
  }
  function finish(status) {
    live = false; clearInterval(timer);
    const total = qs.length;
    const pct = status === "СПИСЫВАНИЕ" ? 0 : Math.round(correctN / Math.max(1, total) * 100);
    persist({
      date: new Date().toLocaleString("ru-RU"), name: fio, group, modules: mod,
      status, correct: status === "СПИСЫВАНИЕ" ? 0 : correctN, total, pct,
      xp: status === "СПИСЫВАНИЕ" ? 0 : xp,
      duration: Math.round((Date.now() - started) / 1000)
    });
    if (status === "СПИСЫВАНИЕ") {
      $("cheat").classList.remove("hidden");
      siren(); speak();
      return;
    }
    $("rpct").textContent = pct + "%";
    $("rname").textContent = fio;
    $("rgroup").textContent = group;
    $("rc").textContent = correctN;
    $("rt").textContent = total;
    $("rx").textContent = xp;
    show("result");
  }
  function answer(choice) {
    if (locked) return;
    locked = true; clearInterval(timer);
    const q = qs[idx];
    const ok = choice === q.correct;
    [...$("opts").children].forEach((b, i) => {
      if (i === q.correct) b.classList.add("ok");
      if (i === choice && !ok) b.classList.add("bad");
      b.disabled = true;
    });
    if (ok) {
      sfxOk(); factory.cue = "place"; factory.cueUntil = performance.now() + 900;
      const bonus = Math.max(8, Math.round(left / TMAX * 20));
      streak += 1; correctN += 1; xp += 12 + bonus + (streak >= 3 ? streak * 2 : 0);
    } else {
      sfxBad(); factory.cue = "drop"; factory.cueUntil = performance.now() + 900; streak = 0;
    }
    setTimeout(() => {
      if (idx + 1 >= qs.length) finish("Пройден");
      else { idx += 1; locked = false; left = TMAX; renderQ(); timer = setInterval(tick, 1000); }
    }, 720);
  }

  $("go").onclick = () => {
    try { audio(); } catch (e) {}
    fio = $("fio").value.trim();
    group = $("group").value.trim();
    if (!fio || !group || !mod) return;
    if (fio.toLowerCase().replace(/\s+/g, " ") === ADMIN) {
      if ($("pwd").value !== PASS) { $("pwderr").textContent = "Неверный пароль"; return; }
      const rows = load();
      const ok = rows.filter((r) => r.status === "Пройден");
      const cheat = rows.filter((r) => r.status === "СПИСЫВАНИЕ").length;
      const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.pct, 0) / ok.length) : 0;
      $("astats").innerHTML =
        "<div class='stat'><b>" + rows.length + "</b><span>попыток</span></div>" +
        "<div class='stat'><b>" + ok.length + "</b><span>успешных</span></div>" +
        "<div class='stat'><b>" + cheat + "</b><span>списываний</span></div>" +
        "<div class='stat'><b>" + avg + "%</b><span>средний %</span></div>";
      $("abody").innerHTML = rows.length
        ? rows.map((r) => "<tr><td>" + r.date + "</td><td>" + r.name + "</td><td>" + r.pct + "</td><td>" + r.status + "</td></tr>").join("")
        : "<tr><td colspan='4'>Пока нет прохождений на этом устройстве</td></tr>";
      show("admin"); return;
    }
    saved = false; live = true; started = Date.now();
    qs = prepare(mod); idx = 0; locked = false; correctN = 0; xp = 0; streak = 0; left = TMAX;
    $("qm").textContent = (typeof MODULES !== "undefined" && MODULES[mod] && MODULES[mod].title) ? MODULES[mod].title : ("Модуль " + mod);
    $("strip").textContent = mod === "1" ? "Манипулятор укладывает слой" : mod === "3" ? "Считаем такт и маржу" : "Сигналы идут по шине";
    show("quiz"); renderQ(); timer = setInterval(tick, 1000);
    const hide = () => {
      if (!live) return;
      if (document.visibilityState === "hidden") { live = false; finish("СПИСЫВАНИЕ"); }
    };
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("copy", (e) => e.preventDefault());
  };
  $("again").onclick = () => { show("start"); mod = null; document.querySelectorAll(".mod").forEach((m) => m.classList.remove("on")); };
  $("back").onclick = () => show("start");
  $("exp").onclick = () => {
    const rows = load();
    const head = "Дата;ФИО;Группа;Модуль;Статус;Верных;Всего;%;XP;Сек";
    const body = rows.map((r) => [r.date, r.name, r.group, r.modules, r.status, r.correct, r.total, r.pct, r.xp, r.duration].join(";"));
    const blob = new Blob(["\uFEFF" + [head].concat(body).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ОПП_результаты.csv"; a.click();
  };

  startFactory();
  setTimeout(() => show("start"), 1600);
})();
