<?php
/**
 * Приёмник ОПП — только запись, чтение через браузер невозможно.
 *
 * CSV кладётся ВНЕ сайта, в общую папку Synology Drive.
 * Укажите OPP_DIR = '/volume1/ОПП' (создайте папку в «Общая папка»,
 * не включайте её в Веб-станцию и не давайте публичную ссылку).
 */

define('OPP_TOKEN', 'OppPalletSave');
define('OPP_DIR', '/volume1/ОПП');
define('OPP_ORIGINS', 'https://poddon.github.io');

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Content-Type: application/json; charset=utf-8');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$allowed = array_filter(array_map('trim', explode(',', OPP_ORIGINS)));
$self = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http')
    . '://' . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '');
$allowed[] = $self;
$originOk = $origin === '' || in_array($origin, $allowed, true);
if ($origin !== '' && $originOk) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} elseif ($origin === '') {
    header('Access-Control-Allow-Origin: ' . $allowed[0]);
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Opp-Token');
header('Access-Control-Max-Age: 600');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method'], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!$originOk) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'origin'], JSON_UNESCAPED_UNICODE);
    exit;
}

$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$remote = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
$private = preg_match('/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1)/', $remote);
if (!$https && !$private) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'https'], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: 'null', true);
if (!is_array($data)) {
    $data = [];
}

$got = '';
if (!empty($_SERVER['HTTP_X_OPP_TOKEN'])) {
    $got = (string) $_SERVER['HTTP_X_OPP_TOKEN'];
} elseif (!empty($data['token'])) {
    $got = (string) $data['token'];
}
if ($got === '' || !hash_equals(OPP_TOKEN, $got)) {
    usleep(200000);
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden'], JSON_UNESCAPED_UNICODE);
    exit;
}

$ip = preg_replace('/[^0-9a-fA-F:.]/', '', $remote) ?: 'unknown';
$rateFile = sys_get_temp_dir() . '/opp-rate-' . md5($ip);
$now = time();
$hits = [];
if (is_file($rateFile)) {
    $hits = json_decode((string) file_get_contents($rateFile), true) ?: [];
    $hits = array_values(array_filter($hits, static function ($t) use ($now) {
        return $t > $now - 60;
    }));
}
if (count($hits) >= 40) {
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'rate'], JSON_UNESCAPED_UNICODE);
    exit;
}
$hits[] = $now;
file_put_contents($rateFile, json_encode($hits), LOCK_EX);

function opp_dir(): string
{
    $candidates = [];
    if (OPP_DIR !== '') {
        $candidates[] = OPP_DIR;
    }
    $candidates[] = dirname(__DIR__) . '/opp-private';
    $candidates[] = __DIR__ . '/private';
    foreach ($candidates as $d) {
        if (is_dir($d) && is_writable($d)) {
            return $d;
        }
    }
    foreach ($candidates as $d) {
        if (!is_dir($d) && @mkdir($d, 0700, true) && is_writable($d)) {
            return $d;
        }
    }
    return $candidates[count($candidates) - 1];
}

$dir = opp_dir();
if (!is_dir($dir) || !is_writable($dir)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'storage'], JSON_UNESCAPED_UNICODE);
    exit;
}

$deny = $dir . '/.htaccess';
if (!is_file($deny)) {
    @file_put_contents($deny, "Require all denied\nDeny from all\n");
}
@file_put_contents($dir . '/index.html', '');

if (!empty($data['ping'])) {
    echo json_encode(['ok' => true, 'ping' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

$clip = static function ($v, $max) {
    $s = trim(str_replace(["\0", "\r", "\n"], ' ', (string) $v));
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return substr($s, 0, $max);
};

$status = $clip($data['status'] ?? '', 32);
if (!in_array($status, ['Пройден', 'СПИСЫВАНИЕ'], true)) {
    $status = 'Пройден';
}

$fields = [
    $clip($data['date'] ?? date('d.m.Y H:i:s'), 40),
    $clip($data['name'] ?? '', 120),
    $clip($data['group'] ?? '', 40),
    $clip($data['modules'] ?? '', 8),
    $status,
    (int) ($data['correct'] ?? 0),
    (int) ($data['total'] ?? 0),
    (int) ($data['pct'] ?? 0),
    (int) ($data['xp'] ?? 0),
    (int) ($data['duration'] ?? 0),
];

$file = $dir . '/результаты.csv';
$fh = fopen($file, 'c+');
if (!$fh) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'storage'], JSON_UNESCAPED_UNICODE);
    exit;
}
flock($fh, LOCK_EX);
$stat = fstat($fh);
$empty = !$stat || $stat['size'] === 0;
if ($empty) {
    fwrite($fh, "\xEF\xBB\xBF");
    fwrite($fh, "Дата;ФИО;Группа;Модуль;Статус;Верных;Всего;%;XP;Сек\n");
} else {
    fseek($fh, 0, SEEK_END);
}
$esc = static function ($v): string {
    $s = str_replace('"', '""', (string) $v);
    if (strpbrk($s, ";\"\n") !== false) {
        return '"' . $s . '"';
    }
    return $s;
};
fwrite($fh, implode(';', array_map($esc, $fields)) . "\n");
fflush($fh);
flock($fh, LOCK_UN);
fclose($fh);
@chmod($file, 0600);

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
