(function (w) {
  const IDS = ["1", "2", "3", "4"];
  const SLIDE_W = 7680;
  const SLIDE_H = 5429;
  const FIO = { t: 3602, l: 1430, r: 4003, b: 3730 };
  const SIGN = { t: 4613, l: 2366, r: 4039, b: 5263 };

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

  function box(spec, W, H) {
    return {
      x: (spec.l / SLIDE_W) * W,
      y: (spec.t / SLIDE_H) * H,
      w: ((spec.r - spec.l) / SLIDE_W) * W,
      h: ((spec.b - spec.t) / SLIDE_H) * H,
    };
  }

  async function drawCertificate(fio, pct) {
    const bg = await loadImg("cert-bg.jpg");
    const sign = await loadImg("cert-sign.png");
    const c = document.createElement("canvas");
    c.width = bg.naturalWidth;
    c.height = bg.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(bg, 0, 0);
    const W = c.width, H = c.height;
    const f = box(FIO, W, H);
    const s = box(SIGN, W, H);
    const fontPx = Math.round((W * 26) / 960);
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "middle";
    ctx.font = "700 " + fontPx + "px Arial, Helvetica, sans-serif";
    const cy = f.y + f.h / 2;
    ctx.textAlign = "left";
    ctx.fillText(String(fio || "").trim(), f.x, cy, f.w * 0.78);
    ctx.textAlign = "right";
    ctx.fillText(String(pct) + "%", f.x + f.w, cy);
    ctx.drawImage(sign, s.x, s.y, s.w, s.h);
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
