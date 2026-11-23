"use strict";

const studentPath = "/api/student/";
const studentGroup = $("studentGroup");
const studentTest = $("studentTest");
const storeKey = "opp.currentAttempt";
let consentVersion = "";
let current = null;
let position = 0;
let secondsUntil = 0;
let lastStatus = "";
let pending = false;
let flaggedDuringRequest = false;
let nextPoll = 0;
let testCounts = new Map();

function showQuestionCount() {
  $("questionCount").textContent = testCounts.get(studentTest.value) ?? "—";
}

async function loadGroups() {
  try {
    const data = await api(studentPath + "groups");
    consentVersion = data.version;
    $("consentText").textContent = data.consent;
    options(studentGroup, data.groups, "Выберите группу");
    const available = Boolean(data.version && data.groups.length);
    $("entry").hidden = !available;
    $("refreshGroups").hidden = available;
    $("availability").textContent = available ? "" : data.groups.length
      ? "Тест открыт. Дождитесь, пока преподаватель настроит согласие, и обновите список."
      : "Сейчас нет открытых тестов. Обновите список после открытия теста преподавателем.";
    $("message").textContent = "";
    await loadTests();
  } catch (error) {
    $("message").textContent = error.message;
    $("refreshGroups").hidden = false;
  }
}

async function loadTests() {
  const group = studentGroup.value;
  options(studentTest, [], "Выберите тест");
  testCounts = new Map();
  showQuestionCount();
  const testField = $("studentTestField");
  testField.hidden = true;
  studentTest.required = false;
  if (!group) return;
  try {
    const tests = await api(studentPath + "tests?" + new URLSearchParams({group}));
    if (studentGroup.value !== group) return;
    options(studentTest, tests.map(t => ({
      label: t.title + " · " + t.questions + " вопр. · до " + dateFormat.format(new Date(t.closes)) + " МСК",
      value: String(t.id)
    })), tests.length ? "Выберите тест" : "Нет открытых тестов");
    testCounts = new Map(tests.map(t => [String(t.id), t.questions]));
    if (tests.length === 1) {
      studentTest.value = String(tests[0].id);
      showQuestionCount();
    } else {
      testField.hidden = false;
      studentTest.required = true;
    }
  } catch (error) {
    $("message").textContent = error.message;
  }
}

function showAttempt(data) {
  $("registration").hidden = true;
  const live = data.status === "Проходит";
  $("taking").hidden = !live;
  $("finished").hidden = live;
  lastStatus = data.status;
  if (!live) {
    $("resultTitle").textContent = data.status === "СПИСЫВАНИЕ" ? "Попытка завершена. Зафиксирован выход со страницы" : data.status;
    $("score").textContent = "Верных ответов — " + data.score + " из " + data.total +
      " (" + Math.round(100 * data.score / data.total) + "%)";
    sessionStorage.removeItem(storeKey);
    return;
  }
  secondsUntil = Date.now() + 1000 * data.seconds;
  paintClock();
  if (position === data.position) return;
  position = data.position;
  $("position").textContent = "Вопрос " + position + " из " + data.total;
  $("progress").max = data.total;
  $("progress").value = position;
  $("question").textContent = data.text;
  $("submitAnswer").disabled = true;
  $("choices").replaceChildren(...data.choices.map((text, i) => {
    const label = document.createElement("label");
    label.className = "choice";
    const field = document.createElement("input");
    field.type = "radio";
    field.name = "choice";
    field.value = i;
    label.append(field, document.createTextNode(text));
    return label;
  }));
}

async function send(operation, fields = {}) {
  if (!current || pending) return;
  pending = true;
  $("start").disabled = true;
  $("skip").disabled = true;
  $("submitAnswer").disabled = true;
  try {
    showAttempt(await api(studentPath + "attempt", {...current, operation, ...fields}));
    $("message").textContent = "";
  } catch (error) {
    if (operation === "start" && error.status === 412) {
      $("entry").elements.consent.checked = false;
      await loadGroups();
      $("consentText").closest("details").open = true;
    }
    $("message").textContent = error.message;
    if (error.status === 404 || (operation === "start" && error.status >= 400 && error.status < 500)) {
      current = null;
      sessionStorage.removeItem(storeKey);
    }
  } finally {
    pending = false;
    nextPoll = Date.now() + 4000;
    $("start").disabled = false;
    $("skip").disabled = false;
    $("submitAnswer").disabled = !$("answer").elements.choice?.value;
    if (flaggedDuringRequest && current && lastStatus === "Проходит") {
      flaggedDuringRequest = false;
      void send("flag");
    }
  }
}

function paintClock() {
  const left = Math.max(0, Math.ceil((secondsUntil - Date.now()) / 1000));
  $("timer").textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
  return left;
}

$("refreshGroups").addEventListener("click", loadGroups);
studentGroup.addEventListener("change", loadTests);
studentTest.addEventListener("change", showQuestionCount);
$("entry").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const assignment = Number(form.get("assignment"));
  if (!assignment) {
    $("message").textContent = "Выберите группу с открытым тестом.";
    return;
  }
  const name = form.get("name");
  if (current?.assignment !== assignment) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    current = {token, assignment};
    sessionStorage.setItem(storeKey, JSON.stringify(current));
  }
  void send("start", {name, group: form.get("group"), consent: form.get("consent") === "on" ? consentVersion : "", rules: form.get("rules") === "on"});
});
$("choices").addEventListener("change", () => { $("submitAnswer").disabled = pending; });
$("answer").addEventListener("submit", event => {
  event.preventDefault();
  const choice = new FormData(event.currentTarget).get("choice");
  if (choice !== null) void send("answer", {position, choice: Number(choice)});
});
$("skip").addEventListener("click", () => { void send("answer", {position, choice: null}); });
$("back").addEventListener("click", () => {
  current = null;
  position = 0;
  lastStatus = "";
  $("finished").hidden = true;
  $("registration").hidden = false;
  void loadGroups();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !current || lastStatus !== "Проходит") return;
  flaggedDuringRequest = pending;
  const payload = new Blob([JSON.stringify({...current, operation: "flag"})], {type: "application/json"});
  if (!navigator.sendBeacon(studentPath + "attempt", payload) && !pending) void send("flag");
});
setInterval(() => {
  if (lastStatus !== "Проходит") return;
  const left = paintClock();
  if (Date.now() >= nextPoll || (left === 0 && Date.now() + 3500 >= nextPoll)) {
    void send("status");
  }
}, 500);

try { current = JSON.parse(sessionStorage.getItem(storeKey)); } catch { current = null; }
void loadGroups();
if (current) void send("status");
