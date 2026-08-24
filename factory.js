window.OPP_FACTORY = { cue: "idle", cueUntil: 0 };
function startFactory() {
  try {
    const canvas = document.getElementById("fx");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const mobile = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 820;
    const img = new Image();
    img.src = "shop.webp";
    let w = 0, h = 0, skip = 0;
    function resize() {
      const dpr = mobile ? 1 : Math.min(devicePixelRatio || 1, 1.75);
      w = canvas.clientWidth || innerWidth;
      h = canvas.clientHeight || innerHeight;
      if (!w || !h) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function frame(now) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (mobile && (++skip & 1)) { requestAnimationFrame(frame); return; }
      ctx.fillStyle = "#E8EEF4";
      ctx.fillRect(0, 0, w, h);
      if (img.complete && img.naturalWidth > 10) {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const zoom = 1.07 + Math.sin(now / 9000) * 0.025;
        const panX = Math.sin(now / 12500) * 0.028;
        const panY = Math.cos(now / 15000) * 0.018;
        const scale = Math.max(w / iw, h / ih) * zoom;
        const dw = iw * scale, dh = ih * scale;
        const dx = (w - dw) / 2 + panX * w;
        const dy = (h - dh) / 2 + panY * h;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(0, 0, w, h);
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "rgba(248,252,255,0.18)");
        g.addColorStop(0.5, "rgba(255,255,255,0.04)");
        g.addColorStop(1, "rgba(10,47,92,0.16)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      requestAnimationFrame(frame);
    }
    addEventListener("resize", resize);
    resize();
    requestAnimationFrame(frame);
  } catch (e) {}
}
