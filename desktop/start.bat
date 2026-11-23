@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  Запуск тестирования ОПП с подключением к PostgreSQL.
rem  Положите этот файл рядом с OPP-test.exe, впишите свои
rem  значения ниже и запустите двойным щелчком.
rem  Знак %% в пароле пишите двойным: %%%%
rem ============================================================

rem Адрес сервера PostgreSQL
set "DB_IP=localhost"
rem Порт PostgreSQL
set "DB_PORT=5432"
rem Имя существующей базы
set "DB_NAME=maxbot"
rem Роль PostgreSQL (пусто = совпадает с именем базы)
set "DB_USER="
rem Пароль PostgreSQL
set "DB_PASSWORD=maxbotmaxbot"
rem Отдельный пароль админки, не меньше 12 символов
rem (пусто = вход в админку по паролю PostgreSQL)
set "ADMIN_PASSWORD="

rem ------------------------------------------------------------
cd /d "%~dp0"
if not exist "OPP-test.exe" goto noexe

rem Пароли передаются через переменные окружения, чтобы спецсимволы
rem не ломали командную строку и пароль не был виден в списке процессов.
set "PGPASSWORD=%DB_PASSWORD%"
set "OPP_ADMIN_PASSWORD=%ADMIN_PASSWORD%"
set "USER_ARG="
if defined DB_USER set "USER_ARG=--user "%DB_USER%""

echo Подключение к PostgreSQL %DB_IP%:%DB_PORT%, база %DB_NAME%
"%~dp0OPP-test.exe" start --ip "%DB_IP%" --port %DB_PORT% --name "%DB_NAME%" %USER_ARG%
set "CODE=%ERRORLEVEL%"
if "%CODE%"=="0" exit /b 0
echo.
echo Программа завершилась с ошибкой. Проверьте параметры в начале файла start.bat.
pause
exit /b %CODE%

:noexe
echo Не найден OPP-test.exe рядом с файлом start.bat.
echo Положите start.bat в папку с OPP-test.exe.
pause
exit /b 1
