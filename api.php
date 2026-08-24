<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
$self = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http')
    . '://' . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '');
if ($origin === '' || $origin === $self) {
    header('Access-Control-Allow-Origin: ' . ($origin !== '' ? $origin : $self));
} else {
    header('Access-Control-Allow-Origin: ' . $self);
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/api-config.php';

function opp_json($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function opp_norm($s) {
    $s = trim(preg_replace('/\s+/u', ' ', (string) $s));
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function opp_db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!in_array('pgsql', PDO::getAvailableDrivers(), true)) {
        opp_json(['ok' => false, 'error' => 'no_pgsql', 'hint' => 'Включите расширение pgsql в PHP Web Station'], 500);
    }
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', OPP_PG_HOST, OPP_PG_PORT, OPP_PG_DB);
    try {
        $pdo = new PDO($dsn, OPP_PG_USER, OPP_PG_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (Exception $e) {
        opp_json(['ok' => false, 'error' => 'db', 'hint' => 'Проверьте api-config.php (хост, база, пароль)'], 500);
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS quiz_results (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS module_access (
      module_id TEXT PRIMARY KEY,
      is_open BOOLEAN NOT NULL DEFAULT TRUE
    )");
    $pdo->exec("INSERT INTO module_access (module_id, is_open) VALUES ('1', TRUE) ON CONFLICT (module_id) DO NOTHING");
    $pdo->exec("CREATE TABLE IF NOT EXISTS fio_done (
      name_norm TEXT PRIMARY KEY,
      name_display TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS fio_grants (
      id SERIAL PRIMARY KEY,
      name_norm TEXT NOT NULL,
      name_display TEXT,
      granted_by TEXT,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )");
    return $pdo;
}

$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$input = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: 'null', true);
    if (is_array($decoded)) $input = $decoded;
}

try {
    $db = opp_db();

    if ($action === 'health') {
        $db->query('SELECT 1');
        opp_json(['ok' => true, 'db' => 'postgresql']);
    }

    if ($action === 'results' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $st = $db->query("SELECT taken_at AS date, student_name AS name, group_code AS \"group\",
            module_id AS modules, status, correct, total, pct, xp, duration_sec AS duration
            FROM quiz_results WHERE status <> 'СПИСЫВАНИЕ' ORDER BY id DESC LIMIT 2000");
        opp_json(['ok' => true, 'rows' => $st->fetchAll()]);
    }

    if ($action === 'results' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $status = isset($input['status']) ? (string) $input['status'] : '';
        if ($status === 'СПИСЫВАНИЕ') {
            opp_json(['ok' => true, 'skipped' => 'cheat']);
        }
        $name = trim((string) ($input['name'] ?? ''));
        $group = trim((string) ($input['group'] ?? ''));
        if ($name === '' || $group === '') {
            opp_json(['ok' => false, 'error' => 'fields'], 400);
        }
        $st = $db->prepare("INSERT INTO quiz_results
            (taken_at, student_name, group_code, module_id, status, correct, total, pct, xp, duration_sec)
            VALUES (?,?,?,?,?,?,?,?,?,?)");
        $st->execute([
            (string) ($input['date'] ?? date('d.m.Y H:i:s')),
            $name,
            $group,
            (string) ($input['modules'] ?? '1'),
            $status !== '' ? $status : 'Пройден',
            (int) ($input['correct'] ?? 0),
            (int) ($input['total'] ?? 0),
            (int) ($input['pct'] ?? 0),
            (int) ($input['xp'] ?? 0),
            (int) ($input['duration'] ?? 0),
        ]);
        if ($status === 'Пройден') {
            $norm = opp_norm($name);
            $up = $db->prepare("INSERT INTO fio_done (name_norm, name_display, updated_at)
                VALUES (?,?,now()) ON CONFLICT (name_norm) DO UPDATE SET updated_at = now(), name_display = EXCLUDED.name_display");
            $up->execute([$norm, $name]);
            $use = $db->prepare("UPDATE fio_grants SET used = TRUE WHERE id = (
                SELECT id FROM fio_grants WHERE name_norm = ? AND used = FALSE ORDER BY id LIMIT 1)");
            $use->execute([$norm]);
        }
        opp_json(['ok' => true]);
    }

    if ($action === 'access' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $st = $db->query("SELECT module_id, is_open FROM module_access");
        $acc = ['1' => true];
        foreach ($st as $row) {
            $acc[(string) $row['module_id']] = (bool) $row['is_open'];
        }
        opp_json(['ok' => true, 'access' => $acc]);
    }

    if ($action === 'access' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $id = (string) ($input['id'] ?? '1');
        $open = !empty($input['open']);
        $st = $db->prepare("INSERT INTO module_access (module_id, is_open) VALUES (?,?)
            ON CONFLICT (module_id) DO UPDATE SET is_open = EXCLUDED.is_open");
        $st->execute([$id, $open]);
        opp_json(['ok' => true, 'id' => $id, 'open' => $open]);
    }

    if ($action === 'check' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $name = trim((string) ($input['name'] ?? ''));
        $norm = opp_norm($name);
        $done = $db->prepare("SELECT 1 FROM fio_done WHERE name_norm = ?");
        $done->execute([$norm]);
        $isDone = (bool) $done->fetch();
        $g = $db->prepare("SELECT COUNT(*)::int AS n FROM fio_grants WHERE name_norm = ? AND used = FALSE");
        $g->execute([$norm]);
        $free = (int) $g->fetch()['n'];
        $allowed = !$isDone || $free > 0;
        opp_json(['ok' => true, 'allowed' => $allowed, 'done' => $isDone, 'grant' => $free]);
    }

    if ($action === 'grant' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') opp_json(['ok' => false, 'error' => 'fields'], 400);
        $st = $db->prepare("INSERT INTO fio_grants (name_norm, name_display, granted_by) VALUES (?,?,?)");
        $st->execute([opp_norm($name), $name, trim((string) ($input['by'] ?? ''))]);
        opp_json(['ok' => true]);
    }

    opp_json(['ok' => false, 'error' => 'unknown_action'], 400);
} catch (Exception $e) {
    opp_json(['ok' => false, 'error' => 'server'], 500);
}
