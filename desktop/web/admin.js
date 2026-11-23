"use strict";

const adminPath = "/api/admin/";
const tabs = document.querySelectorAll("[data-tab]");
let tab = "open";
let filters = new URLSearchParams();
let page = 1;
let resultsRequest = 0;
let refreshing = false;
let resultCount = 0;
const selectedGroups = new Map();
let directionCodes = new Map();


function showDashboard(visible) {
  $("dashboard").hidden = !visible;
  $("adminHeader").hidden = !visible;
  $("login").hidden = visible;
  if (!visible && $("answerDetails").open) $("answerDetails").close();
}

function reportError(error) {
  $("message").textContent = error.message;
  if (error.status === 401) showDashboard(false);
}


// Splits "Электромонтаж-26-2" into the direction and the group number.
function splitGroup(code) {
  const match = /^(.*\S)[\s-]+(\d{2}-\d+)$/.exec(code);
  return match ? {direction: match[1], number: match[2]} : {direction: "Другие группы", number: code};
}

function renderGroupTree(groups) {
  const keep = new Set(Array.from($("groupTree").querySelectorAll("input[name=group]:checked"), box => box.value));
  const tree = new Map();
  for (const code of groups) {
    const {direction, number} = splitGroup(code);
    if (!tree.has(direction)) tree.set(direction, []);
    tree.get(direction).push({code, number});
  }
  const directions = Array.from(tree.keys()).sort((a, b) =>
    (a === "Другие группы") - (b === "Другие группы") || a.localeCompare(b, "ru"));
  $("groupTree").replaceChildren(...directions.map(direction => {
    const items = tree.get(direction).sort((a, b) => a.number.localeCompare(b.number, "ru", {numeric: true}));
    const block = document.createElement("details");
    block.className = "group-branch";
    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = direction;
    const count = document.createElement("span");
    count.className = "muted branch-count";
    summary.append(title, " ", count);
    const all = document.createElement("label");
    all.className = "check branch-all";
    const allBox = document.createElement("input");
    allBox.type = "checkbox";
    all.append(allBox, " Все группы направления");
    const numbers = document.createElement("div");
    numbers.className = "branch-numbers";
    for (const item of items) {
      const label = document.createElement("label");
      label.className = "check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.name = "group";
      box.value = item.code;
      box.checked = keep.has(item.code);
      label.append(box, " " + item.number);
      label.title = item.code;
      numbers.append(label);
    }
    allBox.addEventListener("change", () => {
      for (const box of numbers.querySelectorAll("input")) box.checked = allBox.checked;
      updateGroupCounts();
    });
    block.append(summary, all, numbers);
    if (items.some(item => keep.has(item.code))) block.open = true;
    return block;
  }));
  updateGroupCounts();
}

function updateGroupCounts() {
  let total = 0;
  for (const block of $("groupTree").children) {
    const boxes = Array.from(block.querySelectorAll("input[name=group]"));
    const checked = boxes.filter(box => box.checked).length;
    total += checked;
    block.querySelector(".branch-count").textContent = checked ? "(" + checked + " из " + boxes.length + ")" : "(" + boxes.length + ")";
    const all = block.querySelector(".branch-all input");
    all.checked = checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }
  $("groupCount").textContent = total ? "(выбрано " + total + ")" : "(все)";
}

async function loadSetup() {
  const setup = await api(adminPath + "setup");
  directionCodes = new Map(setup.directions.map(item => [item.name, item.code]));
  options($("direction"), setup.directions.map(item => ({
    label: item.code === item.name ? item.name : item.name + " (" + item.code + ")", value: item.name
  })), "Выберите направление");
  renderGroupTree(setup.groups);
  $("adminName").textContent = setup.admin;
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
    label.textContent = code;
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
  const year = $("groupYear").value.trim();
  const number = $("groupNumber").value.trim();
  if (!direction) throw new Error("Выберите направление.");
  if (!/^\d{2}$/.test(year)) throw new Error("Год группы — две цифры, например 26.");
  if (!/^[1-9]\d?$/.test(number)) throw new Error("Впишите номер группы, например 8.");
  const code = (directionCodes.get(direction) || direction) + "-" + year + "-" + number;
  selectedGroups.set(code, {direction, number: year + "-" + number});
  $("groupNumber").value = "";
  renderSelectedGroups();
}
$("groupNumber").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("addProgramGroups").click();
});

$("addProgramGroups").addEventListener("click", () => {
  try {
    addProgramGroups();
    $("message").textContent = "";
  } catch (error) {
    reportError(error);
  }
});

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
    const left = Math.max(0, Math.ceil((new Date(row.closes) - Date.now()) / 60000));
    return [row.group, row.title + " · " + row.questions + " вопр.", dateFormat.format(new Date(row.opened)),
      dateFormat.format(new Date(row.closes)), left + " мин", close];
  }), 6, "Активных тестов нет.");
}

