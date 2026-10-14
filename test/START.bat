@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Не найден Node.js. Установите его с https://nodejs.org ^(версия LTS^) и запустите этот файл снова. & pause & exit /b 1)
if not exist db-config.json (
  copy db-config.example.json db-config.json >nul
  echo Создан файл db-config.json. Откройте его в Блокноте, впишите пароль от PostgreSQL и запустите этот файл снова.
  notepad db-config.json
  pause
  exit /b 0
)
if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install --no-fund --no-audit || (pause & exit /b 1)
)
start "" http://127.0.0.1:8787
node server.js
pause
