/* Настройки PostgreSQL API.
   1) Neon: https://neon.tech — schema.sql
   2) Cloudflare Worker: api/worker-neon.mjs
   3) Укажите apiUrl ниже
*/
window.PG_CONFIG = {
  apiUrl: "",
  adminToken: "OppAdminRead"
};
