(function () {
  const ADMIN = "лукьянчиков егор игоревич";
  const PASS = "Qwerty123*";
  const TMAX = 55;
  const KEY = "opp_results_v2";
  const ACC_KEY = "opp_access_v1";
  const ASG_KEY = "opp_assigns_v1";
  const IDS = ["1"];
  const AB = "https://abacus.jasoncameron.dev";
  const ABNS = "opp-pallet";
  const ABTOK = { "1": "96ae5f9d-549c-42b6-870d-a54ab46e150e" };
  let remoteGroup = {};

  function $(id) { return document.getElementById(id); }
  function normG(s) { return (s || "").trim().replace(/\s+/g, " ").toUpperCase(); }
  function show(id) {
    ["boot", "start", "cabinet", "quiz", "result", "admin"].forEach((n) => {
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
      return Object.assign({ "1": false }, JSON.parse(localStorage.getItem(ACC_KEY) || "{}"));
    } catch { return { "1": false }; }
  }
  function saveAcc(a) { localStorage.setItem(ACC_KEY, JSON.stringify(a)); }
  function loadAsg() {
    try { return JSON.parse(localStorage.getItem(ASG_KEY) || "[]"); } catch { return []; }
  }
  function saveAsg(a) { localStorage.setItem(ASG_KEY, JSON.stringify(a)); }

  function gkey(group, id) {
    let h = 2166136261;
    const s = normG(group);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "g" + (h >>> 0).toString(16) + "m" + id;
  }
  function gtokStore() {
    try { return JSON.parse(localStorage.getItem("opp_abacus_gkeys") || "{}"); } catch { return {}; }
  }
  function gtokSave(m) { localStorage.setItem("opp_abacus_gkeys", JSON.stringify(m)); }

  async function abGet(key) {
    const r = await fetch(AB + "/get/" + ABNS + "/" + key + "?t=" + Date.now());
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j && j.value) || 0;
  }
  async function abSet(key, token, value) {
    const r = await fetch(AB + "/set/" + ABNS + "/" + key + "?value=" + (value ? 1 : 0), {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    return r.ok;
  }

  async function pullAccess() {
    try {
      const acc = { "1": false };
      await Promise.all(IDS.map(async (id) => {
        acc[id] = (await abGet("module" + id)) >= 1;
      }));
      saveAcc(acc);
      if (group) {
        const next = {};
        await Promise.all(IDS.map(async (id) => {
          const v = await abGet(gkey(group, id));
          next[id] = v >= 1;
        }));
        remoteGroup = next;
      }
    } catch (e) {}
  }

  async function pushModule(id, open) {
    await abSet("module" + id, ABTOK[id], open);
    const acc = loadAcc(); acc[id] = !!open; saveAcc(acc);
  }

  async function pushGroup(g, id, open) {
    const key = gkey(g, id);
    const keys = gtokStore();
    if (!keys[key]) {
      try {
        const cr = await fetch(AB + "/create/" + ABNS + "/" + key + "?initializer=" + (open ? 1 : 0));
        const j = await cr.json();
        if (j && j.admin_key) { keys[key] = j.admin_key; gtokSave(keys); }
      } catch (e) {}
    }
    if (keys[key]) await abSet(key, keys[key], open);
    remoteGroup[id] = !!open;
  }

  function canOpen(groupName, id) {
    const g = normG(groupName);
    if (loadAcc()[id]) return true;
    if (remoteGroup[id]) return true;
    const asg = loadAsg().filter((x) => normG(x.group) === g && String(x.id) === String(id));
    if (asg.length) return !!asg[asg.length - 1].open;
    return false;
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
    const t0 = c.currentTime, dur = 9, end = t0 + dur;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.95, t0 + 0.04);
    master.gain.setValueAtTime(0.95, end - 0.5);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(c.destination);

    const horn = c.createOscillator(); horn.type = "square";
    const horn2 = c.createOscillator(); horn2.type = "square";
    horn.frequency.setValueAtTime(98, t0); horn2.frequency.setValueAtTime(196, t0);
    const hg = c.createGain(); hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.exponentialRampToValueAtTime(0.38, t0 + 0.02);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    horn.connect(hg); horn2.connect(hg); hg.connect(master);
    horn.start(t0); horn2.start(t0); horn.stop(t0 + 0.6); horn2.stop(t0 + 0.6);

    const lo = c.createOscillator(); lo.type = "square";
    const hi = c.createOscillator(); hi.type = "square";
    const lg = c.createGain(); const hg2 = c.createGain();
    lg.gain.value = 0.0001; hg2.gain.value = 0.0001;
    lo.connect(lg); hi.connect(hg2); lg.connect(master); hg2.connect(master);
    lo.frequency.value = 392; hi.frequency.value = 523.25;
    let onHi = true;
    for (let t = t0 + 0.45; t < end - 0.2; t += 0.32) {
      if (onHi) {
        hg2.gain.setValueAtTime(0.0001, t); hg2.gain.linearRampToValueAtTime(0.28, t + 0.02);
        hg2.gain.setValueAtTime(0.28, t + 0.26); hg2.gain.exponentialRampToValueAtTime(0.0001, t + 0.31);
        lg.gain.setValueAtTime(0.0001, t);
      } else {
        lg.gain.setValueAtTime(0.0001, t); lg.gain.linearRampToValueAtTime(0.3, t + 0.02);
        lg.gain.setValueAtTime(0.3, t + 0.26); lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.31);
        hg2.gain.setValueAtTime(0.0001, t);
      }
      onHi = !onHi;
    }
    lo.start(t0); hi.start(t0); lo.stop(end); hi.stop(end);

    const bell = c.createOscillator(); bell.type = "triangle";
    const bg = c.createGain(); bg.gain.value = 0.0001;
    bell.connect(bg); bg.connect(master);
    bell.frequency.value = 1760;
    for (let t = t0 + 0.2; t < end - 0.3; t += 0.95) {
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.16, t + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    }
    bell.start(t0); bell.stop(end);

    const nbuf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const data = nbuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = nbuf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 4;
    const ng = c.createGain(); ng.gain.value = 0.07;
    noise.connect(bp); bp.connect(ng); ng.connect(master);
    noise.start(t0); noise.stop(end);
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

  function persist(row) {
    if (saved) return;
    saved = true;
    const all = load(); all.unshift(row); save(all);
  }
  function finish(status) {
    live = false; clearInterval(timer);
    const total = qs.length;
    const pct = status === "СПИСЫВАНИЕ" ? 0 : Math.round(correctN / Math.max(1, total) * 100);
    persist({
      date: new Date().toLocaleString("ru-RU"), name: fio, group, modules: mod,
      status, correct: status === "СПИСЫВАНИЕ" ? 0 : correctN, total, pct,
      xp: status === "СПИСЫВАНИЕ" ? 0 : xp,
      duration: Math.round((Date.now() - started) / 1000)
    });
    if (status === "СПИСЫВАНИЕ") {
      if ($("cheatwho")) $("cheatwho").textContent = (fio + " · " + group).toUpperCase();
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
      b.innerHTML = '<div class="ico">' + (open ? "✓" : "🔒") + "</div><div><strong>" + m.title + "</strong><div class='sub'>" +
        (open ? (last ? m.topic + " · последний результат " + last.pct + "%" : m.topic) : "Не назначен вашей группе") + "</div></div>";
      b.onclick = () => begin(id);
      box.appendChild(b);
    });
  }

  function begin(id) {
    if (!canOpen(group, id)) { $("caberr").textContent = "Модуль не открыт для вашей группы."; return; }
    mod = id; saved = false; started = Date.now();
    live = true;
    qs = prepare(id); idx = 0; locked = false; correctN = 0; xp = 0; streak = 0; left = TMAX;
    $("qm").textContent = MODULES[id].title;
    $("strip").textContent = "Смешанный контроль по материалу модулей";
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
      b.onclick = () => {
        const next = !acc[id];
        acc[id] = next;
        saveAcc(acc);
        if ($("accmsg")) $("accmsg").textContent = "Сохраняю…";
        pushModule(id, next).then(() => pullAccess()).then(() => {
          if ($("accmsg")) $("accmsg").textContent = next ? (MODULES[id].title + " открыт для всех студентов.") : (MODULES[id].title + " закрыт.");
          refreshAdmin();
        });
      };
      $("accbtns").appendChild(b);
    });
    if ($("accbtns"));
    const asg = loadAsg();
    $("asopen").innerHTML = ""; $("asclose").innerHTML = "";
    IDS.forEach((id) => {
      const o = document.createElement("button"); o.type = "button"; o.className = "btn ghost"; o.textContent = "Открыть тест";
      o.onclick = () => {
        const g = normG($("agrp").value);
        if (!g) { if ($("accmsg")) $("accmsg").textContent = "Сначала укажите направление и группу."; return; }
        $("agrp").value = g;
        asg.push({ group: g, id, open: true }); saveAsg(asg);
        if ($("accmsg")) $("accmsg").textContent = "Сохраняю…";
        pushGroup(g, id, true).then(() => pullAccess()).then(() => {
          if ($("accmsg")) $("accmsg").textContent = MODULES[id].title + " открыт для " + g + ".";
          refreshAdmin();
        });
      };
      $("asopen").appendChild(o);
      const c = document.createElement("button"); c.type = "button"; c.className = "btn ghost"; c.textContent = "Закрыть тест";
      c.onclick = () => {
        const g = normG($("agrp").value);
        if (!g) { if ($("accmsg")) $("accmsg").textContent = "Сначала укажите направление и группу."; return; }
        $("agrp").value = g;
        asg.push({ group: g, id, open: false }); saveAsg(asg);
        if ($("accmsg")) $("accmsg").textContent = "Сохраняю…";
        pushGroup(g, id, false).then(() => pullAccess()).then(() => {
          if ($("accmsg")) $("accmsg").textContent = MODULES[id].title + " закрыт для " + g + ".";
          refreshAdmin();
        });
      };
      $("asclose").appendChild(c);
    });
    $("alist").innerHTML = asg.length ? asg.slice(-12).reverse().map((a) => "<li>" + a.group + " · модуль " + a.id + " · " + (a.open ? "открыт" : "закрыт") + "</li>").join("") : "<li>Пока нет назначений</li>";
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
    group = normG($("group").value);
    $("group").value = group;
    if (!fio || !group) {
      if ($("starterr")) $("starterr").textContent = "Заполните ФИО и группу.";
      return;
    }
    if ($("starterr")) $("starterr").textContent = "";
    if (fio.toLowerCase().replace(/\s+/g, " ") === ADMIN) {
      if ($("pwd").value !== PASS) { $("pwderr").textContent = "Неверный пароль"; return; }
      refreshAdmin(); show("admin"); return;
    }
    pullAccess().then(() => { renderCab(); show("cabinet"); });
  };
  $("cabback").onclick = () => show("start");
  $("again").onclick = () => { show("start"); mod = null; };
  if ($("rescab")) $("rescab").onclick = () => { pullAccess().then(() => { renderCab(); show("cabinet"); }); };
  $("back").onclick = () => show("start");
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
  pullAccess();
  setInterval(() => {
    const cab = $("cabinet");
    if (cab && !cab.classList.contains("hidden")) pullAccess().then(renderCab);
  }, 6000);
})();
