(function () {
  const ADMIN = "лукьянчиков егор игоревич";
  const PASS = "Qwerty123*";
  const TMAX = 55;
  const KEY = "opp_results_v2";
  const ACC_KEY = "opp_access_v1";
  const ASG_KEY = "opp_assigns_v1";
  const QR_KEY = "opp_qr_v1";
  const IDS = ["1", "2", "3", "4"];

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ["boot", "start", "cabinet", "quiz", "scan", "result", "admin"].forEach((n) => {
      const el = $(n);
      if (el) el.classList.toggle("hidden", n !== id);
    });
    $("cheat").classList.add("hidden");
  }
  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  }
  function save(rows) { localStorage.setItem(KEY, JSON.stringify(rows)); }
  function loadAcc() {
    try {
      return Object.assign({ "1": false, "2": false, "3": false, "4": false }, JSON.parse(localStorage.getItem(ACC_KEY) || "{}"));
    } catch { return { "1": false, "2": false, "3": false, "4": false }; }
  }
  function saveAcc(a) { localStorage.setItem(ACC_KEY, JSON.stringify(a)); }
  function loadAsg() {
    try { return JSON.parse(localStorage.getItem(ASG_KEY) || "[]"); } catch { return []; }
  }
  function saveAsg(a) { localStorage.setItem(ASG_KEY, JSON.stringify(a)); }
  function qrToken() { return (localStorage.getItem(QR_KEY) || "OPP-M2-LINEOK01").toUpperCase(); }
  function setQr(t) { localStorage.setItem(QR_KEY, t); }

  function canOpen(group, id) {
    const g = (group || "").trim().toUpperCase();
    const asg = loadAsg().filter((x) => x.group === g && x.id === id);
    if (asg.length) return !!asg[asg.length - 1].open;
    return !!loadAcc()[id];
  }

  function prepare(id) {
    const src = (window.MODULES && MODULES[id] && MODULES[id].questions) || [];
    return shuffle(src).map((q) => {
      const order = shuffle(q.a.map((_, i) => i));
      return { q: q.q, a: order.map((i) => q.a[i]), correct: order.indexOf(q.i) };
    });
  }

  let ac;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function tone(f, d, type, g, at) {
    const c = audio();
    const o = c.createOscillator();
    const v = c.createGain();
    o.type = type; o.frequency.value = f;
    v.gain.setValueAtTime(0.0001, c.currentTime + at);
    v.gain.exponentialRampToValueAtTime(g, c.currentTime + at + 0.02);
    v.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + d);
    o.connect(v); v.connect(c.destination);
    o.start(c.currentTime + at); o.stop(c.currentTime + at + d + 0.02);
  }
  function sfxOk() { tone(523, 0.09, "sine", 0.08, 0); tone(784, 0.12, "sine", 0.07, 0.07); }
  function sfxBad() { tone(180, 0.22, "sawtooth", 0.06, 0); }
  function siren() {
    const c = audio();
    const t0 = c.currentTime, end = t0 + 8;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.42, t0 + 0.06);
    master.gain.setValueAtTime(0.42, end - 0.55);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(c.destination);
    const wail = c.createOscillator(); wail.type = "sawtooth";
    const g1 = c.createGain(); g1.gain.value = 0.22; wail.connect(g1); g1.connect(master);
    let t = t0, up = true; wail.frequency.setValueAtTime(420, t0);
    while (t < end) { wail.frequency.linearRampToValueAtTime(up ? 920 : 360, t + 0.72); t += 0.72; up = !up; }
    wail.start(t0); wail.stop(end);
    const beep = c.createOscillator(); beep.type = "square"; beep.frequency.value = 1480;
    const bg = c.createGain(); bg.gain.value = 0.0001; beep.connect(bg); bg.connect(master);
    for (let bt = t0 + 0.1; bt < end - 0.2; bt += 0.28) {
      bg.gain.setValueAtTime(0.0001, bt); bg.gain.linearRampToValueAtTime(0.09, bt + 0.02);
      bg.gain.setValueAtTime(0.09, bt + 0.07); bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.14);
    }
    beep.start(t0); beep.stop(end);
    const rumble = c.createOscillator(); rumble.type = "sine"; rumble.frequency.value = 48;
    const rg = c.createGain(); rg.gain.value = 0.18; rumble.connect(rg); rg.connect(master);
    rumble.start(t0); rumble.stop(end);
  }
  function speak() {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const say = (delay) => setTimeout(() => {
      const u = new SpeechSynthesisUtterance("Вы списали. Обратитесь к преподавателю.");
      u.lang = "ru-RU"; u.volume = 1; u.rate = 0.92;
      speechSynthesis.speak(u);
    }, delay);
    say(400); say(3200);
  }

  let mod = null, qs = [], idx = 0, locked = false;
  let correctN = 0, xp = 0, streak = 0, left = TMAX, timer = null;
  let live = false, saved = false, started = 0, fio = "", group = "";
  let camStream = null, scanLock = false;

  function persist(row) {
    if (saved) return;
    saved = true;
    const all = load(); all.unshift(row); save(all);
  }
  function finish(status) {
    live = false; clearInterval(timer); stopCam();
    const total = qs.length || (mod === "2" ? 1 : 0);
    const pct = status === "СПИСЫВАНИЕ" ? 0 : Math.round(correctN / Math.max(1, total) * 100);
    persist({
      date: new Date().toLocaleString("ru-RU"), name: fio, group, modules: mod,
      status, correct: status === "СПИСЫВАНИЕ" ? 0 : correctN, total, pct,
      xp: status === "СПИСЫВАНИЕ" ? 0 : xp,
      duration: Math.round((Date.now() - started) / 1000)
    });
    if (status === "СПИСЫВАНИЕ") {
      $("cheat").classList.remove("hidden");
      siren(); speak();
      return;
    }
    $("rpct").textContent = pct + "%";
    $("rname").textContent = fio;
    $("rgroup").textContent = group;
    $("rc").textContent = correctN;
    $("rt").textContent = total;
    $("rx").textContent = xp;
    show("result");
  }

  function watchCheat() {
    const hide = () => { if (live) { live = false; finish("СПИСЫВАНИЕ"); } };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hide();
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("copy", (e) => e.preventDefault());
  }

  function renderCab() {
    $("cabwho").textContent = fio + " · " + group;
    $("caberr").textContent = "";
    const box = $("cabmods");
    box.innerHTML = "";
    IDS.forEach((id) => {
      const m = MODULES[id];
      const open = canOpen(group, id);
      const last = load().find((r) => r.name === fio && r.group === group && r.modules === id && r.status === "Пройден");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mod" + (open ? " on" : "");
      b.disabled = !open;
      b.innerHTML = '<div class="ico ' + (id === "2" ? "m" : id === "3" ? "g" : id === "4" ? "p" : "") + '">' + (open ? id : "🔒") + "</div><div><strong>" + m.title + "</strong><div class='sub'>" +
        (open ? (last ? m.topic + " · последний результат " + last.pct + "%" : m.topic) : "Не назначен вашей группе") + "</div></div>";
      b.onclick = () => begin(id);
      box.appendChild(b);
    });
  }

  function begin(id) {
    if (!canOpen(group, id)) { $("caberr").textContent = "Модуль не открыт для вашей группы."; return; }
    mod = id; saved = false; started = Date.now();
    if (id === "2") { scanLock = false; $("scanmsg").textContent = "Ищем код линии…"; show("scan"); startCam(); return; }
    live = true;
    qs = prepare(id); idx = 0; locked = false; correctN = 0; xp = 0; streak = 0; left = TMAX;
    $("qm").textContent = MODULES[id].title;
    $("strip").textContent = id === "1" ? "Манипулятор укладывает слой" : id === "3" ? "Считаем такт и маржу" : "Сигналы идут по шине";
    show("quiz"); renderQ(); timer = setInterval(tick, 1000);
  }

  function tick() {
    left -= 1;
    $("qt").textContent = "0:" + String(Math.max(0, left)).padStart(2, "0");
    if (left <= 0) answer(-1);
  }
  function renderQ() {
    const q = qs[idx];
    $("qn").textContent = "Вопрос " + (idx + 1) + " / " + qs.length;
    $("qv").textContent = "Верно: " + correctN;
    $("qtext").textContent = q.q;
    $("pb").style.width = (idx / qs.length * 100) + "%";
    $("qx").textContent = "XP " + xp;
    $("qs").classList.toggle("hidden", streak < 2);
    $("qs").textContent = "серия " + streak;
    $("verdict").classList.add("hidden");
    $("strip").className = "strip";
    $("opts").innerHTML = "";
    q.a.forEach((t, i) => {
      const b = document.createElement("button");
      b.className = "opt"; b.type = "button"; b.textContent = t;
      b.onclick = () => answer(i);
      $("opts").appendChild(b);
    });
  }
  function answer(choice) {
    if (locked) return;
    locked = true; clearInterval(timer);
    const q = qs[idx];
    const ok = choice === q.correct;
    [...$("opts").children].forEach((b, i) => {
      if (i === q.correct) b.classList.add("ok");
      else if (i === choice) b.classList.add("bad");
      else b.classList.add("dim");
      b.disabled = true;
    });
    $("verdict").textContent = ok ? "Верно" : (choice < 0 ? "Время" : "Неверно");
    $("verdict").className = "verdict " + (ok ? "ok" : "bad");
    $("strip").className = "strip " + (ok ? "ok" : "bad");
    $("strip").textContent = ok ? "Доска легла точно" : "Захват сорвался";
    if (ok) {
      sfxOk(); if (window.OPP_FACTORY) { OPP_FACTORY.cue = "place"; OPP_FACTORY.cueUntil = performance.now() + 900; }
      const bonus = Math.max(8, Math.round(left / TMAX * 20));
      streak += 1; correctN += 1; xp += 12 + bonus + (streak >= 3 ? streak * 2 : 0);
    } else {
      sfxBad(); if (window.OPP_FACTORY) { OPP_FACTORY.cue = "drop"; OPP_FACTORY.cueUntil = performance.now() + 900; }
      streak = 0;
    }
    setTimeout(() => {
      if (idx + 1 >= qs.length) finish("Пройден");
      else { idx += 1; locked = false; left = TMAX; renderQ(); timer = setInterval(tick, 1000); }
    }, 1150);
  }

  function stopCam() {
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  }
  function normQr(raw) {
    let s = String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
    const m = s.match(/OPP-M2-[A-Z0-9]{8,24}/);
    return m ? m[0] : s;
  }
  function confirmQr(payload) {
    if (scanLock) return;
    const got = normQr(payload);
    const expect = qrToken();
    if (!/^OPP-M2-[A-Z0-9]{8,24}$/.test(got)) { $("scanmsg").textContent = "Формат QR неверный. Нужен код с линии."; return; }
    if (got !== expect) { $("scanmsg").textContent = "Этот QR не действует. Нужен актуальный код с линии."; return; }
    if (!canOpen(group, "2")) { $("scanmsg").textContent = "Модуль 2 не открыт для вашей группы."; return; }
    scanLock = true; stopCam();
    sfxOk();
    correctN = 1; xp = 50; qs = [{ q: "", a: [], correct: 0 }];
    finish("Пройден");
  }
  function startCam() {
    const video = $("cam");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then((stream) => {
      camStream = stream; video.srcObject = stream; video.play();
      const BD = window.BarcodeDetector;
      const det = BD ? new BD({ formats: ["qr_code"] }) : null;
      const tick = () => {
        if (!camStream || scanLock) return;
        if (det && video.readyState >= 2) {
          det.detect(video).then((codes) => { if (codes[0] && codes[0].rawValue) confirmQr(codes[0].rawValue); }).catch(() => {});
        }
        setTimeout(tick, 280);
      };
      tick();
    }).catch(() => { $("scanmsg").textContent = "Разрешите камеру, чтобы подтвердить выход на линию."; });
  }

  function refreshAdmin() {
    const rows = load();
    const ok = rows.filter((r) => r.status === "Пройден");
    const cheat = rows.filter((r) => r.status === "СПИСЫВАНИЕ").length;
    const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.pct, 0) / ok.length) : 0;
    $("astats").innerHTML =
      "<div class='stat'><b>" + rows.length + "</b><span>попыток</span></div>" +
      "<div class='stat'><b>" + ok.length + "</b><span>успешных</span></div>" +
      "<div class='stat'><b>" + cheat + "</b><span>списываний</span></div>" +
      "<div class='stat'><b>" + avg + "%</b><span>средний %</span></div>";
    $("abody").innerHTML = rows.length
      ? rows.map((r) => "<tr><td>" + r.date + "</td><td>" + r.name + "</td><td>" + r.pct + "</td><td>" + r.status + "</td></tr>").join("")
      : "<tr><td colspan='4'>Пока нет прохождений на этом устройстве</td></tr>";
    const acc = loadAcc();
    $("accbtns").innerHTML = "";
    IDS.forEach((id) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mod" + (acc[id] ? " on" : "");
      b.innerHTML = "<div><strong>" + MODULES[id].title + "</strong><div class='sub'>" + (acc[id] ? "Открыт для студентов" : "Закрыт") + "</div></div>";
      b.onclick = () => { acc[id] = !acc[id]; saveAcc(acc); refreshAdmin(); };
      $("accbtns").appendChild(b);
    });
    const asg = loadAsg();
    $("asopen").innerHTML = ""; $("asclose").innerHTML = "";
    IDS.forEach((id) => {
      const o = document.createElement("button"); o.type = "button"; o.className = "btn ghost"; o.textContent = "Открыть " + id;
      o.onclick = () => {
        const g = $("agrp").value.trim().toUpperCase(); if (!g) return;
        asg.push({ group: g, id, open: true }); saveAsg(asg); refreshAdmin();
      };
      $("asopen").appendChild(o);
      const c = document.createElement("button"); c.type = "button"; c.className = "btn ghost"; c.textContent = "Закрыть " + id;
      c.onclick = () => {
        const g = $("agrp").value.trim().toUpperCase(); if (!g) return;
        asg.push({ group: g, id, open: false }); saveAsg(asg); refreshAdmin();
      };
      $("asclose").appendChild(c);
    });
    $("alist").innerHTML = asg.length ? asg.slice(-12).reverse().map((a) => "<li>" + a.group + " · модуль " + a.id + " · " + (a.open ? "открыт" : "закрыт") + "</li>").join("") : "<li>Пока нет назначений</li>";
    const tok = qrToken();
    $("qrtxt").textContent = tok;
    $("qrimg").src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=H&data=" + encodeURIComponent(tok);
    $("qrgen").href = "https://qrcoder.ru/?t=t&s=8&d=" + encodeURIComponent(tok);
  }

  $("fio").addEventListener("input", () => {
    const admin = $("fio").value.trim().toLowerCase().replace(/\s+/g, " ") === ADMIN;
    $("pwdbox").classList.toggle("hidden", !admin);
    $("go").textContent = admin ? "Войти в панель" : "Войти в LMS";
  });
  $("group").addEventListener("input", () => { $("group").value = $("group").value.toUpperCase(); });
  $("agrp") && $("agrp").addEventListener("input", () => { $("agrp").value = $("agrp").value.toUpperCase(); });

  $("go").onclick = () => {
    try { audio(); } catch (e) {}
    fio = $("fio").value.trim();
    group = $("group").value.trim().toUpperCase();
    $("group").value = group;
    if (!fio || !group) return;
    if (fio.toLowerCase().replace(/\s+/g, " ") === ADMIN) {
      if ($("pwd").value !== PASS) { $("pwderr").textContent = "Неверный пароль"; return; }
      refreshAdmin(); show("admin"); return;
    }
    renderCab(); show("cabinet");
  };
  $("cabback").onclick = () => show("start");
  $("scanback").onclick = () => { stopCam(); show("cabinet"); };
  $("again").onclick = () => { show("start"); mod = null; };
  if ($("rescab")) $("rescab").onclick = () => { renderCab(); show("cabinet"); };
  $("back").onclick = () => show("start");
  $("camfile").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!window.BarcodeDetector) { $("scanmsg").textContent = "Этот браузер не читает QR. Откройте Chrome на телефоне."; return; }
    createImageBitmap(file).then((bmp) => new window.BarcodeDetector({ formats: ["qr_code"] }).detect(bmp)).then((codes) => {
      if (codes[0] && codes[0].rawValue) confirmQr(codes[0].rawValue);
      else $("scanmsg").textContent = "QR на фото не найден.";
    }).catch(() => { $("scanmsg").textContent = "Не удалось разобрать фото."; });
  };
  $("qrdl").onclick = () => {
    const url = "https://api.qrserver.com/v1/create-qr-code/?size=800x800&ecc=H&data=" + encodeURIComponent(qrToken());
    fetch(url).then((r) => r.blob()).then((blob) => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "QR-modul-2.png"; a.click();
    }).catch(() => window.open(url, "_blank"));
  };
  $("qrrot").onclick = () => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    setQr("OPP-M2-" + hex);
    refreshAdmin();
  };
  $("exp").onclick = () => {
    const rows = load().filter((r) => r.status !== "СПИСЫВАНИЕ");
    const head = "Дата;ФИО;Группа;Модуль;Статус;Верных;Всего;%;XP;Сек";
    const body = rows.map((r) => [r.date, r.name, r.group, r.modules, r.status, r.correct, r.total, r.pct, r.xp, r.duration].join(";"));
    const blob = new Blob(["\uFEFF" + [head].concat(body).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "результаты.csv"; a.click();
  };

  if (typeof startFactory === "function") {
    try { startFactory(); } catch (e) {}
  }
  watchCheat();
  (function boot() {
    const fast = Math.min(innerWidth, innerHeight) < 820;
    const steps = fast
      ? [[0, 20, "Питание ячейки…"], [400, 60, "Загрузка модулей…"], [900, 100, "Готово к смене"]]
      : [
          [0, 6, "Питание ячейки…"],
          [700, 22, "Калибровка осей KUKA…"],
          [1500, 44, "Проверка вакуумного захвата…"],
          [2300, 67, "Загрузка модулей теста…"],
          [3200, 86, "Синхронизация линии…"],
          [4000, 100, "Готово к смене"],
        ];
    steps.forEach(([t, p, m]) => setTimeout(() => {
      $("bootmsg").textContent = m;
      $("bootpct").textContent = p + "%";
      $("bootbar").style.width = p + "%";
    }, t));
    setTimeout(() => show("start"), fast ? 1400 : 4600);
  })();
})();
