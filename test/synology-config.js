/* ===== Куда сохраняются результаты теста =====

   OPP_DB_URL — адрес сервера базы (обязательно https://):
     • Яндекс Облако:  "https://functions.yandexcloud.net/d4e..."   (см. yandex-cloud/ИНСТРУКЦИЯ.md)
     • Synology:       "https://opp-test.synology.me/opp/api.php" (см. SYNOLOGY.md)

   Пока строка пустая — результаты идут в прежнюю базу (Supabase).
   Впишите адрес и сохраните файл на GitHub — через 1–2 минуты
   результаты, «живое» отслеживание, админ-панель и статистика переключатся. */
window.OPP_DB_URL = "";

/* Сайт открыт прямо с Synology (не с github.io) — используем api.php рядом с ним. */
if (!window.OPP_DB_URL && /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) {
  window.OPP_DB_URL = new URL("api.php", location.href).href;
}

/* Не трогать: если адрес Synology задан, основной код теста тоже работает через него
   (одна попытка на ФИО, открытие теста группе). Если сайт открыт прямо с NAS — сам найдёт api.php. */
window.OPP_API = window.OPP_DB_URL || "";
