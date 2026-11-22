"use strict";

const $ = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow"
});

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  if (response.status === 204) return;
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("Сервер вернул неожиданный ответ.");
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Запрос не выполнен.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function options(select, values, placeholder) {
  const saved = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  for (const entry of values) {
    const item = typeof entry === "string" ? {label: entry, value: entry} : entry;
    select.add(new Option(item.label, item.value));
  }
  if (Array.from(select.options).some(item => item.value === saved)) select.value = saved;
}
