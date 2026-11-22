"use strict";

const adminPath = "/api/admin/";
const tabs = document.querySelectorAll("[data-tab]");
let tab = "open";
let filters = new URLSearchParams();
let page = 1;
let resultsRequest = 0;
let refreshing = false;
let canOpen = false;
const selectedGroups = new Map();

function showDashboard(visible) {
  $("dashboard").hidden = !visible;
  $("logout").hidden = !visible;
  $("login").hidden = visible;
  if (!visible && $("answerDetails").open) $("answerDetails").close();
}

function reportError(error) {
  $("message").textContent = error.message;
  if (error.status === 401) showDashboard(false);
}

async function loadSetup() {
  const setup = await api(adminPath + "setup");
  const tests = setup.tests.map(item => ({label: item.title, value: item.id}));
  const past = setup.pastTests.map(item => ({label: item.title, value: item.id}));
  options($("openTest"), setup.tests.map(item => ({
    label: item.title + " (вопросов: " + item.questions + ")", value: item.id
  })), "Выберите тест");
  options($("direction"), setup.directions, "Выберите направление");
  options($("existingGroup"), setup.groups, "Выберите группу");
  $("existingGroups").hidden = setup.groups.length === 0;
  options($("filterGroup"), setup.groups, "Все группы");
  options($("filterTest"), [...tests, ...past, {label: "Архивные тесты", value: "archive"}], "Все тесты");
  $("missingConsent").hidden = setup.consentConfigured;
  canOpen = setup.consentConfigured;
  $("openButton").disabled = !canOpen;
  showDashboard(true);
}

function table(id, rows, columns, empty) {
  const nodes = rows.map(values => {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      row.append(cell);
    }
    return row;
  });
  if (!nodes.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.textContent = empty;
    row.append(cell);
    nodes.push(row);
  }
  $(id).replaceChildren(...nodes);
}

function action(label, handler, kind = "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = kind;
  button.addEventListener("click", handler);
  return button;
}

function renderSelectedGroups() {
  $("emptyGroups").hidden = selectedGroups.size > 0;
  const items = Array.from(selectedGroups, ([code, entry]) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = entry ? entry.direction + " " + entry.number : code;
    const remove = action("Убрать", () => {
      selectedGroups.delete(code);
      renderSelectedGroups();
    });
    remove.setAttribute("aria-label", "Убрать " + label.textContent);
    row.append(label, remove);
    return row;
  });
  $("selectedGroups").replaceChildren(...items);
}

function addProgramGroups() {
  const direction = $("direction").value;
  const checkboxes = Array.from($("openForm").querySelectorAll("[name=groupNumber]"));
  const other = $("extraNumbers").value.trim().split(/[,\s]+/).filter(Boolean);
  const numbers = [...checkboxes.filter(box => box.checked).map(box => box.value), ...other];
  if (!direction || !numbers.length || numbers.some(number => !/^\d{2}-[1-9]\d*$/.test(number))) {
    throw new Error("Выберите направление и укажите номер группы в формате 26-1.");
  }
  for (const number of numbers) {
    const label = direction + " " + number;
    if (label.length > 80) throw new Error("Название группы слишком длинное.");
  }
  for (const number of numbers) {
    const code = (direction + " " + number).toUpperCase();
    selectedGroups.set(code, {direction, number});
  }
  for (const box of checkboxes) box.checked = false;
  $("extraNumbers").value = "";
  renderSelectedGroups();
}

function addExistingGroup() {
  const select = $("existingGroup");
  if (!select.value) throw new Error("Выберите группу из списка.");
  if (!selectedGroups.has(select.value)) selectedGroups.set(select.value, null);
  select.value = "";
  renderSelectedGroups();
}

for (const [id, add] of [["addProgramGroups", addProgramGroups], ["addExistingGroup", addExistingGroup]]) {
  $(id).addEventListener("click", () => {
    try {
      add();
      $("message").textContent = "";
    } catch (error) {
      reportError(error);
    }
  });
}

async function loadActive() {
  const rows = await api(adminPath + "assignments");
  table("activeRows", rows.map(row => {
    const close = action("Закрыть тест", async () => {
      if (!confirm("Закрыть «" + row.title + "» для группы " + row.group + "?")) return;
      try {
        close.disabled = true;
        await api(adminPath + "assignments/" + row.id + "/close", {});
        await loadActive();
      } catch (error) {
        close.disabled = false;
        reportError(error);
      }
    }, "danger");
    return [row.group, row.title, dateFormat.format(new Date(row.closes)), close];
  }), 4, "Активных тестов нет.");
}

async function loadLive() {
  const rows = await api(adminPath + "live");
  table("liveRows", rows.map(row => [row.name, row.group, row.title,
    row.question + " из " + row.total, row.seconds]), 5, "Сейчас никто не проходит тест.");
}

