"use strict";

const adminPath = "/api/admin/";
const tabs = document.querySelectorAll("[data-tab]");
let tab = "open";
let filters = new URLSearchParams();
let page = 1;
let resultsRequest = 0;
let refreshing = false;

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
  options($("openGroup"), setup.groups, "Выберите группу");
  options($("openTest"), tests, "Выберите тест");
  options($("filterGroup"), setup.groups, "Все группы");
  options($("filterTest"), [...tests, {label: "Архивные тесты", value: "archive"}], "Все тесты");
  $("missingConsent").hidden = setup.consentConfigured;
  $("openButton").disabled = !setup.consentConfigured || !setup.groups.length;
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
    const button = form.querySelector("button");
    button.disabled = true;
    $("message").textContent = "";
    try {
      await submitForm(new FormData(form), form);
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
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
  $("openGroup").value = item.code;
});
submit("openForm", async data => {
  await api(adminPath + "assignments", {
    group: data.get("group"), test: data.get("test"), minutes: Number(data.get("minutes"))
  });
  await selectTab("active");
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
