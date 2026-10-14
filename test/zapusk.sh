#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Установите Node.js: https://nodejs.org"; exit 1; }
[ -f db-config.json ] || { cp db-config.example.json db-config.json; echo "Впишите пароль PostgreSQL в db-config.json и запустите снова"; exit 0; }
[ -d node_modules ] || npm install --no-fund --no-audit
node server.js
