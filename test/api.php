<?php
/**
 * API теста ОПП для Synology (Web Station + PHP 8 + PostgreSQL).
 *
 * Понимает все запросы сайта:
 *   GET  ?action=health                     — проверка базы
 *   POST ?action=results                    — сохранить результат (app.js и cloud-sync.js)
 *   GET  ?action=results                    — все результаты (только администратор)
 *   POST ?action=live                       — «пульс» студента во время теста
 *   GET  ?action=live                       — кто сейчас проходит (только администратор)
 *   GET/POST ?action=access                 — открыт ли тест
 *   POST ?action=check / ?action=grant      — одна попытка на ФИО / разрешение однофамильцу
 *
 * Администратор передаёт заголовки X-Admin-Name (ФИО, encodeURIComponent) и X-Admin-Password.
 * Настройки — в api-config.php (рядом с этим файлом, в GitHub не выкладывается).
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$cfgFile = __DIR__ . '/api-config.php';
if (!is_file($cfgFile)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'no_config', 'hint' => 'Скопируйте api-config.example.php в api-config.php и впишите пароль базы'], JSON_UNESCAPED_UNICODE);
    exit;
}
require $cfgFile;

/* ---------- CORS: сайт на GitHub Pages + сам NAS ---------- */
$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$allowed = array_map('trim', explode(',', defined('OPP_ALLOWED_ORIGINS') ? OPP_ALLOWED_ORIGINS : 'https://poddon.github.io'));
$self = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '');
if ($origin !== '' && ($origin === $self || in_array($origin, $allowed, true))) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Name, X-Admin-Password');
header('Access-Control-Max-Age: 600');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

/* ---------- помощники ---------- */
function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function norm($s) {
    $s = trim(preg_replace('/\s+/u', ' ', (string) $s));
    $s = str_replace(['ё', 'Ё'], ['е', 'Е'], $s);
    return mb_strtolower($s, 'UTF-8');
}
function cut($s, $n) { return mb_substr(trim((string) $s), 0, $n, 'UTF-8'); }
function num($v, $min, $max) {
    $n = is_numeric($v) ? (int) round((float) $v) : 0;
    return max($min, min($max, $n));
}
function uuid_ok($s) { return is_string($s) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $s); }
function body() {
    $raw = file_get_contents('php://input', false, null, 0, 65536);
    $j = json_decode($raw ?: '{}', true);
    return is_array($j) ? $j : [];
}

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!in_array('pgsql', PDO::getAvailableDrivers(), true)) {
        out(['ok' => false, 'error' => 'no_pgsql', 'hint' => 'Web Station → профиль PHP → Расширения: включите pgsql и pdo_pgsql'], 500);
    }
    try {
        $pdo = new PDO(
            sprintf('pgsql:host=%s;port=%s;dbname=%s', OPP_PG_HOST, OPP_PG_PORT, OPP_PG_DB),
            OPP_PG_USER, OPP_PG_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 5]
        );
    } catch (Exception $e) {
        out(['ok' => false, 'error' => 'db', 'hint' => 'Нет связи с PostgreSQL: проверьте api-config.php (хост, порт, база, пароль)'], 500);
    }
    $pdo->exec("SET TIME ZONE 'Europe/Moscow'");
    schema($pdo);
    return $pdo;
}

