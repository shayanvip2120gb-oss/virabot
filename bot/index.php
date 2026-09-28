<?php

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Logger.php';
require_once __DIR__ . '/src/TelegramApi.php';
require_once __DIR__ . '/src/QueueService.php';
require_once __DIR__ . '/src/BotService.php';
require_once __DIR__ . '/src/BroadcastService.php';
require_once __DIR__ . '/src/AdminService.php';

$config = require __DIR__ . '/config.php';
$logger = new Logger($config);
$pdo = Database::getConnection($config);
$telegram = new TelegramApi($config['bot_token'], $logger);
$queue = new QueueService($pdo, $logger);
$bot = new BotService($pdo, $telegram, $queue, $config, $logger);
$broadcast = new BroadcastService($pdo, $telegram, $logger, (int)($config['broadcast_rate_per_sec'] ?? 25));
$admin = new AdminService($pdo, $config, $logger);

$requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$action = $_GET['action'] ?? '';

if ($requestUri === '/webhook' || $action === 'webhook') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo 'Method Not Allowed';
        exit;
    }

    $secretToken = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
    if (!empty($config['webhook_secret']) && $secretToken !== $config['webhook_secret']) {
        http_response_code(403);
        $logger->warning('webhook_invalid_secret', ['received' => $secretToken]);
        echo 'Forbidden';
        exit;
    }

    $rawInput = file_get_contents('php://input');
    $update = json_decode($rawInput, true);

    if (!is_array($update)) {
        http_response_code(400);
        echo 'Invalid JSON';
        exit;
    }

    try {
        $bot->handleUpdate($update);
    } catch (Throwable $e) {
        $logger->error('webhook_processing_error', ['error' => $e->getMessage()]);
    }

    http_response_code(200);
    echo json_encode(['ok' => true]);
    exit;
}

