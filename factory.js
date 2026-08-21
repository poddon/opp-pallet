window.OPP_FACTORY = { cue: "idle", cueUntil: 0 };
function startFactory() {
  try {
    const canvas = document.getElementById("fx");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const mobile = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 820;
    let w = 0, h = 0, t0 = performance.now(), skip = 0;
    const KINDS = ["stringer", "stringer", "stringer", "deck", "deck", "deck", "deck", "deck"];
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const unwrap = (from, to) => {
      let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + d;
    };
    function resize() {
      const dpr = mobile ? 1 : Math.min(devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth || innerWidth;
      h = canvas.clientHeight || innerHeight;
      if (!w || !h) return;
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
    function drawCrate(cx, bottom, s, stack) {
      const bw = 108 * s, bh = 46 * s, d = 18 * s;
      const left = cx - bw / 2, top = bottom - bh;
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.beginPath(); ctx.ellipse(cx, bottom + 6 * s, bw * 0.42, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6B3E18";
      ctx.beginPath();
      ctx.moveTo(left + bw, top); ctx.lineTo(left + bw + d * 0.45, top - d * 0.22);
      ctx.lineTo(left + bw + d * 0.45, bottom - d * 0.22); ctx.lineTo(left + bw, bottom); ctx.fill();
      const g = ctx.createLinearGradient(left, top, left, bottom);
      g.addColorStop(0, "#C47A32"); g.addColorStop(1, "#7A4316");
      ctx.fillStyle = g; ctx.fillRect(left, top, bw, bh);
      ctx.strokeStyle = "#5A3010"; ctx.lineWidth = 2;
      ctx.strokeRect(left, top, bw, bh);
      ctx.fillStyle = "#3A220C";
      ctx.fillRect(left + 6 * s, top + 6 * s, bw - 12 * s, bh - 12 * s);
      ctx.fillStyle = "#E8B020";
      ctx.font = "800 " + 10 * s + "px Manrope,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("ТАРА", cx, top - 10 * s);
      stack.forEach((kind, i) => {
        const dark = kind === "stringer";
        const y = bottom - 10 * s - i * 6 * s;
        board(cx, y, dark ? 86 * s : 78 * s, dark ? 8 * s : 6 * s, dark);
      });
    }

    let phase = "wait", phaseT = 0, held = null, a1 = -2.4, a2 = 2.1, gripVis = 0.12;
    let belt = null, bin = [], binSlide = 0, nextKind = 0, firstBoard = true;
    const DUR = { wait: 0.15, down: 0.4, grip: 0.45, up: 0.36, move: 0.7, downPlace: 0.4, release: 0.4, upPlace: 0.34 };

    function frame(now) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (mobile && (++skip & 1)) { requestAnimationFrame(frame); return; }
      const dt = Math.min(0.033, (now - t0) / 1000); t0 = now;
      const s = Math.min(w, h) / 520;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0C3D78"); sky.addColorStop(0.7, "#0A2F5C"); sky.addColorStop(1, "#071E3E");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < (mobile ? 2 : 4); i++) {
        const lx = w * (0.16 + i * (mobile ? 0.45 : 0.23)), ly = h * 0.055;
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
      const convX = w * 0.04, convLen = w * 0.62, convY = floorY - 52 * s;
      const frameH = 20 * s;
      for (let lx = convX + 16 * s; lx < convX + convLen - 12 * s; lx += 64 * s) {
        ctx.fillStyle = "#3A4E64"; ctx.fillRect(lx, convY + frameH - 2 * s, 7 * s, floorY - (convY + frameH) + 2 * s);
        ctx.fillStyle = "#243446"; ctx.fillRect(lx - 7 * s, floorY - 5 * s, 21 * s, 5 * s);
      }
      ctx.fillStyle = "#3E546C"; rr(convX, convY, convLen, frameH, 3); ctx.fill();
      ctx.fillStyle = "#24364A"; ctx.fillRect(convX + 5 * s, convY + 3 * s, convLen - 10 * s, 13 * s);
      ctx.fillStyle = "#E8B020"; ctx.fillRect(convX, convY - 3 * s, convLen, 4 * s);
      const nRoll = Math.max(8, Math.floor((convLen - 24 * s) / (15 * s)));
      const rollSpin = held || (belt && belt.x < convX + convLen * 0.42 - 10 * s) ? now / 180 : 0;
      for (let i = 0; i < nRoll; i++) {
        const rx = convX + 16 * s + i * 15 * s;
        ctx.fillStyle = "#8FA3B8";
        ctx.beginPath(); ctx.ellipse(rx, convY + 10 * s, 6 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        if (rollSpin) {
          ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(rx, convY + 10 * s, 2.4 * s, rollSpin + i, rollSpin + i + 1.4); ctx.stroke();
        }
      }

      const pickX = convX + convLen * 0.62;
      const spawnX = convX + 36 * s;
      const crateX = w * 0.82;
      const crateBottom = floorY - 4 * s;
      const beltTop = convY - 2 * s;
      const travelY = convY - 56 * s;
      const sizeOf = (kind) => kind === "stringer" ? { bw: 90 * s, bh: 14 * s } : { bw: 82 * s, bh: 10 * s };
      const cupReach = (g) => 16 * s + lerp(15 * s, 6 * s, g);
      const wristAt = (top, g) => top - cupReach(g);

      if (!belt && !held && phase === "wait") {
        const kind = KINDS[nextKind % KINDS.length];
        belt = { x: firstBoard ? pickX : spawnX, kind };
        firstBoard = false;
      }
      if (!belt && held && (phase === "up" || phase === "move" || phase === "downPlace")) {
        const kind = KINDS[nextKind % KINDS.length];
        belt = { x: spawnX, kind };
      }

      const atSensor = !!(belt && pickX - belt.x < 6 * s);
      const beltRun = !!(belt && !atSensor);
      if (beltRun) {
        belt.x = Math.min(pickX, belt.x + 70 * s * dt);
      }

      const workKind = held || (belt && belt.kind) || "deck";
      const work = sizeOf(workKind);
      const pickTop = beltTop - work.bh;
      const stackH = bin.length * 6 * s;
      const placeTop = crateBottom - 38 * s - stackH - work.bh;
      const placeX = crateX;

      if (phase === "wait") {
        if (atSensor && !held) { phase = "down"; phaseT = 0; }
      } else {
        phaseT += dt / DUR[phase];
        if (phaseT >= 1) {
          phaseT = 0;
          if (phase === "down") phase = "grip";
          else if (phase === "grip") phase = "up";
          else if (phase === "up") phase = "move";
          else if (phase === "move") phase = "downPlace";
          else if (phase === "downPlace") phase = "release";
          else if (phase === "release") phase = "upPlace";
          else if (phase === "upPlace") phase = "wait";
        }
      }
      if (phase === "grip" && !held && belt && phaseT > 0.4) {
        held = belt.kind;
        belt = null;
        nextKind += 1;
      }
      if (phase === "release" && held && phaseT > 0.45) {
        bin.push(held);
        held = null;
        if (bin.length >= 8) binSlide = 0.01;
      }
      if (binSlide > 0) {
        binSlide += dt * 0.7;
        if (binSlide > 1.6) { bin = []; binSlide = 0; }
      }

      const k = ease(clamp(phaseT, 0, 1));
      let grip = 0.12;
      let target = { x: pickX, y: travelY };
      if (phase === "down") target = { x: pickX, y: lerp(travelY, wristAt(pickTop, 0.12), k) };
      else if (phase === "grip") { grip = lerp(0.12, 1, k); target = { x: pickX, y: wristAt(pickTop, grip) }; }
      else if (phase === "up") { grip = 1; target = { x: pickX, y: lerp(wristAt(pickTop, 1), travelY, k) }; }
      else if (phase === "move") { grip = 1; target = { x: lerp(pickX, placeX, k), y: travelY }; }
      else if (phase === "downPlace") { grip = 1; target = { x: placeX, y: lerp(travelY, wristAt(placeTop, 1), k) }; }
      else if (phase === "release") { grip = lerp(1, 0.12, k); target = { x: placeX, y: wristAt(placeTop, grip) }; }
      else if (phase === "upPlace") target = { x: placeX, y: lerp(wristAt(placeTop, 0.12), travelY, k) };

      if (window.OPP_FACTORY.cue === "drop" && now < window.OPP_FACTORY.cueUntil) {
        held = null; grip = 0.1; phase = "wait"; phaseT = 0;
      }
      const xMin = convX + 40 * s, xMax = w - 40 * s;
      target.x = clamp(target.x, xMin, xMax);
      target.y = Math.min(target.y, convY - 28 * s);

      const baseX = w * 0.46, baseY = floorY - 4 * s;
      const sx = baseX, sy = baseY - 78 * s, l1 = 128 * s, l2 = 114 * s;
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
        for (let n = 0; n < 3; n++) {
          ctx.fillStyle = n % 2 ? "#E8EEF4" : "#C5D0DC";
          ctx.beginPath(); ctx.ellipse(ox, 16 * s + (n + 0.5) * (cupH / 3), cupW * (1 - n * 0.06), cupH / 5.2, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#4A5A6A";
        ctx.beginPath(); ctx.ellipse(ox, 16 * s + cupH, cupW + 1.5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (held) {
        const hs = sizeOf(held);
        board(0, 16 * s + cupH + 2.2 * s + hs.bh / 2, hs.bw, hs.bh, held === "stringer");
      }
      ctx.restore();

      if (belt) {
        const sz = sizeOf(belt.kind);
        board(belt.x, beltTop - sz.bh / 2, sz.bw, sz.bh, belt.kind === "stringer");
      }

      const senX = pickX, senY = convY - 34 * s;
      const busy = atSensor || phase === "down" || phase === "grip";
      ctx.fillStyle = "#1E2A38"; rr(senX - 10 * s, senY, 20 * s, 14 * s, 3); ctx.fill();
      ctx.fillStyle = busy ? "#FF3B3B" : "#2FD37A";
      ctx.beginPath(); ctx.arc(senX, senY + 7 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = busy ? "rgba(255,70,70,.7)" : "rgba(47,211,122,.45)";
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(senX, senY + 14 * s); ctx.lineTo(senX, convY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = busy ? "#ffb4b4" : "#b7f0d0";
      ctx.font = "700 " + 9 * s + "px Manrope,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(busy ? "ДАТЧИК" : "ДАТЧИК", senX, senY - 6 * s);

      const crateDrawX = crateX + (binSlide > 0 ? binSlide * 180 * s : 0);
      if (binSlide < 1.4) drawCrate(crateDrawX, crateBottom, s, bin);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (e) { /* фон не должен ломать тест */ }
}
window.startFactory = startFactory;