function schema($pdo) {
    $pdo->exec("
    CREATE TABLE IF NOT EXISTS quiz_results (
      id SERIAL PRIMARY KEY,
      submission_id TEXT,
      taken_at TEXT NOT NULL,
      student_name TEXT NOT NULL,
      group_code TEXT NOT NULL,
      module_id TEXT NOT NULL DEFAULT '1',
      status TEXT NOT NULL,
      correct INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      pct INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS submission_id TEXT;
    ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS fingerprint TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS quiz_results_submission_uq ON quiz_results (submission_id);
    CREATE UNIQUE INDEX IF NOT EXISTS quiz_results_fingerprint_uq ON quiz_results (fingerprint);
    CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results (created_at DESC);
    CREATE TABLE IF NOT EXISTS quiz_live (
      session_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_code TEXT NOT NULL,
      question INTEGER NOT NULL DEFAULT 1,
      total INTEGER NOT NULL DEFAULT 50,
      seconds_left INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Проходит',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS module_access (module_id TEXT PRIMARY KEY, is_open BOOLEAN NOT NULL DEFAULT TRUE);
    INSERT INTO module_access (module_id, is_open) VALUES ('1', TRUE) ON CONFLICT (module_id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS fio_done (name_norm TEXT PRIMARY KEY, name_display TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS fio_grants (id SERIAL PRIMARY KEY, name_norm TEXT NOT NULL, name_display TEXT, granted_by TEXT,
      used BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    ");
}

/* ---------- администратор ---------- */
function is_admin() {
    $name = isset($_SERVER['HTTP_X_ADMIN_NAME']) ? rawurldecode((string) $_SERVER['HTTP_X_ADMIN_NAME']) : '';
    $pass = isset($_SERVER['HTTP_X_ADMIN_PASSWORD']) ? (string) $_SERVER['HTTP_X_ADMIN_PASSWORD'] : '';
    if ($name === '' || $pass === '') return false;
    $admins = defined('OPP_ADMINS') ? OPP_ADMINS : [];
    $key = norm($name);
    foreach ($admins as $n => $hash) {
        if (norm($n) === $key && is_string($hash) && hash_equals(strtolower($hash), hash('sha256', $pass))) return true;
    }
    return false;
}
function need_admin() {
    if (!is_admin()) out(['ok' => false, 'error' => 'Неверные данные администратора'], 401);
}

/* ---------- маршруты ---------- */
$action = (string) ($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($action === 'health') {
        db()->query('SELECT 1');
        out(['ok' => true, 'db' => 'postgresql', 'server' => 'synology']);
    }

    if ($action === 'results' && $method === 'POST') {
        $b = body();
        $name = cut($b['name'] ?? '', 160);
        $group = cut($b['group'] ?? '', 80);
        $status = ($b['status'] ?? '') === 'СПИСЫВАНИЕ' ? 'СПИСЫВАНИЕ' : 'Пройден';
        if ($name === '' || $group === '') out(['ok' => false, 'error' => 'fields'], 400);
        $date = cut($b['date'] ?? '', 80);
        if ($date === '') $date = date('d.m.Y, H:i:s');
        $total = num($b['total'] ?? 0, 0, 500);
        $correct = min($total, num($b['correct'] ?? 0, 0, 500));
        $pct = num($b['pct'] ?? 0, 0, 100);
        $xp = num($b['xp'] ?? 0, 0, 1000000);
        $dur = num($b['duration'] ?? 0, 0, 86400);
        $mod = cut($b['modules'] ?? '1', 30) ?: '1';
        $sid = uuid_ok($b['submission_id'] ?? null) ? strtolower($b['submission_id']) : null;
        // один и тот же результат может прийти дважды (app.js и cloud-sync.js) — склеиваем
        $fp = hash('sha256', implode('|', [$date, norm($name), norm($group), $mod, $status, $correct, $total, $dur]));
        $st = db()->prepare("INSERT INTO quiz_results
            (submission_id, taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec, fingerprint)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING");
        $st->execute([$sid, $date, $name, $group, $mod, $status, $correct, $total, $pct, $xp, $dur, $fp]);
        if ($status === 'Пройден') {
            $n = norm($name);
            db()->prepare("INSERT INTO fio_done (name_norm, name_display, updated_at) VALUES (?,?,now())
                ON CONFLICT (name_norm) DO UPDATE SET updated_at = now(), name_display = EXCLUDED.name_display")->execute([$n, $name]);
            if ($st->rowCount() > 0) {
                db()->prepare("UPDATE fio_grants SET used = TRUE WHERE id = (
                    SELECT id FROM fio_grants WHERE name_norm = ? AND used = FALSE ORDER BY id LIMIT 1)")->execute([$n]);
            }
        }
        out(['ok' => true, 'duplicate' => $st->rowCount() === 0]);
    }

    if ($action === 'results' && $method === 'GET') {
        need_admin();
        $rows = db()->query("SELECT taken_at AS date, student_name AS name, group_code AS \"group\", module_id AS modules,
            status, correct, total, pct, xp, duration_sec AS duration
            FROM quiz_results ORDER BY created_at DESC, id DESC LIMIT 10000")->fetchAll();
        foreach ($rows as &$r) foreach (['correct', 'total', 'pct', 'xp', 'duration'] as $k) $r[$k] = (int) $r[$k];
        out(['ok' => true, 'rows' => $rows]);
    }

    if ($action === 'live' && $method === 'POST') {
        $b = body();
        $sid = $b['session_id'] ?? '';
        $name = cut($b['name'] ?? '', 160);
        $group = cut($b['group'] ?? '', 80);
        if (!uuid_ok($sid) || $name === '' || $group === '') out(['ok' => false], 400);
        db()->prepare("INSERT INTO quiz_live (session_id, name, group_code, question, total, seconds_left, status, updated_at)
            VALUES (?,?,?,?,?,?,?,now())
            ON CONFLICT (session_id) DO UPDATE SET question = EXCLUDED.question, total = EXCLUDED.total,
              seconds_left = EXCLUDED.seconds_left, status = EXCLUDED.status, updated_at = now()")
            ->execute([strtolower($sid), $name, $group, num($b['question'] ?? 1, 1, 500), num($b['total'] ?? 50, 1, 500),
                num($b['seconds_left'] ?? 0, 0, 600), cut($b['status'] ?? 'Проходит', 30)]);
        if (mt_rand(1, 50) === 1) db()->exec("DELETE FROM quiz_live WHERE updated_at < now() - interval '1 day'");
        out(['ok' => true]);
    }

    if ($action === 'live' && $method === 'GET') {
        need_admin();
        $rows = db()->query("SELECT name, group_code, question, total, seconds_left, status, updated_at
            FROM quiz_live WHERE updated_at > now() - interval '25 seconds' ORDER BY updated_at DESC LIMIT 300")->fetchAll();
        out(['ok' => true, 'rows' => $rows]);
    }

    if ($action === 'access' && $method === 'GET') {
        $acc = ['1' => true];
        foreach (db()->query("SELECT module_id, is_open FROM module_access") as $r) $acc[(string) $r['module_id']] = (bool) $r['is_open'];
        out(['ok' => true, 'access' => $acc]);
    }

    if ($action === 'access' && $method === 'POST') {
        need_admin();
        $b = body();
        $id = cut($b['id'] ?? '1', 30) ?: '1';
        $open = !empty($b['open']);
        db()->prepare("INSERT INTO module_access (module_id, is_open) VALUES (?, ?)
            ON CONFLICT (module_id) DO UPDATE SET is_open = EXCLUDED.is_open")->execute([$id, $open ? 't' : 'f']);
        out(['ok' => true, 'id' => $id, 'open' => $open]);
    }

    if ($action === 'check' && $method === 'POST') {
        $n = norm(body()['name'] ?? '');
        $d = db()->prepare("SELECT COUNT(*) FROM fio_done WHERE name_norm = ?"); $d->execute([$n]);
        $g = db()->prepare("SELECT COUNT(*) FROM fio_grants WHERE name_norm = ? AND used = FALSE"); $g->execute([$n]);
        $done = (int) $d->fetchColumn() > 0; $free = (int) $g->fetchColumn();
        out(['ok' => true, 'allowed' => !$done || $free > 0, 'done' => $done, 'grant' => $free]);
    }

    if ($action === 'grant' && $method === 'POST') {
        need_admin();
        $b = body();
        $name = cut($b['name'] ?? '', 160);
        if ($name === '') out(['ok' => false, 'error' => 'fields'], 400);
        db()->prepare("INSERT INTO fio_grants (name_norm, name_display, granted_by) VALUES (?,?,?)")
            ->execute([norm($name), $name, cut($b['by'] ?? '', 160)]);
        out(['ok' => true]);
    }

    out(['ok' => false, 'error' => 'unknown_action'], 400);
} catch (Throwable $e) {
    error_log('OPP API: ' . $e->getMessage());
    out(['ok' => false, 'error' => 'server'], 500);
}