if ($requestUri === '/health' || $action === 'health') {
    header('Content-Type: application/json; charset=utf-8');
    $queueStats = $queue->getStats();
    $dbOk = false;
    try {
        $pdo->query('SELECT 1');
        $dbOk = true;
    } catch (Throwable $e) {
    }

    echo json_encode([
        'status' => $dbOk ? 'healthy' : 'unhealthy',
        'php_version' => PHP_VERSION,
        'database' => $dbOk ? 'connected' : 'error',
        'queue' => $queueStats,
        'server_time' => gmdate('Y-m-d\TH:i:s\Z')
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($requestUri === '/api/login' || $action === 'login') {
    header('Content-Type: application/json; charset=utf-8');
    $raw = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $pass = $raw['password'] ?? '';
    $authAdmin = $admin->authenticate($pass);
    if ($authAdmin) {
        session_start();
        $_SESSION['admin_logged'] = true;
        $_SESSION['admin_role'] = $authAdmin['role'];
        $_SESSION['admin_id'] = $authAdmin['telegram_id'];
        $_SESSION['admin_name'] = $authAdmin['name'];
        echo json_encode(['ok' => true, 'admin' => $authAdmin]);
    } else {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'رمز عبور نادرست است']);
    }
    exit;
}

if ($requestUri === '/api/metrics' || $action === 'metrics') {
    header('Content-Type: application/json; charset=utf-8');
    $metrics = $admin->getFunnelMetrics();
    $queueStats = $queue->getStats();
    echo json_encode([
        'ok' => true,
        'metrics' => $metrics,
        'queue' => $queueStats
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($requestUri === '/api/users' || $action === 'users') {
    header('Content-Type: application/json; charset=utf-8');
    $search = $_GET['search'] ?? '';
    $status = $_GET['status'] ?? '';
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $users = $admin->getUsersList(['search' => $search, 'status' => $status], $limit, 0, true);
    echo json_encode(['ok' => true, 'users' => $users], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($requestUri === '/api/export' || $action === 'export') {
    $csv = $admin->exportCsv([], true);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="viraa_users_' . date('Ymd_His') . '.csv"');
    echo $csv;
    exit;
}

if ($requestUri === '/api/settings' || $action === 'settings') {
    header('Content-Type: application/json; charset=utf-8');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = json_decode(file_get_contents('php://input'), true) ?: $_POST;
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
        foreach ($payload as $key => $val) {
            $stmt->execute([$key, (string)$val, $now]);
        }
        echo json_encode(['ok' => true]);
        exit;
    } else {
        $stmt = $pdo->query('SELECT key, value FROM settings');
        $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        echo json_encode(['ok' => true, 'settings' => $settings], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

if ($action === 'logs') {
    header('Location: webhook.php?action=logs');
    exit;
}

if ($action === 'set_webhook') {
    header('Content-Type: text/html; charset=utf-8');
    $detectedHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $scheme = $isHttps ? 'https' : 'http';
    $configuredUrl = $config['app_url'] ?? '';

    if (!empty($configuredUrl) && !str_contains($configuredUrl, 'localhost') && !str_contains($configuredUrl, 'example.com')) {
        $baseUrl = rtrim($configuredUrl, '/');
    } else {
        $scriptDir = dirname($_SERVER['SCRIPT_NAME']);
        $baseUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\' ? '' : $scriptDir);
    }

    $webhookUrl = rtrim($baseUrl, '/') . '/index.php?action=webhook';
    $customUrl = $_GET['url'] ?? '';
    if (!empty($customUrl)) {
        $webhookUrl = $customUrl;
    }

    $res = $telegram->setWebhook($webhookUrl, $config['webhook_secret'] ?? null);
    $ok = $res['ok'] ?? false;
    $desc = $res['description'] ?? ($ok ? 'Webhook was set' : 'Failed to set webhook');
    ?>
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>تنظیم وب‌هوک تلگرام | ویرا انگلیش</title>
        <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; text-align: center; }
            .box { max-width: 600px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 16px; border: 1px solid #334155; }
            .badge-success { background: #065f46; color: #34d399; padding: 6px 14px; border-radius: 9999px; font-weight: bold; }
            .badge-error { background: #991b1b; color: #f87171; padding: 6px 14px; border-radius: 9999px; font-weight: bold; }
            code { background: #020617; padding: 4px 8px; border-radius: 6px; font-family: monospace; color: #38bdf8; word-break: break-all; }
            a { color: #38bdf8; text-decoration: none; margin: 0 8px; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>🔗 وضعیت تنظیم وب‌هوک در مرورگر</h2>
            <p>
                <?php if ($ok): ?>
                    <span class="badge-success">موفقیت‌آمیز (OK) ✅</span>
                <?php else: ?>
                    <span class="badge-error">خطا در اتصال ❌</span>
                <?php endif; ?>
            </p>
            <p><strong>پاسخ سرور تلگرام:</strong> <?= htmlspecialchars($desc, ENT_QUOTES, 'UTF-8') ?></p>
            <p><strong>آدرس وب‌هوک ثبت‌شده:</strong><br><code><?= htmlspecialchars($webhookUrl, ENT_QUOTES, 'UTF-8') ?></code></p>
            <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;">
            <div>
                <a href="?action=get_webhook_info">🔍 بررسی وضعیت وب‌هوک (Webhook Info)</a> |
                <a href="?action=delete_webhook">🗑 حذف وب‌هوک</a> |
                <a href="index.php">🏠 بازگشت به پنل</a>
            </div>
        </div>
    </body>
    </html>
    <?php
    exit;
}

if ($action === 'get_webhook_info') {
    header('Content-Type: application/json; charset=utf-8');
    $info = $telegram->getWebhookInfo();
    echo json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete_webhook') {
    header('Content-Type: application/json; charset=utf-8');
    $res = $telegram->deleteWebhook();
    echo json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'install') {
    header('Content-Type: text/html; charset=utf-8');
    try {
        Database::initTables($pdo);
        $ownerId = $config['admin_telegram_id'] ?? '123456789';
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare('INSERT OR IGNORE INTO admins (telegram_id, name, role, is_active, created_at, updated_at) VALUES (?, "مدیر ارشد", "owner", 1, ?, ?)');
        $stmt->execute([$ownerId, $now, $now]);
        echo '<div style="font-family: system-ui; direction: rtl; text-align: center; padding: 40px; background: #0f172a; color: #fff;">';
        echo '<h2 style="color: #34d399;">جداول دیتابیس با موفقیت ساخته شدند! ✅</h2>';
        echo '<p><a href="?action=set_webhook" style="color: #38bdf8;">گام بعدی: تنظیم وب‌هوک با مرورگر</a></p>';
        echo '</div>';
    } catch (Throwable $e) {
        echo '<div style="font-family: system-ui; direction: rtl; text-align: center; padding: 40px; background: #0f172a; color: #f87171;">';
        echo '<h2>خطا در ساخت دیتابیس: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</h2>';
        echo '</div>';
    }
    exit;
}

if ($action === 'run_worker') {
    header('Content-Type: application/json; charset=utf-8');
    $jobs = $queue->reserve(10, 60);
    $processedCount = 0;
    foreach ($jobs as $job) {
        $id = $job['id'];
        $type = $job['job_type'];
        $payload = $job['payload'];
        $attempts = $job['attempts'];
        $maxAttempts = $job['max_attempts'];
        try {
            $success = false;
            if ($type === 'approve_join_request') {
                $telegramId = (string)($payload['telegram_id'] ?? '');
                $chatId = (string)($payload['chat_id'] ?? '');
                $success = $bot->executeApproveJoinRequest($telegramId, $chatId);
            } elseif ($type === 'broadcast_batch') {
                $broadcastId = (int)($payload['broadcast_id'] ?? 0);
                $batchSize = (int)($payload['batch_size'] ?? 25);
                $processed = $broadcast->processBatch($broadcastId, $batchSize);
                $success = ($processed >= 0);
            }
            if ($success) {
                $queue->complete($id);
            } else {
                if ($attempts >= $maxAttempts) {
                    $queue->fail($id, 'Max attempts reached');
                } else {
                    $queue->release($id, 30, 'Attempt failed');
                }
            }
            $processedCount++;
        } catch (Throwable $e) {
            $queue->fail($id, $e->getMessage());
        }
    }
    echo json_encode(['ok' => true, 'processed_jobs' => $processedCount]);
    exit;
}

if ($action === 'logout') {
    unset($_SESSION['admin_auth']);
    session_destroy();
    header('Location: index.php');
    exit;
}

$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['admin_login_pass'])) {
    $inputPass = (string)$_POST['admin_login_pass'];
    $correctPass = (string)($config['admin_password'] ?? 'ViraaAdmin@2026');
    if ($inputPass === $correctPass) {
        $_SESSION['admin_auth'] = true;
        header('Location: index.php');
        exit;
    } else {
        $loginError = 'رمز عبور نادرست است. لطفاً رمز تعیین‌شده در فایل کانفیگ را وارد کنید.';
    }
}

if (empty($_SESSION['admin_auth'])) {
    header('Content-Type: text/html; charset=utf-8');
    ?>
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ورود به پنل مدیریت | ویرا انگلیش</title>
        <style>
            * { box-sizing: border-box; }
            body { font-family: system-ui, -apple-system, sans-serif; background: #0b1329; color: #f1f5f9; margin: 0; padding: 24px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .login-card { background: #1e293b; border-radius: 16px; padding: 36px; max-width: 440px; width: 100%; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; }
            h2 { margin-top: 0; color: #38bdf8; font-size: 20px; }
            p.sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
            .form-group { margin-bottom: 20px; text-align: right; }
            label { display: block; font-size: 13px; margin-bottom: 6px; color: #cbd5e1; }
            input[type="password"] { width: 100%; padding: 12px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; font-family: monospace; }
            input[type="password"]:focus { border-color: #38bdf8; }
            .btn-login { width: 100%; background: #0284c7; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; transition: background 0.2s; }
            .btn-login:hover { background: #0369a1; }
            .alert-err { background: #7f1d1d; border: 1px solid #dc2626; color: #fecaca; padding: 10px; border-radius: 8px; font-size: 12px; margin-bottom: 18px; text-align: right; }
            .links { margin-top: 20px; font-size: 12px; }
            .links a { color: #38bdf8; text-decoration: none; margin: 0 6px; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2>🔐 ورود امن به پنل مدیریت</h2>
            <p class="sub">ربات مینی‌دوره رایگان ویرا انگلیش</p>
            <?php if (!empty($loginError)): ?>
                <div class="alert-err"><?= htmlspecialchars($loginError, ENT_QUOTES, 'UTF-8') ?></div>
            <?php endif; ?>
            <form method="POST">
                <div class="form-group">
                    <label>رمز عبور مدیریت:</label>
                    <input type="password" name="admin_login_pass" placeholder="رمز عبور پنل را وارد کنید..." required autofocus>
                </div>
                <button type="submit" class="btn-login">ورود به پنل 🚀</button>
            </form>
            <div class="links">
                <a href="webhook.php?action=diagnose">🩺 عیب‌یابی سرور</a> |
                <a href="webhook.php?action=logs">📜 مشاهده لاگ‌ها</a> |
                <a href="config-maker.php">⚙️ تغییر پسورد در Config Maker</a>
            </div>
        </div>
    </body>
    </html>
    <?php
    exit;
}

if ($action === 'manual_approve' && !empty($_GET['uid'])) {
    $uid = trim($_GET['uid']);
    $user = $bot->getUser($uid);
    if ($user) {
        $now = date('Y-m-d H:i:s');
        $chatId = $config['private_channel_id'] ?? '';
        $admin->manualApprove($uid, 'admin', 'مدیر سیستم', 'web_override');
        $bot->executeApproveJoinRequest($uid, $chatId);
        $approvedMsg = $bot->getSetting('msg_join_approved', "دسترسی مینی‌دوره برات فعال شد! 🌟\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:");
        $btnEnter = $bot->getSetting('btn_enter_course', 'شروع درس‌های مینی‌دوره 🚀');
        try {
            $invite = $telegram->createChatInviteLink($chatId, 'manual_approval', false);
            $link = $invite['result']['invite_link'] ?? '';
            $telegram->sendMessage($uid, $approvedMsg, !empty($link) ? [
                'inline_keyboard' => [[['text' => $btnEnter, 'url' => $link]]]
            ] : null);
        } catch (Throwable $e) {
        }
    }
    header('Location: index.php?msg=approved');
    exit;
}

$searchQuery = trim($_GET['search'] ?? '');
$statusFilter = trim($_GET['status'] ?? '');
$usersList = $admin->getUsersList(['search' => $searchQuery, 'status' => $statusFilter], 100, 0, true);
$m = $admin->getFunnelMetrics();
$queueStats = $queue->getStats();

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>پنل مدیریت و پایش مینی‌دوره | ویرا انگلیش</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1329; color: #f1f5f9; margin: 0; padding: 24px; line-height: 1.5; }
        .wrapper { max-width: 1200px; margin: 0 auto; }
        .header { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
        h1 { margin: 0 0 6px 0; font-size: 20px; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
        .sub-header { color: #94a3b8; font-size: 13px; margin: 0; }
        .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .btn { display: inline-flex; align-items: center; gap: 6px; background: #0284c7; color: #fff; padding: 9px 16px; border-radius: 8px; text-decoration: none; border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; }
        .btn:hover { background: #0369a1; }
        .btn-sec { background: #334155; color: #cbd5e1; }
        .btn-sec:hover { background: #475569; color: #fff; }
        .btn-success { background: #059669; }
        .btn-success:hover { background: #047857; }
        .btn-sm { padding: 4px 10px; font-size: 12px; border-radius: 6px; }
        .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
        .card-title { margin-top: 0; font-size: 17px; color: #f8fafc; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 14px; margin-bottom: 18px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .metric-box { background: #0f172a; padding: 18px; border-radius: 12px; border: 1px solid #1e293b; text-align: center; }
        .metric-val { font-size: 26px; font-weight: 800; color: #38bdf8; font-family: monospace; }
        .metric-sub { font-size: 12px; color: #10b981; font-weight: 600; margin-top: 2px; }
        .metric-label { font-size: 13px; color: #94a3b8; margin-top: 6px; }
        .funnel-container { background: #0f172a; border-radius: 12px; padding: 18px; border: 1px solid #1e293b; }
        .funnel-step { margin-bottom: 14px; }
        .funnel-step:last-child { margin-bottom: 0; }
        .funnel-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
        .bar-bg { background: #1e293b; height: 10px; border-radius: 9999px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 9999px; background: linear-gradient(90deg, #0284c7, #38bdf8); }
        .bar-fill.success { background: linear-gradient(90deg, #059669, #34d399); }
        .table-responsive { width: 100%; overflow-x: auto; margin-top: 14px; }
        table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13px; }
        th { background: #0f172a; color: #94a3b8; padding: 12px; font-weight: 600; border-bottom: 2px solid #334155; white-space: nowrap; }
        td { padding: 12px; border-bottom: 1px solid #334155; vertical-align: middle; white-space: nowrap; }
        tr:hover td { background: #1a233a; }
        .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
        .badge-green { background: #064e3b; color: #34d399; }
        .badge-yellow { background: #713f12; color: #fde047; }
        .badge-red { background: #7f1d1d; color: #fca5a5; }
        .badge-blue { background: #1e3a8a; color: #93c5fd; }
        .badge-gray { background: #334155; color: #94a3b8; }
        .user-tag { color: #38bdf8; text-decoration: none; font-weight: 600; font-family: monospace; }
        .user-tag:hover { text-decoration: underline; }
        .search-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .search-bar input, .search-bar select { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 9px 14px; color: #fff; font-size: 13px; outline: none; }
        .search-bar input { flex: 1; min-width: 220px; }
        .search-bar input:focus, .search-bar select:focus { border-color: #38bdf8; }
        .alert-box { background: #064e3b; color: #a7f3d0; padding: 12px 18px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; border: 1px solid #059669; }
    </style>
</head>
<body>
    <div class="wrapper">
        <?php if (isset($_GET['msg']) && $_GET['msg'] === 'approved'): ?>
            <div class="alert-box">
                دسترسی کاربر با موفقیت تأیید شد و لینک عضویت کانال مینی‌دوره برایش ارسال گردید. ✅
            </div>
        <?php endif; ?>

        <div class="header">
            <div>
                <h1>🎓 پنل مدیریت و پایش مینی‌دوره رایگان ویرا انگلیش</h1>
                <p class="sub-header">
                    ربات: <strong>@<?= htmlspecialchars($config['bot_username'] ?? 'viraa_mini_course_bot', ENT_QUOTES, 'UTF-8') ?></strong>
                    | وب‌هوک: <code>/webhook.php</code>
                    | دیتابیس: <code>SQLite (متصل)</code>
                </p>
            </div>
            <div class="btn-group">
                <a href="?action=export" class="btn btn-success">📥 دانلود خروجی اکسل (CSV)</a>
                <a href="webhook.php?action=logs" target="_blank" class="btn btn-sec">📜 لاگ‌های زنده</a>
                <a href="webhook.php?action=diagnose" target="_blank" class="btn btn-sec">🩺 تست عیب‌یابی</a>
                <a href="config-maker.php" class="btn btn-sec">⚙️ Config Maker</a>
                <a href="?action=logout" class="btn btn-sec" style="color: #f87171;" onclick="return confirm('آیا از پنل خارج می‌شوید؟');">🚪 خروج</a>
            </div>
        </div>

        <div class="card">
            <div class="card-title">
                <span>📊 آمار و شاخص‌های کلیدی قیف فروش (KPI)</span>
                <span style="font-size: 12px; color: #94a3b8;">بروزرسانی زنده</span>
            </div>
            <div class="metrics-grid">
                <div class="metric-box">
                    <div class="metric-val"><?= number_format($m['total_users']) ?></div>
                    <div class="metric-sub">۱۰۰٪ شروع‌کنندگان</div>
                    <div class="metric-label">کل ورودی‌ها به ربات</div>
                </div>
                <div class="metric-box">
                    <div class="metric-val"><?= number_format($m['name_submitted']) ?></div>
                    <div class="metric-sub"><?= $m['name_rate'] ?>% تبدیل</div>
                    <div class="metric-label">ثبت نام و نام خانوادگی</div>
                </div>
                <div class="metric-box">
                    <div class="metric-val"><?= number_format($m['phone_submitted']) ?></div>
                    <div class="metric-sub" style="color: #38bdf8;"><?= $m['phone_rate'] ?>% تبدیل</div>
                    <div class="metric-label">ارسال شماره موبایل</div>
                </div>
                <div class="metric-box">
                    <div class="metric-val"><?= number_format($m['channel_verified']) ?></div>
                    <div class="metric-sub"><?= $m['channel_rate'] ?>% تبدیل</div>
                    <div class="metric-label">عضویت کانال عمومی</div>
                </div>
                <div class="metric-box">
                    <div class="metric-val"><?= number_format($m['eligible']) ?></div>
                    <div class="metric-sub" style="color: #a855f7;"><?= $m['eligible_rate'] ?>% تبدیل</div>
                    <div class="metric-label">واجدین شرایط مینی‌دوره</div>
                </div>
                <div class="metric-box">
                    <div class="metric-val" style="color: #34d399;"><?= number_format($m['approved']) ?></div>
                    <div class="metric-sub" style="color: #34d399;"><?= $m['approved_rate'] ?>% نهایی</div>
                    <div class="metric-label">عضویت قطعی کانال دوره</div>
                </div>
            </div>

            <div class="funnel-container">
                <div class="funnel-step">
                    <div class="funnel-header">
                        <span>۱. شروع ربات (/start)</span>
                        <strong><?= number_format($m['total_users']) ?> نفر (۱۰۰٪)</strong>
                    </div>
                    <div class="bar-bg"><div class="bar-fill" style="width: 100%;"></div></div>
                </div>
                <div class="funnel-step">
                    <div class="funnel-header">
                        <span>۲. ثبت نام کاربر</span>
                        <strong><?= number_format($m['name_submitted']) ?> نفر (<?= $m['name_rate'] ?>%)</strong>
                    </div>
                    <div class="bar-bg"><div class="bar-fill" style="width: <?= min(100, $m['name_rate']) ?>%;"></div></div>
                </div>
                <div class="funnel-step">
                    <div class="funnel-header">
                        <span>۳. ارسال شماره تلفن تماس</span>
                        <strong><?= number_format($m['phone_submitted']) ?> نفر (<?= $m['phone_rate'] ?>%)</strong>
                    </div>
                    <div class="bar-bg"><div class="bar-fill" style="width: <?= min(100, $m['phone_rate']) ?>%;"></div></div>
                </div>
                <div class="funnel-step">
                    <div class="funnel-header">
                        <span>۴. واجدین شرایط دریافت دوره</span>
                        <strong><?= number_format($m['eligible']) ?> نفر (<?= $m['eligible_rate'] ?>%)</strong>
                    </div>
                    <div class="bar-bg"><div class="bar-fill" style="width: <?= min(100, $m['eligible_rate']) ?>%;"></div></div>
                </div>
                <div class="funnel-step">
                    <div class="funnel-header">
                        <span>۵. پذیرش نهایی در کانال مینی‌دوره</span>
                        <strong style="color: #34d399;"><?= number_format($m['approved']) ?> نفر (<?= $m['approved_rate'] ?>%)</strong>
                    </div>
                    <div class="bar-bg"><div class="bar-fill success" style="width: <?= min(100, $m['approved_rate']) ?>%;"></div></div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-title">
                <span>👥 فهرست و جزئیات کاربران (مجموع: <?= count($usersList) ?> کاربر نمایش داده شده)</span>
                <span style="font-size: 13px; color: #94a3b8;">شامل نام کاربری (Username) تلگرام و شماره تماس</span>
            </div>

            <form method="GET" class="search-bar">
                <input type="text" name="search" value="<?= htmlspecialchars($searchQuery, ENT_QUOTES, 'UTF-8') ?>" placeholder="جستجو بر اساس نام، یوزرنیم (@username)، شماره تماس یا آیدی عددی...">
                <select name="status">
                    <option value="" <?= $statusFilter === '' ? 'selected' : '' ?>>همه وضعیت‌ها</option>
                    <option value="eligible" <?= $statusFilter === 'eligible' ? 'selected' : '' ?>>واجدین شرایط مینی‌دوره</option>
                    <option value="approved" <?= $statusFilter === 'approved' ? 'selected' : '' ?>>عضو قطعی کانال مینی‌دوره</option>
                    <option value="with_phone" <?= $statusFilter === 'with_phone' ? 'selected' : '' ?>>دارای شماره تلفن</option>
                </select>
                <button type="submit" class="btn">🔍 فیلتر</button>
                <?php if (!empty($searchQuery) || !empty($statusFilter)): ?>
                    <a href="index.php" class="btn btn-sec">✕ پاکسازی فیلتر</a>
                <?php endif; ?>
            </form>

            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>نام کاربر</th>
                            <th>نام کاربری تلگرام (Username)</th>
                            <th>شماره تماس</th>
                            <th>شناسه تلگرام</th>
                            <th>مرحله</th>
                            <th>واجد شرایط</th>
                            <th>کانال مینی‌دوره</th>
                            <th>تاریخ ثبت‌نام</th>
                            <th>عملیات</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($usersList)): ?>
                            <tr>
                                <td colspan="10" style="text-align: center; color: #94a3b8; padding: 24px;">هیچ کاربری یافت نشد.</td>
                            </tr>
                        <?php else: ?>
                            <?php foreach ($usersList as $idx => $u): ?>
                                <tr>
                                    <td><?= $idx + 1 ?></td>
                                    <td>
                                        <strong><?= htmlspecialchars($u['custom_name'] ?: ($u['first_name'] ?: 'کاربر'), ENT_QUOTES, 'UTF-8') ?></strong>
                                    </td>
                                    <td>
                                        <?php if (!empty($u['username'])): ?>
                                            <a href="https://t.me/<?= htmlspecialchars(ltrim($u['username'], '@'), ENT_QUOTES, 'UTF-8') ?>" target="_blank" class="user-tag">
                                                @<?= htmlspecialchars(ltrim($u['username'], '@'), ENT_QUOTES, 'UTF-8') ?>
                                            </a>
                                        <?php else: ?>
                                            <span style="color: #64748b;">ندارد</span>
                                        <?php endif; ?>
                                    </td>
                                    <td dir="ltr" style="font-family: monospace;">
                                        <?= !empty($u['phone_normalized']) ? htmlspecialchars($u['phone_normalized'], ENT_QUOTES, 'UTF-8') : '<span style="color: #64748b;">ثبت نشده</span>' ?>
                                    </td>
                                    <td style="font-family: monospace; color: #94a3b8;"><?= htmlspecialchars((string)$u['telegram_id'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td>
                                        <span class="badge badge-gray"><?= htmlspecialchars($u['registration_step'] ?? 'started', ENT_QUOTES, 'UTF-8') ?></span>
                                    </td>
                                    <td>
                                        <?php if ((int)$u['is_eligible'] === 1): ?>
                                            <span class="badge badge-green">بله ✅</span>
                                        <?php else: ?>
                                            <span class="badge badge-red">خیر ❌</span>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <?php if ($u['private_channel_status'] === 'approved'): ?>
                                            <span class="badge badge-green">عضو شده 🎓</span>
                                        <?php elseif ($u['private_channel_status'] === 'pending'): ?>
                                            <span class="badge badge-yellow">در انتظار تأیید ⏳</span>
                                        <?php else: ?>
                                            <span class="badge badge-gray">درخواست نداده</span>
                                        <?php endif; ?>
                                    </td>
                                    <td style="font-size: 11px; color: #94a3b8;"><?= htmlspecialchars($u['created_at'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td>
                                        <?php if ($u['private_channel_status'] !== 'approved'): ?>
                                            <a href="?action=manual_approve&uid=<?= urlencode((string)$u['telegram_id']) ?>" class="btn btn-sm btn-success" onclick="return confirm('آیا دسترسی این کاربر به صورت دستی تأیید و لینک دوره برایش ارسال شود؟');">
                                                تأیید فوری 🚀
                                            </a>
                                        <?php else: ?>
                                            <span style="color: #10b981; font-size: 12px;">تأیید شده</span>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>
</html>