async function loadResults() {
  const request = ++resultsRequest;
  const params = new URLSearchParams(filters);
  params.set("page", page);
  const data = await api(adminPath + "results?" + params);
  if (request !== resultsRequest) return;
  table("resultRows", data.rows.map(row => [row.date, row.time, row.name, row.group,
    row.test, row.status, row.percent + "%", row.archived ? "—" :
      action("Ответы", () => void loadAnswers(row.id))]), 8, "Результатов по этим параметрам нет.");
  $("prev").disabled = data.page <= 1;
  $("next").disabled = !data.more;
  $("page").textContent = "Страница " + data.page;
  const exportParams = new URLSearchParams(filters);
  exportParams.set("format", "xlsx");
  $("export").href = adminPath + "results?" + exportParams;
}

async function loadAnswers(id) {
  try {
    const data = await api(adminPath + "answers/" + id);
    $("answerHeading").textContent = data.name + " · " + data.group + " · " + data.title;
    $("answerList").replaceChildren(...data.answers.map(item => {
      const li = document.createElement("li");
      const question = document.createElement("strong");
      question.textContent = item.text;
      const status = document.createElement("span");
      status.className = "answer-status";
      if (!item.selected) {
        status.textContent = "Без ответа";
      } else if (item.correct) {
        status.textContent = "Правильно";
        status.classList.add("answer-correct");
      } else {
        status.textContent = "Неправильно";
        status.classList.add("answer-incorrect");
      }
      li.append(status, question);
      if (item.selected) {
        const selected = document.createElement("p");
        selected.textContent = "Ответ студента — " + item.selected;
        li.append(selected);
      }
      const expected = document.createElement("p");
      expected.className = "muted";
      expected.textContent = "Правильный ответ — " + item.expected;
      li.append(expected);
      return li;
    }));
    if (!$("answerDetails").open) $("answerDetails").showModal();
  } catch (error) {
    reportError(error);
  }
}

const refresh = {active: loadActive, live: loadLive, results: loadResults};
async function selectTab(next) {
  tab = next;
  for (const button of tabs) {
    const selected = button.dataset.tab === tab;
    $(button.dataset.tab).hidden = !selected;
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("message").textContent = "";
  try {
    await refresh[tab]?.();
  } catch (error) {
    reportError(error);
  }
}

function submit(id, submitForm) {
  $(id).addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter || form.querySelector("button[type=submit], button:not([type])");
    button.disabled = true;
    $("message").textContent = "";
    try {
      await submitForm(new FormData(form), form);
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = id === "openForm" && !canOpen;
    }
  });
}

submit("loginForm", async (data, form) => {
  await api(adminPath + "login", {password: data.get("password")});
  form.reset();
  await loadSetup();
  await selectTab("open");
});
submit("groupForm", async (data, form) => {
  const item = await api(adminPath + "groups", {code: data.get("code")});
  form.reset();
  await loadSetup();
  $("existingGroups").open = true;
  $("existingGroup").value = item.code;
});
submit("openForm", async data => {
  const testId = data.get("test");
  if (!testId) throw new Error("Выберите тест.");
  if (data.getAll("groupNumber").length || $("extraNumbers").value.trim()) addProgramGroups();
  if ($("existingGroup").value) addExistingGroup();
  if (!selectedGroups.size) throw new Error("Выберите хотя бы одну группу.");
  const groups = [];
  const programs = [];
  for (const [code, entry] of selectedGroups) {
    if (entry) programs.push(entry);
    else groups.push(code);
  }
  const result = await api(adminPath + "assignments", {
    groups, programs, test: testId, minutes: Number(data.get("minutes"))
  });
  selectedGroups.clear();
  renderSelectedGroups();
  await loadSetup();
  await selectTab("active");
  const opened = Object.keys(result.opened);
  const summary = [];
  if (opened.length) summary.push("Тест открыт для групп: " + opened.join(", ") + ".");
  if (result.alreadyOpen.length) summary.push("Тест уже был открыт для групп: " + result.alreadyOpen.join(", ") + ".");
  $("openingSummary").textContent = summary.join(" ");
  $("openingSummary").hidden = false;
});

$("logout").addEventListener("click", async () => {
  try {
    await api(adminPath + "logout", {});
    showDashboard(false);
    $("loginForm").elements.password.focus();
  } catch (error) {
    reportError(error);
  }
});
for (const button of tabs) {
  button.addEventListener("click", () => void selectTab(button.dataset.tab));
}
function setFilters() {
  filters = new URLSearchParams();
  for (const [key, value] of new FormData($("filters"))) {
    if (value) filters.set(key, value);
  }
  page = 1;
  void selectTab("results");
}
$("filters").addEventListener("submit", event => {
  event.preventDefault();
  setFilters();
});
$("filters").addEventListener("reset", () => setTimeout(setFilters, 0));
$("prev").addEventListener("click", () => { page--; void selectTab("results"); });
$("next").addEventListener("click", () => { page++; void selectTab("results"); });

setInterval(async () => {
  if ($("dashboard").hidden || refreshing || (tab !== "active" && tab !== "live")) return;
  refreshing = true;
  try {
    await refresh[tab]();
  } catch (error) {
    reportError(error);
  } finally {
    refreshing = false;
  }
}, 4000);

loadSetup().then(() => selectTab("open")).catch(error => {
  if (error.status !== 401) reportError(error);
});
