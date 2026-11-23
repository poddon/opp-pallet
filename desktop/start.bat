@echo off
chcp 65001 >nul
rem Запуск тестирования ОПП с параметрами подключения к PostgreSQL.
rem   --ip        адрес сервера PostgreSQL
rem   --port      порт PostgreSQL
rem   --name      имя существующей базы данных
rem   --password  пароль PostgreSQL
rem   --user      роль PostgreSQL, если она называется не так, как база (необязательно)
rem Если этот файл лежит не рядом с OPP-test.exe (например, в автозагрузке),
rem замените "%~dp0OPP-test.exe" на полный путь: "C:\Users\...\OPP-test.exe".

"%~dp0OPP-test.exe" start --ip localhost --port 5432 --name maxbot --password maxbotmaxbot

if errorlevel 1 pause
