(function (w) {
  const IDS = ["1", "2", "3", "4"];
  const SLIDE_W = 7680;
  const SLIDE_H = 5429;
  const FIO = { t: 3602, l: 1430, r: 4003, b: 3730 };
  const SIGN = { t: 4613, l: 2366, r: 4039, b: 5263 };
  const A4W = 841.89;
  const A4H = 595.28;

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

  function jpegToPdf(jpeg, imgW, imgH) {
    const enc = (s) => new TextEncoder().encode(s);
    const parts = [];
    let offset = 0;
    const xref = [0];
    const push = (u8) => { parts.push(u8); offset += u8.length; };
    const str = (s) => push(enc(s));
    str("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    function obj(n, dict, stream) {
      xref[n] = offset;
      if (stream) {
        str(n + " 0 obj\n" + dict + "\nstream\n");
        push(stream);
        str("\nendstream\nendobj\n");
      } else {
        str(n + " 0 obj\n" + dict + "\nendobj\n");
      }
    }
    const content = "q " + A4W + " 0 0 " + A4H + " 0 0 cm /Im0 Do Q\n";
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + A4W + " " + A4H + "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    obj(4, "<< /Type /XObject /Subtype /Image /Width " + imgW + " /Height " + imgH + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>", jpeg);
    obj(5, "<< /Length " + content.length + " >>", enc(content));
    const xrefPos = offset;
    str("xref\n0 6\n0000000000 65535 f \n");
    for (let i = 1; i <= 5; i++) str(String(xref[i]).padStart(10, "0") + " 00000 n \n");
    str("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n");
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return new Blob([out], { type: "application/pdf" });
  }

  function canvasJpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) { reject(new Error("jpeg")); return; }
        b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      }, "image/jpeg", 0.92);
    });
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

  function fileName(fio) {
    return "Сертификат_Робоподдоны_" + String(fio).trim().replace(/\s+/g, "_") + ".pdf";
  }

  async function downloadCertificate(fio, pct) {
    const c = await drawCertificate(fio, pct);
    const jpeg = await canvasJpeg(c);
    const blob = jpegToPdf(jpeg, c.width, c.height);
    const a = document.createElement("a");
    a.download = fileName(fio);
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function autoKey(fio, group) {
    return "opp_pdf_" + String(fio).trim().toLowerCase() + "_" + String(group).trim().toLowerCase();
  }

  async function autoDownloadOnce(fio, group, pct) {
    if (pct == null) return false;
    const k = autoKey(fio, group);
    try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, "1"); } catch (e) {}
    await downloadCertificate(fio, pct);
    return true;
  }

  w.OPP_CERT = { overallFromRows, drawCertificate, downloadCertificate, autoDownloadOnce };
})(window);
