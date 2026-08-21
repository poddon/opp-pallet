(function (w) {
  const IDS = ["1", "2", "3", "4"];
  const SLIDE_W = 12192000;
  const SLIDE_H = 8618538;
  const FIO = { x: 2113821, y: 5496535, w: 4961430, h: 492443 };
  const SIGN = { x: 3756007, y: 7323881, w: 2656114, h: 1031021 };

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("no " + src));
      img.src = src;
    });
  }

  function overallFromRows(rows, name, group) {
    const best = {};
    rows.forEach((r) => {
      if (r.status !== "Пройден") return;
      if (r.name !== name || r.group !== group) return;
      const id = String(r.modules);
      if (best[id] == null || r.pct > best[id]) best[id] = r.pct;
    });
    if (!IDS.every((id) => best[id] != null)) return null;
    return Math.round((best["1"] + best["2"] + best["3"] + best["4"]) / 4);
  }

  function emuX(v, W) { return (v / SLIDE_W) * W; }
  function emuY(v, H) { return (v / SLIDE_H) * H; }

  async function drawCertificate(fio, pct) {
    const bg = await loadImg("cert-bg.jpg");
    const sign = await loadImg("cert-sign.png");
    const c = document.createElement("canvas");
    c.width = bg.naturalWidth;
    c.height = bg.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(bg, 0, 0);
    const W = c.width, H = c.height;
    const x = emuX(FIO.x, W);
    const y = emuY(FIO.y, H);
    const bw = emuX(FIO.w, W);
    const bh = emuY(FIO.h, H);
    const fontPx = Math.round(W * 26 / 960);
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "middle";
    ctx.font = "700 " + fontPx + "px Arial, Helvetica, sans-serif";
    const cy = y + bh / 2;
    ctx.textAlign = "left";
    ctx.fillText(String(fio || "").trim(), x, cy, bw * 0.72);
    ctx.textAlign = "right";
    ctx.fillText(String(pct) + "%", x + bw, cy);
    const sx = emuX(SIGN.x, W);
    const sy = emuY(SIGN.y, H);
    const sw = emuX(SIGN.w, W);
    const sh = emuY(SIGN.h, H);
    ctx.drawImage(sign, sx, sy, sw, sh);
    return c;
  }

  async function downloadCertificate(fio, pct) {
    const c = await drawCertificate(fio, pct);
    const a = document.createElement("a");
    a.download = "Сертификат_Робоподдоны_" + String(fio).replace(/\s+/g, "_") + ".png";
    a.href = c.toDataURL("image/png");
    a.click();
  }

  w.OPP_CERT = { overallFromRows, drawCertificate, downloadCertificate };
})(window);
