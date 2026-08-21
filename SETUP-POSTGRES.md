# Подключение PostgreSQL к тесту ОПП

Сайт на GitHub Pages статический. Результаты пишутся в PostgreSQL через API (Cloudflare Worker + Neon).

## 1. База Neon (бесплатно)

1. https://neon.tech — создайте проект
2. Скопируйте Connection string (DATABASE_URL)
3. В SQL Editor выполните schema.sql

## 2. API (Cloudflare Workers)

```bash
cd api
npm install
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

## 3. Сайт

В pg-config.js укажите apiUrl воркера и залейте на gh-pages.

Пока apiUrl пустой — localStorage как раньше.
