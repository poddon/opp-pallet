# PostgreSQL для ОПП

1. Neon.tech — создать БД, выполнить schema.sql
2. cd api && npm i && npx wrangler secret put DATABASE_URL && npx wrangler secret put ADMIN_TOKEN && npx wrangler deploy
3. В pg-config.js указать apiUrl воркера
4. Обновить app.js с pgPostResult (см. релизный zip)
