<?php
/**
 * Подключение к PostgreSQL на Synology.
 * Пароль и имя БД меняете только здесь. Файл не должен быть доступен снаружи
 * как текст — Web Station отдаёт его только через include из api.php.
 */
define('OPP_PG_HOST', '127.0.0.1');
define('OPP_PG_PORT', '5432');
define('OPP_PG_DB', 'opp');
define('OPP_PG_USER', 'opp');
define('OPP_PG_PASS', 'СменитеПароль');
