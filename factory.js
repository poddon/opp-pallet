window.OPP_FACTORY = { cue: "idle", cueUntil: 0 };
function startFactory() {
    const canvas = document.getElementById("fx");
    const ctx = canvas.getContext("2d", { alpha: false });
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
      if (window.OPP_FACTORY.cue === "drop" && now < window.OPP_FACTORY.cueUntil) { wantHold = false; grip = 0.1; justPlaced = false; holdKind = null; gripped = false; }
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


window.startFactory = startFactory;