async function loadResults() {
  const request = ++resultsRequest;
  const params = new URLSearchParams(filters);
  params.set("page", page);
  const data = await api(adminPath + "results?" + params);
  if (request !== resultsRequest) return;
  resultCount = data.rows.length;
  table("resultRows", data.rows.map(row => [row.date, row.time, row.name, row.group,
    row.test, row.status, row.percent + "%", row.archived ? "—" :
      action("Ответы", () => void loadAnswers(row.id))]), 8, "Результатов по этим параметрам нет.");
  $("prev").disabled = data.page <= 1;
  $("next").disabled = !data.more;
  $("page").textContent = "Страница " + data.page;
  const exportParams = new URLSearchParams(filters);
  exportParams.set("format", "xlsx");
  $("export").href = adminPath + "results?" + exportParams;
  exportParams.set("format", "statement");
  $("statement").href = adminPath + "results?" + exportParams;
}

function answerItem(item) {
  const li = document.createElement("li");
  li.value = item.number;
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
}

async function loadAnswers(id) {
  try {
    const data = await api(adminPath + "answers/" + id);
    $("answerHeading").textContent = data.name + " · " + data.group + " · " + data.title;
    $("answerStatus").textContent = "Статус: " + data.status + ". Номер вопроса — его порядок в попытке студента.";
    $("answerModules").replaceChildren(...data.modules.map(module => {
      const section = document.createElement("section");
      section.className = "answer-module";
      const heading = document.createElement("h3");
      heading.textContent = module.module;
      const summary = document.createElement("p");
      summary.className = "module-score";
      summary.textContent = "Правильно " + module.correct + " · неправильно " + module.wrong +
        " · без ответа " + module.empty + " · всего " + module.total;
      const list = document.createElement("ol");
      list.append(...data.answers.filter(item => item.module === module.module).map(answerItem));
      section.append(heading, summary, list);
      return section;
    }));
    if (!$("answerDetails").open) $("answerDetails").showModal();
  } catch (error) {
    reportError(error);
  }
}

async function loadAdmins() {
  const rows = await api(adminPath + "admins");
  table("adminRows", rows.map(row => [row.name,
    row.created ? dateFormat.format(new Date(row.created)) : "в прежней версии",
    row.createdBy || "—"]), 3, "Администраторов нет.");
}

$("adminForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  $("adminFormMessage").textContent = "";
  if (data.get("password") !== data.get("repeat")) {
    $("adminFormMessage").textContent = "Пароли не совпадают.";
    return;
  }
  try {
    const created = await api(adminPath + "admins", {name: data.get("name"), password: data.get("password")});
    form.reset();
    await loadAdmins();
    alertMessage("Администратор " + created.name + " добавлен.");
  } catch (error) {
    if (error.status === 401) reportError(error);
    else $("adminFormMessage").textContent = error.message;
  }
});

const refresh = {active: loadActive, results: loadResults, admins: loadAdmins};
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
    const errorMessage = id === "openForm" ? $("openTestError") : $("message");
    errorMessage.textContent = "";
    try {
      await submitForm(new FormData(form), form);
    } catch (error) {
      if (error.status === 401) reportError(error);
      else errorMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

submit("loginForm", async (data, form) => {
  await api(adminPath + "login", {login: data.get("login"), password: data.get("password")});
  form.reset();
  await loadSetup();
  await selectTab("open");
});

submit("openForm", async data => {
  if ($("groupNumber").value.trim()) addProgramGroups();
  if (!selectedGroups.size) throw new Error("Выберите хотя бы одну группу.");
  const groups = [];
  const programs = [];
  for (const [code, entry] of selectedGroups) {
    if (entry) programs.push(entry);
    else groups.push(code);
  }
  const result = await api(adminPath + "assignments", {
    groups, programs, minutes: Number(data.get("minutes"))
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
    $("loginForm").elements.login.focus();
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
    if (value) filters.append(key, value);
  }
  page = 1;
  void selectTab("results");
}
$("filters").addEventListener("submit", event => {
  event.preventDefault();
  setFilters();
});
$("filters").addEventListener("reset", () => setTimeout(() => { updateGroupCounts(); setFilters(); }, 0));
$("groupTree").addEventListener("change", event => { if (event.target.name === "group") updateGroupCounts(); });
$("prev").addEventListener("click", () => { page--; void selectTab("results"); });
$("next").addEventListener("click", () => { page++; void selectTab("results"); });

setInterval(async () => {
  if ($("dashboard").hidden || refreshing || tab !== "active") return;
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

$("statement").addEventListener("click", event => {
  if (resultCount) return;
  event.preventDefault();
  $("message").textContent = "Нет результатов для ведомости. Измените фильтры.";
});

$("openPassword").addEventListener("click", () => {
  $("passwordForm").reset();
  $("passwordMessage").textContent = "";
  $("passwordDialog").showModal();
});
$("closePassword").addEventListener("click", () => $("passwordDialog").close());
$("passwordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (data.get("next") !== data.get("repeat")) {
    $("passwordMessage").textContent = "Новые пароли не совпадают.";
    return;
  }
  try {
    await api(adminPath + "password", {current: data.get("current"), next: data.get("next")});
    $("passwordDialog").close();
    $("message").textContent = "";
    alertMessage("Пароль сохранён. Дальше входите только с ним.");
  } catch (error) {
    if (error.status === 401) {
      $("passwordDialog").close();
      reportError(error);
    } else {
      $("passwordMessage").textContent = error.message;
    }
  }
});
function alertMessage(text) {
  const note = $("message");
  note.textContent = text;
  note.classList.remove("error");
  setTimeout(() => { if (note.textContent === text) note.textContent = ""; note.classList.add("error"); }, 5000);
}
