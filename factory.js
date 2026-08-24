window.OPP_FACTORY = { cue: "idle", cueUntil: 0 };
function startFactory() {
  try {
    const canvas = document.getElementById("fx");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const mobile = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 820;
    const img = new Image();
    img.src = "kuka.webp";
    let stamp = null, w = 0, h = 0, skip = 0, bots = [];
    function makeStamp() {
      if (!img.complete || img.naturalWidth < 10) return;
      const sw = 160, sh = Math.round(160 * img.naturalHeight / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, sw, sh);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, sw, sh);
      stamp = c;
    }
    function seed() {
      bots = [];
      const n = mobile ? 14 : 22;
      for (let i = 0; i < n; i++) {
        bots.push({
          x: Math.random() * Math.max(w, 1),
          y: Math.random() * Math.max(h, 1),
          s: 0.28 + Math.random() * 0.5,
          a: 0.07 + Math.random() * 0.11,
          sp: 8 + Math.random() * 14,
          flip: Math.random() < 0.5,
          ph: Math.random() * Math.PI * 2
        });
      }
    }
    function resize() {
      const dpr = mobile ? 1 : Math.min(devicePixelRatio || 1, 1.6);
      w = canvas.clientWidth || innerWidth;
      h = canvas.clientHeight || innerHeight;
      if (!w || !h) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bots.length) seed();
    }
    function drawBotGeom(x, y, sc, flip) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flip ? -sc : sc, sc);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(0, 38, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-10, 8, 20, 28);
      ctx.beginPath(); ctx.arc(0, 6, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(4, -6, 28, 8);
      ctx.fillRect(28, -22, 8, 20);
      ctx.fillRect(22, -28, 20, 8);
      ctx.restore();
    }
    function frame(now) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (mobile && (++skip & 1)) { requestAnimationFrame(frame); return; }
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0A2F5C");
      sky.addColorStop(0.45, "#1457A8");
      sky.addColorStop(0.78, "#7EB6E8");
      sky.addColorStop(1, "#E8F3FF");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      if (!stamp && img.complete) makeStamp();
      const dt = 0.016;
      bots.forEach(function (b) {
        b.y -= b.sp * dt;
        b.x += Math.sin(now / 900 + b.ph) * 0.12;
        if (b.y < -90) { b.y = h + 70; b.x = Math.random() * w; }
        const bw = (stamp ? stamp.width : 70) * b.s;
        const bh = (stamp ? stamp.height : 100) * b.s;
        ctx.save();
        ctx.globalAlpha = b.a;
        if (stamp) {
          if (b.flip) {
            ctx.translate(b.x, b.y);
            ctx.scale(-1, 1);
            ctx.drawImage(stamp, -bw / 2, 0, bw, bh);
          } else {
            ctx.drawImage(stamp, b.x - bw / 2, b.y, bw, bh);
          }
        } else {
          drawBotGeom(b.x, b.y + 20, b.s * 1.4, b.flip);
        }
        ctx.restore();
      });
      requestAnimationFrame(frame);
    }
    img.onload = makeStamp;
    addEventListener("resize", resize);
    resize();
    seed();
    requestAnimationFrame(frame);
  } catch (e) {}
}
