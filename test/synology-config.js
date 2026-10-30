/* ===== Куда сохраняются результаты теста =====

   OPP_DB_URL — полный адрес api.php на вашем Synology (обязательно https://).
   Пример:  window.OPP_DB_URL = "https://opp-test.synology.me/opp/api.php";

   Пока строка пустая — результаты идут в прежнюю базу (Supabase), ничего не ломается.
   Как только впишете адрес Synology и загрузите этот файл на GitHub —
   результаты, «живое» отслеживание, админ-панель и статистика переключатся на NAS. */
window.OPP_DB_URL = "";

/* Сайт открыт прямо с Synology (не с github.io) — используем api.php рядом с ним. */
if (!window.OPP_DB_URL && /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) {
  window.OPP_DB_URL = new URL("api.php", location.href).href;
}

/* Не трогать: если адрес Synology задан, основной код теста тоже работает через него
   (одна попытка на ФИО, открытие теста группе). Если сайт открыт прямо с NAS — сам найдёт api.php. */
window.OPP_API = window.OPP_DB_URL || "";
