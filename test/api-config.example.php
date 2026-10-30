<?php
/**
 * Настройки API теста ОПП на Synology.
 * 1) Скопируйте этот файл рядом с api.php под именем api-config.php
 * 2) Впишите пароль PostgreSQL и пароли администраторов.
 * api-config.php НЕ загружайте на GitHub — там пароли.
 */

/* PostgreSQL на самом NAS (Container Manager или пакет). */
define('OPP_PG_HOST', '127.0.0.1');
define('OPP_PG_PORT', '5432');
define('OPP_PG_DB',   'opp');
define('OPP_PG_USER', 'opp');
define('OPP_PG_PASS', 'СменитеПароль');

/* С каких сайтов разрешены запросы (через запятую). */
define('OPP_ALLOWED_ORIGINS', 'https://poddon.github.io');

/* Администраторы: ФИО => SHA-256 от пароля.
   Хэш пароля можно получить на NAS по SSH:  php -r "echo hash('sha256','МойПароль');"
   или на сайте https://emn178.github.io/online-tools/sha256.html
   Пароль должен совпадать с тем, которым администратор входит на сайте. */
define('OPP_ADMINS', [
    'Лукьянчиков Егор Игоревич'    => 'ВСТАВЬТЕ_SHA256_ПАРОЛЯ',
    'Пышненко Кирилл Валерьевич'   => 'ВСТАВЬТЕ_SHA256_ПАРОЛЯ',
    'Цурихин Дмитрий Сергеевич'    => 'ВСТАВЬТЕ_SHA256_ПАРОЛЯ',
    'Ибатуллин Богдан Альбертович' => 'ВСТАВЬТЕ_SHA256_ПАРОЛЯ',
]);
