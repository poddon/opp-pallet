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
    const fromMod = (typeof MODULES !== "undefined" && MODULES[id] && MODULES[id].questions) || [];
    const src = fromMod.length
      ? fromMod
      : (typeof QUESTIONS !== "undefined" ? QUESTIONS : []).filter((q) => String(q.module) === String(id));
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
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let w = 0, h = 0, t0 = performance.now();
    const PATTERN = [
      { kind: "stringer", ox: -0.38 }, { kind: "stringer", ox: 0 }, { kind: "stringer", ox: 0.38 },
      { kind: "deck", ox: -0.4 }, { kind: "deck", ox: -0.2 }, { kind: "deck", ox: 0 },
      { kind: "deck", ox: 0.2 }, { kind: "deck", ox: 0.4 }
    ];
    const placed = PATTERN.map(() => false);
    let nextPart = 0, cyclePart = 0, prevU = 0, holdKind = null, gripped = false, outgoing = 0, a1 = -2.4, a2 = 2.1, gripVis = 0.12;
    const sparks = [];
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const unwrap = (from, to) => {
      let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + d;
    };
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
      const rad = Math.min(r, bw / 2, bh / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, rad);
      ctx.arcTo(x + bw, y + bh, x, y + bh, rad);
      ctx.arcTo(x, y + bh, x, y, rad);
      ctx.arcTo(x, y, x + bw, y, rad);
      ctx.closePath();
    }
    function tapered(x1, y1, x2, y2, r1, r2, fill) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      ctx.beginPath();
      ctx.moveTo(x1 + px * r1, y1 + py * r1);
      ctx.lineTo(x2 + px * r2, y2 + py * r2);
      ctx.arc(x2, y2, r2, Math.atan2(py, px), Math.atan2(-py, -px));
      ctx.lineTo(x1 - px * r1, y1 - py * r1);
      ctx.arc(x1, y1, r1, Math.atan2(-py, -px), Math.atan2(py, px));
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
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
      ctx.fillStyle = "#1E6FD4"; ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
    }
    function board(cx, cy, bw, bh, dark) {
      const g = ctx.createLinearGradient(cx, cy - bh / 2, cx, cy + bh / 2);
      g.addColorStop(0, dark ? "#8B5A2A" : "#E8B86A");
      g.addColorStop(1, dark ? "#5A3514" : "#A86A28");
      ctx.fillStyle = g; rr(cx - bw / 2, cy - bh / 2, bw, bh, 2); ctx.fill();
    }
    function box(cx, bottom, bw, bh, depth, light, dark) {
      const dx = -depth * 0.52, dy = -depth * 0.26, top = bottom - bh, left = cx - bw / 2;
      ctx.beginPath();
      ctx.moveTo(left, top); ctx.lineTo(left + bw, top);
      ctx.lineTo(left + bw + dx, top + dy); ctx.lineTo(left + dx, top + dy);
      ctx.closePath(); ctx.fillStyle = light; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(left + bw, top); ctx.lineTo(left + bw + dx, top + dy);
      ctx.lineTo(left + bw + dx, bottom + dy); ctx.lineTo(left + bw, bottom);
      ctx.closePath(); ctx.fillStyle = dark; ctx.fill();
      const g = ctx.createLinearGradient(left, top, left, bottom);
      g.addColorStop(0, light); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.fillRect(left, top, bw, bh);
    }
    function pallet(px, py, s, mask) {
      const W = 110 * s;
      ctx.save(); ctx.translate(px, py);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.beginPath(); ctx.ellipse(0, 8 * s, W * 0.42, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
      PATTERN.forEach((p, i) => {
        if (!mask[i] || p.kind !== "stringer") return;
        board(p.ox * W, -7 * s, 28 * s, 16 * s, true);
      });
      PATTERN.forEach((p, i) => {
        if (!mask[i] || p.kind !== "deck") return;
        board(p.ox * W, -20 * s, 24 * s, 8 * s, false);
      });
      ctx.restore();
    }
    function solve(tx, ty, sx, sy, l1, l2) {
      let dx = tx - sx, dy = ty - sy, dist = Math.hypot(dx, dy);
      const maxd = l1 + l2 - 12, mind = Math.abs(l1 - l2) + 16;
      if (dist < 1) dist = 1;
      if (dist > maxd) { dx *= maxd / dist; dy *= maxd / dist; dist = maxd; }
      else if (dist < mind) { dx *= mind / dist; dy *= mind / dist; dist = mind; }
      const ang = Math.atan2(dy, dx);
      const interior = Math.acos(clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
      const da1 = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
      const c1 = { a1: ang - da1, a2: Math.PI - interior };
      const c2 = { a1: ang + da1, a2: interior - Math.PI };
      return (sy + Math.sin(c1.a1) * l1 <= sy + Math.sin(c2.a1) * l1) ? c1 : c2;
    }
    function frame(now) {
      const dt = Math.min(0.033, (now - t0) / 1000); t0 = now;
      const s = Math.min(w, h) / 520;
      const u = ((now / 1000) % 7.2) / 7.2;
      if (u + 0.45 < prevU) cyclePart = nextPart;
      prevU = u;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0C3D78"); sky.addColorStop(0.7, "#0A2F5C"); sky.addColorStop(1, "#071E3E");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const lx = w * (0.16 + i * 0.23), ly = h * 0.055;
        const cone = ctx.createRadialGradient(lx, ly, 6, lx, h * 0.58, h * 0.48);
        cone.addColorStop(0, "rgba(220,236,255,.2)"); cone.addColorStop(1, "rgba(220,236,255,0)");
        ctx.fillStyle = cone;
        ctx.beginPath(); ctx.moveTo(lx - 14, ly); ctx.lineTo(lx + 14, ly);
        ctx.lineTo(lx + 160 * s, h * 0.7); ctx.lineTo(lx - 160 * s, h * 0.7); ctx.fill();
        ctx.fillStyle = "#F4FAFF"; rr(lx - 22, ly - 6, 44, 10, 4); ctx.fill();
      }
      const floorY = h * 0.82;
      ctx.fillStyle = "#163E6B"; ctx.fillRect(0, floorY, w, h - floorY);
      for (let x = 0; x < w; x += 28) {
        ctx.fillStyle = x % 56 === 0 ? "#E8B020" : "#111";
        ctx.fillRect(x, floorY, 14, 8);
      }
      const convX = w * 0.04, convLen = w * 0.92, convY = floorY - 52 * s;
      const frameH = 20 * s;
      for (let lx = convX + 16 * s; lx < convX + convLen - 12 * s; lx += 64 * s) {
        ctx.fillStyle = "#3A4E64"; ctx.fillRect(lx, convY + frameH - 2 * s, 7 * s, floorY - (convY + frameH) + 2 * s);
        ctx.fillStyle = "#243446"; ctx.fillRect(lx - 7 * s, floorY - 5 * s, 21 * s, 5 * s);
      }
      ctx.fillStyle = "#3E546C"; rr(convX, convY, convLen, frameH, 3); ctx.fill();
      ctx.fillStyle = "#24364A"; ctx.fillRect(convX + 5 * s, convY + 3 * s, convLen - 10 * s, 13 * s);
      ctx.fillStyle = "#E8B020"; ctx.fillRect(convX, convY - 3 * s, convLen, 4 * s);
      const nRoll = Math.max(8, Math.floor((convLen - 24 * s) / (15 * s)));
      for (let i = 0; i < nRoll; i++) {
        const rx = convX + 16 * s + i * 15 * s;
        ctx.fillStyle = "#8FA3B8";
        ctx.beginPath(); ctx.ellipse(rx, convY + 10 * s, 6 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      }
      const xMin = convX + 48 * s, xMax = convX + convLen - 48 * s;
      const pickX = Math.max(xMin, Math.min(xMax, convX + convLen * 0.22));
      const palletX = Math.max(xMin, Math.min(xMax, convX + convLen * 0.68));

      const baseX = w * 0.4, baseY = floorY - 4 * s;
      const sx = baseX, sy = baseY - 78 * s, l1 = 128 * s, l2 = 114 * s;
      const part = PATTERN[Math.min(cyclePart, PATTERN.length - 1)];
      const assembling = cyclePart < PATTERN.length && outgoing === 0;
      const darkPick = part.kind === "stringer";
      const bh = darkPick ? 14 * s : 10 * s;
      const bw = darkPick ? 92 * s : 84 * s;
      const beltY = convY - 2 * s - bh / 2;
      const cupReach = (gv) => 16 * s + lerp(15 * s, 6 * s, gv);
      const wristAt = (cy, hgt, gv) => cy - hgt / 2 - cupReach(gv);
      const slotY = darkPick ? beltY : convY - 2 * s - 16 * s - bh / 2;
      const pick = { x: pickX, y: wristAt(beltY, bh, 0.12) };
      const place = { x: Math.max(xMin, Math.min(xMax, palletX + part.ox * 36 * s)), y: wristAt(slotY, bh, 1) };
      const travelY = convY - 56 * s;
      const home = { x: Math.max(xMin, Math.min(xMax, (pick.x + place.x) / 2)), y: travelY };
      let target = home, grip = 0.12, wantHold = false, justPlaced = false, justPicked = false;
      if (assembling) {
        if (u < 0.1) {
          const k = ease(u / 0.1);
          target = { x: lerp(home.x, pick.x, k), y: lerp(home.y, pick.y - 10 * s, k) }; grip = 0.12;
        } else if (u < 0.2) {
          const k = ease((u - 0.1) / 0.1);
          target = { x: pick.x, y: lerp(pick.y - 10 * s, pick.y, k) }; grip = 0.12;
        } else if (u < 0.32) {
          grip = lerp(0.12, 1, ease((u - 0.2) / 0.12));
          target = { x: pick.x, y: wristAt(beltY, bh, grip) };
          wantHold = grip > 0.62; justPicked = wantHold && !gripped;
        } else if (u < 0.42) {
          const k = ease((u - 0.32) / 0.1);
          target = { x: pick.x, y: lerp(wristAt(beltY, bh, 1), travelY, k) }; grip = 1; wantHold = true;
        } else if (u < 0.58) {
          const k = ease((u - 0.42) / 0.16);
          target = { x: lerp(pick.x, place.x, k), y: travelY }; grip = 1; wantHold = true;
        } else if (u < 0.68) {
          const k = ease((u - 0.58) / 0.1);
          target = { x: place.x, y: lerp(travelY, wristAt(slotY, bh, 1), k) }; grip = 1; wantHold = true;
        } else if (u < 0.8) {
          grip = lerp(1, 0.12, ease((u - 0.68) / 0.12));
          target = { x: place.x, y: wristAt(slotY, bh, grip) };
          wantHold = grip > 0.5; justPlaced = !wantHold && gripped;
        } else if (u < 0.88) {
          const k = ease((u - 0.8) / 0.08);
          target = { x: place.x, y: lerp(wristAt(slotY, bh, 0.12), travelY, k) }; grip = 0.12;
        } else {
          const k = ease((u - 0.88) / 0.12);
          target = { x: lerp(place.x, home.x, k), y: travelY }; grip = 0.12;
        }
      }
      target.x = Math.max(xMin, Math.min(xMax, target.x));
      target.y = Math.min(target.y, convY - 32 * s);
      if (factory.cue === "drop" && now < factory.cueUntil) { wantHold = false; grip = 0.1; justPlaced = false; holdKind = null; gripped = false; }
      if (justPicked) { holdKind = part.kind; gripped = true; }
      if (justPlaced && holdKind) {
        placed[cyclePart] = true; holdKind = null; gripped = false; nextPart = cyclePart + 1;
        if (nextPart >= PATTERN.length) outgoing = 1;
      }
      if (!wantHold && u > 0.8) gripped = false;
      if (outgoing > 0) {
        outgoing += dt * 0.55;
        if (outgoing > 2.4) { outgoing = 0; nextPart = 0; cyclePart = 0; for (let i = 0; i < placed.length; i++) placed[i] = false; }
      }
      const ik = solve(target.x, target.y, sx, sy, l1, l2);
      const follow = 1 - Math.exp(-10 * dt);
      a1 = lerp(a1, unwrap(a1, ik.a1), follow);
      a2 = lerp(a2, unwrap(a2, ik.a2), follow);
      gripVis = lerp(gripVis, grip, 1 - Math.exp(-14 * dt));
      const ex = sx + Math.cos(a1) * l1, ey = sy + Math.sin(a1) * l1;
      const wx = ex + Math.cos(a1 + a2) * l2, wy = ey + Math.sin(a1 + a2) * l2;

      ctx.fillStyle = "rgba(0,0,0,.32)";
      ctx.beginPath(); ctx.ellipse(baseX, floorY + 8, 78 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = metal(baseX - 70 * s, baseY, baseX + 70 * s, baseY - 80 * s);
      ctx.beginPath();
      ctx.moveTo(baseX - 62 * s, baseY); ctx.lineTo(baseX - 48 * s, baseY - 72 * s);
      ctx.lineTo(baseX + 48 * s, baseY - 72 * s); ctx.lineTo(baseX + 62 * s, baseY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1E6FD4"; rr(baseX - 34 * s, baseY - 38 * s, 68 * s, 20 * s, 5); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 " + 13 * s + "px Manrope,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("KUKA", baseX, baseY - 28 * s);
      tapered(sx, sy, ex, ey, 22 * s, 14 * s, metal(sx, sy, ex, ey));
      tapered(ex, ey, wx, wy, 13 * s, 10 * s, metal(ex, ey, wx, wy));
      joint(sx, sy, 18 * s); joint(ex, ey, 14 * s); joint(wx, wy, 11 * s);
      ctx.save(); ctx.translate(wx, wy);
      ctx.fillStyle = metal(-12, -8, 12, 12); rr(-12 * s, -10 * s, 24 * s, 14 * s, 4); ctx.fill();
      ctx.fillStyle = "#E8A318"; rr(-28 * s, 2 * s, 56 * s, 10 * s, 3); ctx.fill();
      const g = gripVis, cupH = lerp(15 * s, 6 * s, g), cupW = lerp(6.5 * s, 9.5 * s, g);
      for (const ox of [-16 * s, 16 * s]) {
        ctx.fillStyle = "#9AA8B8"; ctx.fillRect(ox - 2 * s, 11 * s, 4 * s, 5 * s);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = k % 2 ? "#E8EEF4" : "#C5D0DC";
          ctx.beginPath(); ctx.ellipse(ox, 16 * s + (k + 0.5) * (cupH / 3), cupW * (1 - k * 0.06), cupH / 5.2, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#4A5A6A";
        ctx.beginPath(); ctx.ellipse(ox, 16 * s + cupH, cupW + 1.5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (holdKind) {
        board(0, 16 * s + cupH + 2.2 * s + bh / 2, bw, bh, darkPick);
      }
      ctx.restore();
      if (!holdKind) {
        let waitX = pickX;
        if (u > 0.8) waitX = lerp(pickX - 88 * s, pickX, ease(Math.min(1, (u - 0.8) / 0.18)));
        board(Math.max(convX + 36 * s, waitX), beltY, bw, bh, darkPick);
      }
      for (let i = 1; i <= 2; i++) {
        const fx = pickX - i * 96 * s;
        if (fx > convX + 30 * s) board(fx, convY - 2 * s - 5 * s, 80 * s, 10 * s, false);
      }
      if (outgoing < 2.2) pallet(palletX + Math.max(0, outgoing - 0.15) * 220 * s, convY - 2 * s, s, placed);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.life -= dt * 2; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = "#FFE7A8";
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
  function synUrl() {
    const ls = (localStorage.getItem("opp_synology_url") || "").trim();
    const w = (window.OPP_SYNOLOGY_URL || "").trim();
    const url = ls || w || "save.php";
    if (!/^https?:\/\//i.test(url) && /github\.io$/i.test(location.hostname)) return "";
    return url;
  }
  function synToken() {
    return (localStorage.getItem("opp_synology_token") || window.OPP_SYNOLOGY_TOKEN || "OppPalletSave").trim();
  }
  function sendSynology(row) {
    const url = synUrl();
    if (!url) return;
    const dest = new URL(url, location.href).toString();
    const body = JSON.stringify(Object.assign({}, row, { token: synToken() }));
    try { navigator.sendBeacon(dest, new Blob([body], { type: "application/json" })); } catch (e) {}
    fetch(dest, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Opp-Token": synToken() },
      body: body,
      keepalive: true,
      mode: "cors"
    }).catch(function () {});
  }
  function persist(row) {
    if (saved) return;
    saved = true;
    const all = load(); all.unshift(row); save(all);
    const base = (window.OPP_API_URL || "").replace(/\/$/, "");
    if (!base) return;
    fetch(base + "/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
      mode: "cors"
    }).catch(function () {});
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
    group = $("group").value.trim().toUpperCase();
    $("group").value = group;
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
      $("synurl").value = localStorage.getItem("opp_synology_url") || window.OPP_SYNOLOGY_URL || "";
      $("syntoken").value = synToken();
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
  if ($("synsave")) $("synsave").onclick = () => {
    localStorage.setItem("opp_synology_url", $("synurl").value.trim());
    localStorage.setItem("opp_synology_token", $("syntoken").value.trim() || "OppPalletSave");
    const url = synUrl();
    if (!url) { $("synmsg").textContent = "Укажите HTTPS-адрес save.php на NAS"; return; }
    $("synmsg").textContent = "Проверяю…";
    fetch(new URL(url, location.href).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Opp-Token": synToken() },
      body: JSON.stringify({ ping: true, token: synToken() }),
      mode: "cors"
    }).then((r) => r.json()).then((d) => {
      $("synmsg").textContent = d && d.ok ? "Synology подключен. Файл результатов из браузера не скачать." : "Ответ NAS: доступ запрещён";
    }).catch(() => { $("synmsg").textContent = "Нет связи. Проверьте Веб-станцию и HTTPS."; });
  };
  if ($("syndl")) $("syndl").onclick = () => {
    fetch("save.php").then((r) => r.text()).then((t) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([t], { type: "application/x-php" }));
      a.download = "save.php";
      a.click();
    });
  };
  $("exp").onclick = () => {
    const rows = load().filter((r) => r.status !== "СПИСЫВАНИЕ");
    const head = "Дата;ФИО;Группа;Модуль;Статус;Верных;Всего;%;XP;Сек";
    const body = rows.map((r) => [r.date, r.name, r.group, r.modules, r.status, r.correct, r.total, r.pct, r.xp, r.duration].join(";"));
    const blob = new Blob(["\uFEFF" + [head].concat(body).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ОПП_результаты.csv"; a.click();
  };

  try { startFactory(); } catch (e) {}
  (function boot() {
    const steps = [
      [0, 6, "Питание ячейки…"],
      [700, 22, "Калибровка осей KUKA…"],
      [1500, 44, "Проверка вакуумного захвата…"],
      [2300, 67, "Загрузка модулей теста…"],
      [3200, 86, "Синхронизация линии…"],
      [4000, 100, "Готово к смене"],
    ];
    steps.forEach(([t, p, m]) => setTimeout(() => {
      $("bootmsg").textContent = m;
      $("bootpct").textContent = p + "%";
      $("bootbar").style.width = p + "%";
    }, t));
    setTimeout(() => show("start"), 4600);
  })();
})();
