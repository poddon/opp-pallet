/* Жёсткий антисписывание для теста ОПП.
   Работает только во время прохождения теста (после старта вопроса).

   Что ловит и сразу завершает тест со статусом «СПИСАНО»:
   - уход со вкладки / сворачивание / переключение приложений;
   - потерю фокуса окна: всплывающие (плавающие) окна Samsung, разделённый экран,
     Алиса, Google Ассистент, «Обвести для поиска», шторка уведомлений;
   - уменьшение окна (режим pop-up / split screen на Samsung);
   - выход из полноэкранного режима;
   - касание тремя и более пальцами (жест скриншота / ладонь);
   - клавиши PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5, F12, Ctrl+P, Ctrl+S;
   - «заморозку» страницы (браузер усыплён в фоне).

   Что блокирует: выделение текста, копирование, вставку, перетаскивание,
   контекстное меню и долгое нажатие (Google Lens), печать.

   Скриншот на телефоне (кнопки питание + громкость) сайт технически запретить
   не может — поэтому поверх вопроса идёт водяной знак с ФИО, группой и временем:
   любой «слитый» скриншот однозначно указывает, чей он. */
(function () {
  "use strict";

  var AC = function () { return window.OPP_AC || null; };
  var armed = function () { var a = AC(); return !!(a && a.armed()); };
  var flag = function (why) { var a = AC(); if (a && a.armed()) a.flag(why); };

  /* ---------- 1. Стили: запрет выделения, долгого нажатия, водяной знак ---------- */
  var css = document.createElement("style");
  css.textContent = [
    "#quiz, #quiz * { -webkit-user-select: none !important; user-select: none !important;",
    "  -webkit-touch-callout: none !important; -webkit-user-drag: none !important; }",
    "#quiz img { pointer-events: none; }",
    "body.ac-on { overscroll-behavior: none; touch-action: manipulation; }",
    "#ac-wm { position: fixed; inset: -50%; z-index: 40; pointer-events: none; display: none;",
    "  transform: rotate(-28deg); opacity: .10; font: 700 15px/2.4 system-ui, sans-serif; color: #0B1B36;",
    "  white-space: nowrap; overflow: hidden; word-spacing: 1.2em; }",
    "body.ac-on #ac-wm { display: block; }",
    "@media print { body { display: none !important; } }",
    "#ac-warn { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 70;",
    "  background: #C4141C; color: #fff; font: 700 14px/1.3 system-ui, sans-serif; padding: 10px 16px;",
    "  border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25); display: none; max-width: 92vw; text-align: center; }"
  ].join("\n");
  document.head.appendChild(css);

  var wm = document.createElement("div");
  wm.id = "ac-wm";
  wm.setAttribute("aria-hidden", "true");
  var warn = document.createElement("div");
  warn.id = "ac-warn";
  document.addEventListener("DOMContentLoaded", function () {
    document.body.appendChild(wm);
    document.body.appendChild(warn);
  });

  function stamp() {
    var a = AC(); if (!a) return;
    var w = a.who();
    var t = new Date().toLocaleString("ru-RU");
    var line = (w.fio + " · " + w.group + " · " + t + "   ").repeat(6);
    var rows = [];
    for (var i = 0; i < 60; i++) rows.push(i % 2 ? "   " + line : line);
    wm.textContent = "";
    wm.innerHTML = rows.map(function (r) { return "<div>" + r.replace(/</g, "&lt;") + "</div>"; }).join("");
  }

  var warnTimer = null;
  function showWarn(text) {
    warn.textContent = text;
    warn.style.display = "block";
    clearTimeout(warnTimer);
    warnTimer = setTimeout(function () { warn.style.display = "none"; }, 2500);
  }

  /* ---------- 2. Блокировки (всегда, но на тесте — особенно) ---------- */
  function block(e) {
    if (!armed() && !document.body.classList.contains("ac-on")) return;
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
  ["copy", "cut", "paste", "selectstart", "dragstart", "drop", "contextmenu"].forEach(function (ev) {
    document.addEventListener(ev, block, true);
  });
  window.addEventListener("beforeprint", function () { flag("Попытка печати страницы"); });

  /* ---------- 3. Клавиатура (ноутбуки и ПК) ---------- */
  document.addEventListener("keydown", function (e) {
    if (!armed()) return;
    var k = (e.key || "").toLowerCase();
    var ctrl = e.ctrlKey || e.metaKey;
    if (k === "printscreen" || e.keyCode === 44) { e.preventDefault(); flag("Попытка сделать скриншот"); return; }
    if (e.shiftKey && (e.metaKey || e.getModifierState && e.getModifierState("OS")) && (k === "s" || k === "3" || k === "4" || k === "5")) {
      e.preventDefault(); flag("Попытка сделать скриншот"); return;
    }
    if (k === "f12" || (ctrl && e.shiftKey && (k === "i" || k === "j" || k === "c"))) { e.preventDefault(); flag("Открытие инструментов разработчика"); return; }
    if (ctrl && (k === "c" || k === "x" || k === "v" || k === "a" || k === "s" || k === "p" || k === "u" || k === "f")) {
      e.preventDefault(); showWarn("Копирование и поиск во время теста запрещены"); return;
    }
    if (k === "meta" || k === "os" || k === "contextmenu") { showWarn("Не нажимайте системные клавиши"); }
  }, true);
  document.addEventListener("keyup", function (e) {
    if (!armed()) return;
    if ((e.key || "").toLowerCase() === "printscreen" || e.keyCode === 44) {
      try { navigator.clipboard && navigator.clipboard.writeText(""); } catch (x) {}
      flag("Попытка сделать скриншот");
    }
  }, true);

  /* ---------- 4. Жесты: три пальца / ладонь ---------- */
  document.addEventListener("touchstart", function (e) {
    if (!armed()) return;
    if (e.touches && e.touches.length >= 3) { e.preventDefault(); flag("Жест скриншота (три пальца)"); }
  }, { capture: true, passive: false });
  document.addEventListener("gesturestart", function (e) { if (armed()) e.preventDefault(); }, true);

  /* ---------- 5. Потеря фокуса: Алиса, Ассистент, всплывающие окна ---------- */
  var blurTimer = null;
  window.addEventListener("blur", function () {
    if (!armed()) return;
    // 400 мс — чтобы не реагировать на мгновенные системные события
    blurTimer = setTimeout(function () {
      if (!document.hasFocus()) flag("Открыто другое окно, ассистент или всплывающее окно");
    }, 400);
  });
  window.addEventListener("focus", function () { clearTimeout(blurTimer); });
  window.addEventListener("pagehide", function () { flag("Выход со страницы теста"); });
  document.addEventListener("freeze", function () { flag("Страница ушла в фон"); });

  /* ---------- 6. Размер окна: pop-up и разделённый экран ---------- */
  var base = null;
  function area() { return window.innerWidth * window.innerHeight; }
  function resetBase() { base = { w: window.innerWidth, h: window.innerHeight, a: area() }; }
  window.addEventListener("resize", function () {
    if (!armed() || !base) { resetBase(); return; }
    var w = window.innerWidth, h = window.innerHeight;
    var rotated = Math.abs(w - base.h) < 80 && Math.abs(h - base.w) < 160;
    if (rotated) { resetBase(); return; }
    if (area() < base.a * 0.8 || w < base.w * 0.8) {
      flag("Включён разделённый экран или всплывающее окно");
    } else if (area() > base.a) {
      resetBase();
    }
  });

  /* ---------- 7. Полноэкранный режим ---------- */
  var wasFS = false;
  function onFS() {
    var a = AC(); if (!a) return;
    if (a.isFS()) { wasFS = true; resetBase(); return; }
    if (wasFS && armed()) flag("Выход из полноэкранного режима");
    wasFS = false;
  }
  document.addEventListener("fullscreenchange", onFS);
  document.addEventListener("webkitfullscreenchange", onFS);

  /* ---------- 8. «Заморозка» страницы: таймер не тикал > 4 с ---------- */
  var last = Date.now();
  setInterval(function () {
    var now = Date.now();
    if (armed() && now - last > 4000) flag("Страница была свёрнута или заблокирована");
    last = now;
  }, 500);

  /* ---------- 9. Включение/выключение режима теста ---------- */
  var wasArmed = false;
  setInterval(function () {
    var on = armed();
    if (on && !wasArmed) {
      document.body.classList.add("ac-on");
      stamp(); resetBase();
      var a = AC(); wasFS = !!(a && a.isFS());
      try { window.getSelection().removeAllRanges(); } catch (x) {}
    }
    if (!on && wasArmed) {
      document.body.classList.remove("ac-on");
    }
    if (on && Date.now() % 30000 < 250) stamp(); // обновляем время в водяном знаке
    wasArmed = on;
  }, 200);
})();
