/* Настройки PostgreSQL API.
   1) Создайте бесплатную БД Neon: https://neon.tech
   2) Выполните schema.sql в SQL Editor
   3) Задеплойте api/worker-neon.mjs на Cloudflare Workers
      — секреты: DATABASE_URL, ADMIN_TOKEN=OppAdminRead
   4) Вставьте URL воркера ниже
*/
window.PG_CONFIG = {
  apiUrl: "",
  adminToken: "OppAdminRead"
};
