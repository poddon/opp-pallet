/* Сертификат по итогам теста ОПП.
   Фон cert-bg.jpg — шаблон «Сертификат» без ФИО и процента (2666×1836, 200 dpi).
   Выдаётся только при результате от CERT_MIN_PCT %. */
(function () {
  var CERT_MIN_PCT = 70;
  var W = 2666, H = 1836;            // размер фона в пикселях
  var PX = 200 / 72;                  // пунктов -> пикселей (200 dpi)
  var X0 = 96;                        // левое поле текста (438785 EMU)
  var FIO_MID = 1267;                 // середина строки ФИО (Text 6, anchor=ctr)
  var PCT_BASE = 1490;                // базовая линия строки с процентом (3-я строка блока Course)
  var INK = "#1A1A1A", BLUE = "#0C6FF1";
  var FONT = 'Arial, "Liberation Sans", Helvetica, sans-serif';

  var bg = null, bgReady = null;
  function loadBg() {
    if (bgReady) return bgReady;
    function withSrc(src, resolve, reject) {
      var img = new Image();
      img.onload = function () { bg = img; resolve(img); };
      img.onerror = reject;
      img.src = src;
    }
    bgReady = new Promise(function (resolve, reject) {
      if (window.OPP_CERT_BG) return withSrc(window.OPP_CERT_BG, resolve, reject);
      var s = document.createElement("script");
      s.src = "cert-bg.js?v=1";
      s.onload = function () { withSrc(window.OPP_CERT_BG, resolve, reject); };
      s.onerror = function () { bgReady = null; reject(new Error("cert-bg")); };
      document.head.appendChild(s);
    });
    return bgReady;
  }

  function fitFont(ctx, text, weight, sizePt, maxW) {
    var px = sizePt * PX;
    ctx.font = weight + " " + px + "px " + FONT;
    while (ctx.measureText(text).width > maxW && px > 20) {
      px -= 2;
      ctx.font = weight + " " + px + "px " + FONT;
    }
  }

  function draw(name, pct) {
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    ctx.drawImage(bg, 0, 0, W, H);
    // ФИО
    ctx.fillStyle = INK;
    ctx.textBaseline = "middle";
    fitFont(ctx, name, "bold", 20, 1330);
    ctx.fillText(name, X0, FIO_MID);
    // Результат
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold " + 14 * PX + "px " + FONT;
    var label = "Результат итогового тестирования: ";
    ctx.fillText(label, X0, PCT_BASE);
    ctx.fillText(pct + "%", X0 + ctx.measureText(label).width, PCT_BASE);
    return c;
  }

  /* Минимальный PDF: одна страница с JPEG-картинкой во весь лист. */
  function pdfFromJpeg(bytes, wPx, hPx) {
    var wPt = (wPx / 200 * 72).toFixed(2), hPt = (hPx / 200 * 72).toFixed(2);
    var enc = new TextEncoder();
    var parts = [], offsets = [], len = 0;
    function add(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; }
    function obj(n, body) { offsets[n] = len; add(n + " 0 obj\n"); body(); add("\nendobj\n"); }
    add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, function () { add("<< /Type /Catalog /Pages 2 0 R >>"); });
    obj(2, function () { add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); });
    obj(3, function () {
      add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + wPt + " " + hPt + "] " +
          "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    });
    obj(4, function () {
      add("<< /Type /XObject /Subtype /Image /Width " + wPx + " /Height " + hPx +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + bytes.length + " >>\nstream\n");
      add(bytes); add("\nendstream");
    });
    var content = "q " + wPt + " 0 0 " + hPt + " 0 0 cm /Im0 Do Q";
    obj(5, function () { add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"); });
    var xref = len;
    var x = "xref\n0 6\n0000000000 65535 f \n";
    for (var i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    add(x + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF");
    return new Blob(parts, { type: "application/pdf" });
  }

  function dataUrlBytes(url) {
    var b64 = url.split(",")[1], bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function save(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  var TR = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
  function translit(s) {
    return String(s).split("").map(function (ch) {
      var lo = ch.toLowerCase(), t = TR[lo];
      if (t === undefined) return ch;
      return ch !== lo && t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    }).join("");
  }
  function fileBase(name) {
    var n = translit(name).replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
    return "Sertifikat_OPP" + (n ? "_" + n : "");
  }

  window.OPP_CERT = {
    MIN: CERT_MIN_PCT,
    preload: loadBg,
    canvas: function (name, pct) { return loadBg().then(function () { return draw(name, pct); }); },
    downloadPdf: function (name, pct) {
      return this.canvas(name, pct).then(function (c) {
        var jpg = dataUrlBytes(c.toDataURL("image/jpeg", 0.92));
        save(pdfFromJpeg(jpg, c.width, c.height), fileBase(name) + ".pdf");
      });
    },
    downloadPng: function (name, pct) {
      return this.canvas(name, pct).then(function (c) {
        return new Promise(function (res) { c.toBlob(function (b) { save(b, fileBase(name) + ".png"); res(); }, "image/png"); });
      });
    }
  };
})();

/* Блок сертификата на экране результата */
(function () {
  function $(id) { return document.getElementById(id); }
  var cur = null;
  window.OPP_CERT_UI = function (name, pct) {
    var box = $("certbox"); if (!box) return;
    cur = { name: String(name || "").trim(), pct: Number(pct) || 0 };
    box.classList.remove("hidden");
    $("certerr").textContent = "";
    var ok = cur.pct >= OPP_CERT.MIN && cur.name;
    $("certok").classList.toggle("hidden", !ok);
    $("certno").classList.toggle("hidden", !!ok);
    if (ok) OPP_CERT.preload().catch(function () {});
    else $("certno").textContent = "Сертификат выдаётся при результате от " + OPP_CERT.MIN + "%. Ваш результат — " + cur.pct + "%.";
  };
  function run(btn, fn) {
    if (!cur) return;
    var b = $(btn), t = b.textContent;
    b.disabled = true; b.textContent = "Готовлю файл…";
    fn(cur.name, cur.pct).catch(function () {
      $("certerr").textContent = "Не удалось собрать сертификат. Обновите страницу и попробуйте ещё раз.";
    }).then(function () { b.disabled = false; b.textContent = t; });
  }
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "certpdf") run("certpdf", OPP_CERT.downloadPdf.bind(OPP_CERT));
    if (e.target && e.target.id === "certpng") run("certpng", OPP_CERT.downloadPng.bind(OPP_CERT));
  });
})();
