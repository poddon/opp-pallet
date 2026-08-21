(function (w) {
  const IDS = ["1", "2", "3", "4"];

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

  async function drawCertificate(fio, pct, group) {
    const bg = await loadImg("cert-bg.jpg");
    const sign = await loadImg("cert-sign.png");
    const c = document.createElement("canvas");
    c.width = bg.naturalWidth;
    c.height = bg.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(bg, 0, 0, c.width, c.height);
    const W = c.width, H = c.height;

    ctx.fillStyle = "#111111";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "700 " + Math.round(W * 0.026) + "px Arial, sans-serif";
    const name = String(fio || "").trim();
    ctx.fillText(name, W * 0.185, H * 0.652, W * 0.36);

    ctx.textAlign = "right";
    ctx.font = "700 " + Math.round(W * 0.024) + "px Arial, sans-serif";
    ctx.fillText(pct + "%", W * 0.58, H * 0.652);

    const sw = W * 0.2, sh = sw * (sign.naturalHeight / sign.naturalWidth);
    ctx.drawImage(sign, W * 0.32, H * 0.80, sw, sh);
    return c;
  }

  async function downloadCertificate(fio, pct, group) {
    const c = await drawCertificate(fio, pct, group);
    const a = document.createElement("a");
    a.download = "Сертификат_Робоподдоны_" + String(fio).replace(/\s+/g, "_") + ".png";
    a.href = c.toDataURL("image/png");
    a.click();
  }

  w.OPP_CERT = { overallFromRows, drawCertificate, downloadCertificate };
})(window);
