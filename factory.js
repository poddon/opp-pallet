window.OPP_FACTORY = { cue: "idle", cueUntil: 0 };
function startFactory() {
  try {
    const M = window.Matter;
    const canvas = document.getElementById("fx");
    if (!canvas || !M) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const { Engine, Bodies, Body, Composite, Events } = M;
    const mobile = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 820;
    let w = 0, h = 0, t0 = performance.now(), skip = 0, s = 1;
    const KINDS = ["stringer", "stringer", "stringer", "deck", "deck", "deck", "deck", "deck"];
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const unwrap = (from, to) => {
      let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + d;
    };
    function accel1d(pos, vel, goal, dt, vmax, amax) {
      const d = goal - pos;
      if (Math.abs(d) < 0.6 && Math.abs(vel) < 6) return { pos: goal, vel: 0 };
      const stop = (vel * vel) / (2 * Math.max(amax, 1e-4));
      const same = vel * d > 0;
      let a;
      if (same && stop >= Math.abs(d)) a = -Math.sign(vel) * amax;
      else a = Math.sign(d || 1) * amax;
      vel = clamp(vel + a * dt, -vmax, vmax);
      pos += vel * dt;
      if (d * (goal - pos) <= 0) return { pos: goal, vel: 0 };
      return { pos, vel };
    }

    const engine = Engine.create();
    engine.world.gravity.y = 1.05;
    engine.positionIterations = 8;
    engine.velocityIterations = 6;
    const world = engine.world;

    let beltBody, crateParts = [], boards = [];
    let conv = { x: 0, y: 0, len: 0, pickX: 0, spawnX: 0, park: 0, top: 0 };
    let crateX = 0, crateOut = false, nextKind = 0, firstBoard = true;
    let phase = "wait", phaseT = 0, held = null, a1 = -2.4, a2 = 2.1, gripVis = 0.12;
    let aimX = 0, aimY = 0, vAimX = 0, vAimY = 0, aimReady = false, crateV = 0;
    const DUR = { wait: 0.18, down: 0.55, grip: 0.5, up: 0.55, move: 1.05, downPlace: 0.52, release: 0.32, upPlace: 0.5 };

    function sz(kind) {
      return kind === "stringer" ? { bw: 86 * s, bh: 12 * s } : { bw: 78 * s, bh: 9 * s };
    }
    function resize() {
      const dpr = mobile ? 1 : Math.min(devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth || innerWidth;
      h = canvas.clientHeight || innerHeight;
      if (!w || !h) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s = Math.min(w, h) / 520;
      layoutWorld();
    }
    function layoutWorld() {
      Composite.clear(world, false, true);
      boards = [];
      const floorY = h * 0.82;
      conv.x = w * 0.04;
      conv.len = w * 0.92;
      conv.y = floorY - 52 * s;
      conv.top = conv.y - 2 * s;
      conv.pickX = conv.x + conv.len * 0.28;
      conv.spawnX = conv.x + 40 * s;
      conv.park = conv.x + conv.len * 0.68;
      crateX = conv.park;
      crateOut = false;
      beltBody = Bodies.rectangle(conv.x + conv.len / 2, conv.y + 10 * s, conv.len, 18 * s, {
        isStatic: true, friction: 1, frictionStatic: 1, restitution: 0.02, label: "belt",
      });
      const ground = Bodies.rectangle(w / 2, h + 40, w * 2, 80, { isStatic: true, label: "ground" });
      Composite.add(world, [beltBody, ground]);
      buildCrate(conv.park);
      firstBoard = true;
      nextKind = 0;
      held = null;
      phase = "wait";
      phaseT = 0;
      aimReady = false;
      vAimX = 0; vAimY = 0; crateV = 0;
    }
    function buildCrate(x) {
      crateParts.forEach((p) => Composite.remove(world, p));
      const cw = 118 * s, ch = 40 * s;
      const y = conv.top - 6 * s;
      const opts = { isStatic: true, friction: 0.95, frictionStatic: 1, restitution: 0.12, label: "crate" };
      crateParts = [
        Bodies.rectangle(x, y, cw - 8 * s, 10 * s, opts),
        Bodies.rectangle(x - cw / 2 + 5 * s, y - ch / 2, 10 * s, ch, opts),
        Bodies.rectangle(x + cw / 2 - 5 * s, y - ch / 2, 10 * s, ch, opts),
      ];
      Composite.add(world, crateParts);
      crateX = x;
    }
    function moveCrate(nx) {
      const dx = nx - crateX;
      crateParts.forEach((p) => Body.translate(p, { x: dx, y: 0 }));
      boards.forEach((b) => {
        if (b.inCrate) Body.translate(b.body, { x: dx, y: 0 });
      });
      crateX = nx;
    }
    function spawnBoard(x, kind, opts) {
      const d = sz(kind);
      const body = Bodies.rectangle(x, conv.top - d.bh / 2 - 1, d.bw, d.bh, {
        density: 0.0018,
        friction: 0.85,
        frictionStatic: 0.9,
        restitution: 0.2,
        chamfer: { radius: 2 },
        angle: 0,
        label: kind,
        slop: 0.04,
      });
      if (opts && opts.vy != null) Body.setVelocity(body, { x: opts.vx || 0, y: opts.vy });
      if (opts && opts.spin) Body.setAngularVelocity(body, opts.spin);
      Composite.add(world, body);
      const rec = { body, kind, inCrate: false, onBelt: true };
      boards.push(rec);
      return rec;
    }
    function boardOnBelt() {
      return boards.find((b) => !b.inCrate && b !== held);
    }

    resize();
    addEventListener("resize", resize);

    Events.on(engine, "beforeUpdate", () => {
      const vmax = 5.6, acc = 0.2;
      const occupied = boards.some((b) => !b.inCrate && Math.abs(b.body.position.x - conv.pickX) < 10 * s);
      boards.forEach((b) => {
        const p = b.body.position;
        const on = !b.inCrate && p.x < conv.pickX + 24 * s;
        b.onBelt = on;
        const here = Math.abs(p.x - conv.pickX) < 10 * s;
        if (on && !here) {
          const dist = conv.pickX - 4 * s - p.x;
          let vx = b.body.velocity.x;
          const stop = (vx * vx) / (2 * acc);
          if (occupied && stop >= dist) vx = Math.max(0.05, vx - acc);
          else vx = Math.min(vmax, vx + acc);
          Body.setVelocity(b.body, { x: vx, y: Math.min(b.body.velocity.y, 0.2) });
          Body.setAngularVelocity(b.body, b.body.angularVelocity * 0.85);
        }
        if (on && here && !held) {
          const vx = b.body.velocity.x;
          if (vx > 0.12) Body.setVelocity(b.body, { x: vx * 0.72, y: 0 });
          else {
            Body.setVelocity(b.body, { x: 0, y: 0 });
            Body.setPosition(b.body, { x: conv.pickX, y: conv.top - sz(b.kind).bh / 2 });
            Body.setAngle(b.body, 0);
            Body.setAngularVelocity(b.body, 0);
          }
        }
        if (b.inCrate && crateOut) {
          Body.setVelocity(b.body, { x: Math.min(5.2, b.body.velocity.x + 0.14), y: b.body.velocity.y });
        }
      });
    });

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
    function drawBoardBody(body, kind) {
      const d = sz(kind);
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      const g = ctx.createLinearGradient(0, -d.bh / 2, 0, d.bh / 2);
      g.addColorStop(0, kind === "stringer" ? "#8B5A2A" : "#E8B86A");
      g.addColorStop(1, kind === "stringer" ? "#5A3514" : "#A86A28");
      ctx.fillStyle = g; rr(-d.bw / 2, -d.bh / 2, d.bw, d.bh, 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = 1; ctx.stroke();
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

    function waitingBoard() {
      return boards.find((b) => !b.inCrate && Math.abs(b.body.position.x - conv.pickX) < 10 * s);
    }
    function crateCount() {
      return boards.filter((b) => b.inCrate).length;
    }

    function frame(now) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (mobile && (++skip & 1)) { requestAnimationFrame(frame); return; }
      const dt = Math.min(0.033, (now - t0) / 1000); t0 = now;
      Engine.update(engine, dt * 1000);

      const floorY = h * 0.82;
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
      ctx.fillStyle = "#163E6B"; ctx.fillRect(0, floorY, w, h - floorY);
      for (let x = 0; x < w; x += 28) {
        ctx.fillStyle = x % 56 === 0 ? "#E8B020" : "#111";
        ctx.fillRect(x, floorY, 14, 8);
      }

      const frameH = 20 * s;
      for (let lx = conv.x + 16 * s; lx < conv.x + conv.len - 12 * s; lx += 64 * s) {
        ctx.fillStyle = "#3A4E64"; ctx.fillRect(lx, conv.y + frameH - 2 * s, 7 * s, floorY - (conv.y + frameH) + 2 * s);
        ctx.fillStyle = "#243446"; ctx.fillRect(lx - 7 * s, floorY - 5 * s, 21 * s, 5 * s);
      }
      ctx.fillStyle = "#3E546C"; rr(conv.x, conv.y, conv.len, frameH, 3); ctx.fill();
      ctx.fillStyle = "#24364A"; ctx.fillRect(conv.x + 5 * s, conv.y + 3 * s, conv.len - 10 * s, 13 * s);
      ctx.fillStyle = "#E8B020"; ctx.fillRect(conv.x, conv.y - 3 * s, conv.len, 4 * s);
      const nRoll = Math.max(8, Math.floor((conv.len - 24 * s) / (15 * s)));
      const wait = waitingBoard();
      const spin = now / 55;
      for (let i = 0; i < nRoll; i++) {
        const rx = conv.x + 16 * s + i * 15 * s;
        ctx.fillStyle = "#8FA3B8";
        ctx.beginPath(); ctx.ellipse(rx, conv.y + 10 * s, 6 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        if (spin) {
          ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(rx, conv.y + 10 * s, 2.4 * s, spin + i, spin + i + 1.4); ctx.stroke();
        }
      }

      if (!boardOnBelt() && !held && phase === "wait" && !crateOut) {
        spawnBoard(conv.spawnX, KINDS[nextKind % KINDS.length], { vx: 2.8 });
        firstBoard = false;
      }
      if (!boardOnBelt() && held && (phase === "up" || phase === "move") && !crateOut) {
        spawnBoard(conv.spawnX, KINDS[nextKind % KINDS.length], { vx: 2.8 });
      }

      const travelY = conv.y - 78 * s;
      const cupReach = (g) => 16 * s + lerp(15 * s, 6 * s, g);
      const wristAt = (top, g) => top - cupReach(g);
      const workKind = held ? held.kind : (wait ? wait.kind : "deck");
      const work = sz(workKind);
      const pickTop = conv.top - work.bh;
      const placeX = crateX;
      const crateLip = conv.top - 48 * s;
      const placeTop = crateLip - 10 * s;

      boards.forEach((b) => {
        if (!b.inCrate && b.body.position.x > crateX - 60 * s && b.body.position.y < conv.top + 8 * s && b.body.position.x < crateX + 60 * s && b.body.position.y > conv.top - 50 * s && phase !== "grip") {
          if (Math.abs(b.body.position.x - crateX) < 50 * s && b.body.position.y > conv.top - 40 * s) b.inCrate = true;
        }
      });
      if (!crateOut && crateCount() >= 8) crateOut = true;
      if (crateOut) {
        crateV = Math.min(320 * s, crateV + 420 * s * dt);
        moveCrate(crateX + crateV * dt);
        if (crateX > conv.x + conv.len + 90 * s) {
          boards.filter((b) => b.inCrate).forEach((b) => Composite.remove(world, b.body));
          boards = boards.filter((b) => !b.inCrate);
          crateOut = false;
          crateV = 0;
          buildCrate(conv.park);
        }
      } else crateV = 0;

      let grip = 0.12;
      let target = { x: conv.pickX, y: travelY };
      if (phase === "down" || phase === "grip") {
        target = { x: conv.pickX, y: wristAt(pickTop, phase === "grip" ? 1 : 0.12) };
        if (phase === "grip") grip = 1;
      } else if (phase === "up") {
        grip = 1; target = { x: conv.pickX, y: travelY };
      } else if (phase === "move") {
        grip = 1; target = { x: placeX, y: travelY - 16 * s };
      } else if (phase === "downPlace" || phase === "release") {
        grip = phase === "release" ? 0.12 : 1;
        target = { x: placeX, y: wristAt(placeTop, grip) };
      } else if (phase === "upPlace") {
        target = { x: placeX, y: travelY };
      }

      if (window.OPP_FACTORY.cue === "drop" && now < window.OPP_FACTORY.cueUntil && held) {
        const rec = spawnBoard(aimX, held.kind, { vx: 1.2, vy: 0.8, spin: 0.12 });
        Body.setPosition(rec.body, { x: aimX, y: aimY + 18 * s });
        held = null; grip = 0.1; phase = "wait"; phaseT = 0; vAimX = 0; vAimY = 0;
      }
      target.x = clamp(target.x, conv.x + 40 * s, conv.x + conv.len - 40 * s);
      if (phase === "move" || phase === "up" || phase === "upPlace" || phase === "wait") {
        target.y = Math.min(target.y, crateLip - 18 * s);
      }
      target.y = Math.min(target.y, conv.y - 36 * s);
      if (!aimReady) { aimX = target.x; aimY = target.y; aimReady = true; vAimX = 0; vAimY = 0; }
      const vmax = 280 * s, amax = 360 * s;
      const nx = accel1d(aimX, vAimX, target.x, dt, vmax, amax);
      const ny = accel1d(aimY, vAimY, target.y, dt, vmax * 0.9, amax);
      aimX = nx.pos; vAimX = nx.vel;
      aimY = ny.pos; vAimY = ny.vel;
      const arrived = Math.hypot(aimX - target.x, aimY - target.y) < 5 * s && Math.hypot(vAimX, vAimY) < 18 * s;

      if (!crateOut) {
        if (phase === "wait") {
          if (wait && !held) { phase = "down"; phaseT = 0; }
        } else if (phase === "grip" || phase === "release") {
          phaseT += dt / (phase === "grip" ? 0.48 : 0.34);
          if (phase === "grip" && !held && wait && phaseT > 0.35) {
            held = wait;
            Composite.remove(world, wait.body);
            boards = boards.filter((b) => b !== wait);
            nextKind += 1;
          }
          if (phase === "release" && held && phaseT > 0.12) {
            const rec = spawnBoard(placeX, held.kind, {
              vx: (Math.random() - 0.5) * 0.35,
              vy: 0.25,
              spin: (Math.random() - 0.5) * 0.05,
            });
            Body.setPosition(rec.body, { x: placeX, y: placeTop + work.bh / 2 });
            rec.inCrate = true;
            rec.onBelt = false;
            held = null;
          }
          if (phaseT >= 1) { phase = phase === "grip" ? "up" : "upPlace"; phaseT = 0; }
        } else if (arrived) {
          if (phase === "down") { phase = "grip"; phaseT = 0; }
          else if (phase === "up") phase = "move";
          else if (phase === "move") phase = "downPlace";
          else if (phase === "downPlace") { phase = "release"; phaseT = 0; }
          else if (phase === "upPlace") phase = "wait";
        }
      }

      const baseX = w * 0.42, baseY = floorY - 4 * s;
      const sx = baseX, sy = baseY - 78 * s, l1 = 128 * s, l2 = 114 * s;
      const ik = solve(aimX, aimY, sx, sy, l1, l2);
      const follow = 1 - Math.exp(-5.2 * dt);
      a1 = lerp(a1, unwrap(a1, ik.a1), follow);
      a2 = lerp(a2, unwrap(a2, ik.a2), follow);
      gripVis = lerp(gripVis, grip, 1 - Math.exp(-6 * dt));
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
        const d = sz(held.kind);
        const g2 = ctx.createLinearGradient(0, 16 * s + cupH, 0, 16 * s + cupH + d.bh);
        g2.addColorStop(0, held.kind === "stringer" ? "#8B5A2A" : "#E8B86A");
        g2.addColorStop(1, held.kind === "stringer" ? "#5A3514" : "#A86A28");
        ctx.fillStyle = g2;
        rr(-d.bw / 2, 16 * s + cupH + 2 * s, d.bw, d.bh, 2); ctx.fill();
      }
      ctx.restore();

      boards.forEach((b) => {
        if (held && b === held) return;
        drawBoardBody(b.body, b.kind);
      });

      const senX = conv.pickX, senY = conv.y - 34 * s;
      const busy = !!(wait || phase === "down" || phase === "grip");
      ctx.fillStyle = "#1E2A38"; rr(senX - 10 * s, senY, 20 * s, 14 * s, 3); ctx.fill();
      ctx.fillStyle = busy ? "#FF3B3B" : "#2FD37A";
      ctx.beginPath(); ctx.arc(senX, senY + 7 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = busy ? "rgba(255,70,70,.65)" : "rgba(47,211,122,.4)";
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(senX, senY + 14 * s); ctx.lineTo(senX, conv.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = busy ? "#ffb4b4" : "#b7f0d0";
      ctx.font = "700 " + 9 * s + "px Manrope,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ДАТЧИК", senX, senY - 6 * s);

      const cw = 118 * s, ch = 42 * s;
      const cLeft = crateX - cw / 2, cTop = conv.top - ch;
      ctx.fillStyle = "#6B3E18"; ctx.fillRect(cLeft + cw - 5 * s, cTop, 8 * s, ch);
      const cg = ctx.createLinearGradient(cLeft, cTop, cLeft, conv.top);
      cg.addColorStop(0, "rgba(196,122,50,.55)"); cg.addColorStop(1, "rgba(122,67,22,.55)");
      ctx.strokeStyle = "#E8B020"; ctx.lineWidth = 3;
      ctx.strokeRect(cLeft, cTop, cw, ch);
      ctx.fillStyle = "#E8B020";
      ctx.font = "800 " + 10 * s + "px Manrope,sans-serif";
      ctx.fillText("ТАРА", crateX, cTop - 9 * s);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (e) { /* фон не должен ломать тест */ }
}
window.startFactory = startFactory;
