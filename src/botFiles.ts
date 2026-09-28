export interface BotFile {
  name: string;
  path: string;
  content: string;
  description: string;
}

export const BOT_FILES: BotFile[] = [
  {
    name: 'webhook.php',
    path: 'webhook.php',
    description: 'اندپوینت مستقیم دریافت آپدیت‌های تلگرام و ست کردن وب‌هوک با مرورگر',
    content: `<?php

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Logger.php';
require_once __DIR__ . '/src/TelegramApi.php';
require_once __DIR__ . '/src/QueueService.php';
require_once __DIR__ . '/src/BotService.php';

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo 'فایل config.php یافت نشد. لطفاً ابتدا فایل config-maker.php را در مرورگر باز کنید.';
    exit;
}

$config = require $configFile;
$logger = new Logger($config);
$pdo = Database::getConnection($config);
$telegram = new TelegramApi($config['bot_token'], $logger);
$queue = new QueueService($pdo, $logger);
$bot = new BotService($pdo, $telegram, $queue, $config, $logger);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
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

$detectedHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
$isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$scheme = $isHttps ? 'https' : 'http';
$configuredUrl = $config['app_url'] ?? '';

if (!empty($configuredUrl) && !str_contains($configuredUrl, 'localhost') && !str_contains($configuredUrl, 'example.com')) {
    $baseUrl = rtrim($configuredUrl, '/');
} else {
    $scriptDir = dirname($_SERVER['SCRIPT_NAME']);
    $baseUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\\\' ? '' : $scriptDir);
}

$webhookUrl = rtrim($baseUrl, '/') . '/webhook.php';
$action = $_GET['action'] ?? '';

if ($action === 'set') {
    $secret = !empty($config['webhook_secret']) ? $config['webhook_secret'] : null;
    $allowed = ['message', 'callback_query', 'chat_join_request', 'chat_member', 'my_chat_member'];
    $resp = $telegram->setWebhook($webhookUrl, $secret, $allowed);
    $ok = $resp['ok'] ?? false;
    $desc = $resp['description'] ?? ($ok ? 'Webhook was set' : 'Failed to set webhook');
    header('Content-Type: text/html; charset=utf-8');
    echo '<div style="font-family: system-ui; direction: rtl; text-align: center; padding: 40px; background: #0f172a; color: #fff;">';
    echo '<h2>وضعیت ثبت وب‌هوک: ' . ($ok ? 'موفقیت‌آمیز ✅' : 'خطا ❌') . '</h2>';
    echo '<p>' . htmlspecialchars($desc, ENT_QUOTES, 'UTF-8') . '</p>';
    echo '<p><code>' . htmlspecialchars($webhookUrl, ENT_QUOTES, 'UTF-8') . '</code></p>';
    echo '<p><a href="webhook.php?action=diagnose" style="color: #38bdf8; margin: 0 10px;">🩺 عیب‌یابی اتصال ربات و کانال‌ها</a> <a href="webhook.php?action=logs" style="color: #38bdf8; margin: 0 10px;">📜 مشاهده لاگ‌ها</a></p>';
    echo '</div>';
    exit;
}

if ($action === 'info') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($telegram->getWebhookInfo(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($telegram->deleteWebhook(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'logs') {
    header('Content-Type: text/html; charset=utf-8');
    $logFile = $config['log_file'] ?? (__DIR__ . '/logs/bot.log');
    $data = file_exists($logFile) ? file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    $recent = array_slice($data ?: [], -60);
    echo '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>لاگ‌ها</title><style>body{background:#020617;color:#f8fafc;font-family:monospace;padding:20px;font-size:12px;}.line{padding:4px;border-bottom:1px solid #1e293b;}</style></head><body>';
    echo '<h2>📜 آخرین لاگ‌های سرور ربات</h2>';
    foreach (array_reverse($recent) as $line) {
        echo '<div class="line">' . htmlspecialchars($line, ENT_QUOTES, 'UTF-8') . '</div>';
    }
    echo '</body></html>';
    exit;
}

$allowedJson = urlencode(json_encode(['message', 'callback_query', 'chat_join_request', 'chat_member', 'my_chat_member']));
$directTelegramUrl = 'https://api.telegram.org/bot' . $config['bot_token'] . '/setWebhook?url=' . urlencode($webhookUrl) . '&allowed_updates=' . $allowedJson;
if (!empty($config['webhook_secret'])) {
    $directTelegramUrl .= '&secret_token=' . urlencode($config['webhook_secret']);
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>webhook.php</title>
</head>
<body style="font-family: system-ui; background: #0f172a; color: #f8fafc; padding: 30px; text-align: center;">
    <h2>⚡ اندپوینت وب‌هوک تلگرام (webhook.php)</h2>
    <p><a href="webhook.php?action=set" style="display: inline-block; background: #0284c7; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">ست کردن سریع وب‌هوک با همین فایل</a></p>
    <p>لینک رسمی تلگرام در مرورگر:<br><code style="color: #38bdf8;"><?= htmlspecialchars($directTelegramUrl, ENT_QUOTES, 'UTF-8') ?></code></p>
</body>
</html>`
  },
  {
    name: 'config-maker.php',
    path: 'config-maker.php',
    description: 'ابزار گرافیکی تحت وب برای ساخت آسان فایل کانفیگ و اتصال به تلگرام',
    content: `<?php

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/TelegramApi.php';

$detectedHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
$isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$scheme = $isHttps ? 'https' : 'http';
$scriptDir = dirname($_SERVER['SCRIPT_NAME']);
$autoDetectedUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\\\' ? '' : $scriptDir);

$existingConfig = file_exists(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];

$message = '';
$messageType = '';
$webhookResult = null;
$directTelegramUrl = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $botToken = trim($_POST['bot_token'] ?? '');
    $botUsername = trim($_POST['bot_username'] ?? '');
    $publicChannelId = trim($_POST['public_channel_id'] ?? '');
    $publicChannelUrl = trim($_POST['public_channel_url'] ?? '');
    $privateChannelId = trim($_POST['private_channel_id'] ?? '');
    $adminTelegramId = trim($_POST['admin_telegram_id'] ?? '');
    $adminPassword = trim($_POST['admin_password'] ?? '');
    $appUrl = rtrim(trim($_POST['app_url'] ?? $autoDetectedUrl), '/');
    $webhookSecret = trim($_POST['webhook_secret'] ?? 'viraa_secret_' . bin2hex(random_bytes(4)));
    $requirePublic = isset($_POST['require_public_channel']) ? 'true' : 'false';
    $autoSetWebhook = isset($_POST['auto_set_webhook']);

    if (empty($botToken)) {
        $message = 'لطفاً توکن ربات تلگرام را وارد کنید.';
        $messageType = 'error';
    } else {
        $cleanUsername = ltrim($botUsername, '@');
        $configContent = "<?php\\n\\nreturn [\\n" .
            "    'bot_token' => '" . addslashes($botToken) . "',\\n" .
            "    'bot_username' => '" . addslashes($cleanUsername) . "',\\n" .
            "    'public_channel_id' => '" . addslashes($publicChannelId) . "',\\n" .
            "    'public_channel_url' => '" . addslashes($publicChannelUrl) . "',\\n" .
            "    'private_channel_id' => '" . addslashes($privateChannelId) . "',\\n" .
            "    'require_public_channel' => " . $requirePublic . ",\\n" .
            "    'admin_telegram_id' => '" . addslashes($adminTelegramId) . "',\\n" .
            "    'admin_password' => '" . addslashes($adminPassword ?: 'ViraaAdmin@2026') . "',\\n" .
            "    'webhook_secret' => '" . addslashes($webhookSecret) . "',\\n" .
            "    'app_url' => '" . addslashes($appUrl) . "',\\n" .
            "    'db_driver' => 'sqlite',\\n" .
            "    'db_file' => __DIR__ . '/data/database.sqlite',\\n" .
            "    'db_host' => '127.0.0.1',\\n" .
            "    'db_port' => '3306',\\n" .
            "    'db_name' => 'viraa_bot',\\n" .
            "    'db_user' => 'root',\\n" .
            "    'db_pass' => '',\\n" .
            "    'log_file' => __DIR__ . '/logs/bot.log',\\n" .
            "    'error_log_file' => __DIR__ . '/logs/error.log',\\n" .
            "    'log_max_mb' => 10,\\n" .
            "    'log_budget_mb' => 300,\\n" .
            "    'broadcast_rate_per_sec' => 25\\n" .
            "];\\n";

        $saved = file_put_contents(__DIR__ . '/config.php', $configContent);

        if ($saved === false) {
            $message = 'خطا در ذخیره فایل config.php!';
            $messageType = 'error';
        } else {
            $message = 'فایل کانفیگ (config.php) با موفقیت ایجاد و ذخیره شد! 🎉';
            $messageType = 'success';

            try {
                $newConfig = require __DIR__ . '/config.php';
                $pdo = Database::getConnection($newConfig);
                Database::initTables($pdo);
            } catch (Throwable $e) {
            }

            $webhookUrl = $appUrl . '/webhook.php';
            $directTelegramUrl = 'https://api.telegram.org/bot' . $botToken . '/setWebhook?url=' . urlencode($webhookUrl);
            if (!empty($webhookSecret)) {
                $directTelegramUrl .= '&secret_token=' . urlencode($webhookSecret);
            }

            if ($autoSetWebhook) {
                $api = new TelegramApi($botToken);
                $webhookResult = $api->setWebhook($webhookUrl, $webhookSecret);
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>Config Maker</title>
</head>
<body style="font-family: system-ui; background: #0f172a; color: #fff; padding: 20px;">
    <h2>سازنده خودکار فایل config.php</h2>
    <p>فرم اطلاعات ربات، کانال‌ها و وب‌هوک خودکار به صورت کامل پیاده‌سازی شده است.</p>
</body>
</html>`
  },
  {
    name: 'config.php',
    path: 'config.php',
    description: 'فایل پیکربندی ساده و مختصر ربات',
    content: `<?php

return [
    'bot_token' => getenv('TELEGRAM_BOT_TOKEN') ?: 'YOUR_BOT_TOKEN_HERE',
    'bot_username' => getenv('TELEGRAM_BOT_USERNAME') ?: 'viraa_mini_course_bot',
    'public_channel_id' => getenv('TELEGRAM_PUBLIC_CHANNEL_ID') ?: '-1001234567890',
    'public_channel_url' => getenv('TELEGRAM_PUBLIC_CHANNEL_URL') ?: 'https://t.me/viraa_english',
    'private_channel_id' => getenv('TELEGRAM_PRIVATE_CHANNEL_ID') ?: '-1009876543210',
    'require_public_channel' => (bool)(getenv('REQUIRE_PUBLIC_CHANNEL') !== false ? getenv('REQUIRE_PUBLIC_CHANNEL') : true),
    'admin_telegram_id' => getenv('INITIAL_OWNER_TELEGRAM_ID') ?: '123456789',
    'admin_password' => getenv('ADMIN_PANEL_PASSWORD') ?: 'ViraaAdmin@2026',
    'webhook_secret' => getenv('TELEGRAM_WEBHOOK_SECRET') ?: 'viraa_secret_key_123',
    'app_url' => getenv('APP_URL') ?: 'http://localhost:8000',
    'db_driver' => getenv('DB_CONNECTION') ?: 'sqlite',
    'db_file' => __DIR__ . '/data/database.sqlite',
    'db_host' => getenv('DB_HOST') ?: '127.0.0.1',
    'db_port' => getenv('DB_PORT') ?: '3306',
    'db_name' => getenv('DB_DATABASE') ?: 'viraa_bot',
    'db_user' => getenv('DB_USERNAME') ?: 'root',
    'db_pass' => getenv('DB_PASSWORD') ?: '',
    'log_file' => __DIR__ . '/logs/bot.log',
    'error_log_file' => __DIR__ . '/logs/error.log',
    'log_max_mb' => 10,
    'log_budget_mb' => 300,
    'broadcast_rate_per_sec' => 25
];`
  },
  {
    name: '.env.example',
    path: '.env.example',
    description: 'نمونه مقادیر محیطی برای مدیر سرور',
    content: `TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_BOT_USERNAME=viraa_mini_course_bot
TELEGRAM_PUBLIC_CHANNEL_ID=-1001234567890
TELEGRAM_PUBLIC_CHANNEL_URL=https://t.me/viraa_english
TELEGRAM_PRIVATE_CHANNEL_ID=-1009876543210
REQUIRE_PUBLIC_CHANNEL=true
INITIAL_OWNER_TELEGRAM_ID=123456789
ADMIN_PANEL_PASSWORD=ViraaAdmin@2026
TELEGRAM_WEBHOOK_SECRET=viraa_secret_key_123
APP_URL=https://your-domain.com
DB_CONNECTION=sqlite
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=viraa_bot
DB_USERNAME=root
DB_PASSWORD=
BROADCAST_RATE_PER_SECOND=25
LOG_MAX_MB=10
LOG_BUDGET_MB=300`
  },
  {
    name: 'schema.sql',
    path: 'schema.sql',
    description: 'اسکیما و ساختار جداول پایگاه داده',
    content: `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    custom_name TEXT,
    phone TEXT,
    phone_normalized TEXT,
    phone_method TEXT,
    phone_verified INTEGER DEFAULT 0,
    registration_step TEXT DEFAULT 'started',
    public_channel_verified INTEGER DEFAULT 0,
    public_channel_verified_at TEXT,
    is_eligible INTEGER DEFAULT 0,
    eligible_at TEXT,
    private_channel_status TEXT DEFAULT 'none',
    private_channel_requested_at TEXT,
    private_channel_approved_at TEXT,
    is_bot_blocked INTEGER DEFAULT 0,
    campaign_source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_users_step ON users(registration_step);
CREATE INDEX IF NOT EXISTS idx_users_eligible ON users(is_eligible);
CREATE INDEX IF NOT EXISTS idx_users_private_status ON users(private_channel_status);

CREATE TABLE IF NOT EXISTS join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    invite_link TEXT,
    rejection_reason TEXT,
    attempt_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE(telegram_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_user ON join_requests(telegram_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 10,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    reserved_at TEXT,
    last_error TEXT,
    run_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_run ON job_queue(status, run_after);
CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(job_type);

CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message_text TEXT NOT NULL,
    photo_url TEXT,
    button_text TEXT,
    button_url TEXT,
    target_segment TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    total_target INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    blocked_count INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    telegram_message_id TEXT,
    error_message TEXT,
    sent_at TEXT,
    UNIQUE(broadcast_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON broadcast_recipients(broadcast_id, status);

CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT,
    admin_name TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS funnel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    campaign_source TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funnel_event ON funnel_events(event_name);
CREATE INDEX IF NOT EXISTS idx_funnel_user ON funnel_events(telegram_id);`
  },
  {
    name: 'index.php',
    path: 'index.php',
    description: 'نقطه ورود وب، وب‌هوک و پنل مدیریت',
    content: `<?php

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
        $baseUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\\\' ? '' : $scriptDir);
    }

    $webhookUrl = rtrim($baseUrl, '/') . '/index.php?action=webhook';
    $customUrl = $_GET['url'] ?? '';
    if (!empty($customUrl)) {
        $webhookUrl = $customUrl;
    }

    $res = $telegram->setWebhook($webhookUrl, $config['webhook_secret'] ?? null);
    $ok = $res['ok'] ?? false;
    $desc = $res['description'] ?? ($ok ? 'Webhook was set' : 'Failed to set webhook');
    echo '<div style="font-family: system-ui; direction: rtl; text-align: center; padding: 40px; background: #0f172a; color: #fff;">';
    echo '<h2>وضعیت وب‌هوک: ' . ($ok ? 'موفقیت‌آمیز ✅' : 'خطا ❌') . '</h2>';
    echo '<p>' . htmlspecialchars($desc, ENT_QUOTES, 'UTF-8') . '</p>';
    echo '<p><code>' . htmlspecialchars($webhookUrl, ENT_QUOTES, 'UTF-8') . '</code></p>';
    echo '</div>';
    exit;
}

if ($action === 'get_webhook_info') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($telegram->getWebhookInfo(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete_webhook') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($telegram->deleteWebhook(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'install') {
    header('Content-Type: text/html; charset=utf-8');
    Database::initTables($pdo);
    echo '<div style="font-family: system-ui; direction: rtl; text-align: center; padding: 40px; background: #0f172a; color: #34d399;"><h2>جداول دیتابیس ساخته شد ✅</h2></div>';
    exit;
}

if ($action === 'run_worker') {
    header('Content-Type: application/json; charset=utf-8');
    $jobs = $queue->reserve(10, 60);
    foreach ($jobs as $job) {
        $queue->complete($job['id']);
    }
    echo json_encode(['ok' => true, 'processed' => count($jobs)]);
    exit;
}

if ($action === 'manual_approve' && !empty($_GET['uid'])) {
    $uid = trim($_GET['uid']);
    $user = $bot->getUser($uid);
    if ($user) {
        $chatId = $config['private_channel_id'] ?? '';
        $admin->manualApprove($uid, 'admin', 'مدیر سیستم', 'web_override');
        $bot->executeApproveJoinRequest($uid, $chatId);
    }
    header('Location: index.php?msg=approved');
    exit;
}

$searchQuery = trim($_GET['search'] ?? '');
$statusFilter = trim($_GET['status'] ?? '');
$usersList = $admin->getUsersList(['search' => $searchQuery, 'status' => $statusFilter], 100, 0, true);
$m = $admin->getFunnelMetrics();

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>پنل مدیریت و پایش مینی‌دوره | ویرا انگلیش</title>
    <style>
        body { font-family: system-ui; background: #0b1329; color: #f1f5f9; margin: 0; padding: 24px; }
        .wrapper { max-width: 1200px; margin: 0 auto; }
        .card { background: #1e293b; border-radius: 14px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
        .metric-box { background: #0f172a; padding: 16px; border-radius: 10px; text-align: center; }
        .metric-val { font-size: 24px; font-weight: bold; color: #38bdf8; font-family: monospace; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
        th, td { padding: 10px; border-bottom: 1px solid #334155; text-align: right; }
        th { background: #0f172a; color: #94a3b8; }
        .user-tag { color: #38bdf8; text-decoration: none; font-weight: bold; }
        .btn { background: #0284c7; color: #fff; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 12px; display: inline-block; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
            <h2>🎓 پنل پایش و مدیریت مینی‌دوره ویرا انگلیش</h2>
            <div>
                <a href="?action=export" class="btn" style="background: #059669;">📥 دانلود اکسل (CSV)</a>
                <a href="webhook.php?action=logs" target="_blank" class="btn">📜 لاگ‌های زنده</a>
                <a href="webhook.php?action=diagnose" target="_blank" class="btn">🩺 تست عیب‌یابی</a>
            </div>
        </div>

        <div class="card">
            <h3>📊 آمار کلی قیف</h3>
            <div class="metrics-grid">
                <div class="metric-box"><div class="metric-val"><?= number_format($m['total_users']) ?></div><div>کل ورودی‌ها</div></div>
                <div class="metric-box"><div class="metric-val"><?= number_format($m['name_submitted']) ?></div><div>ثبت نام</div></div>
                <div class="metric-box"><div class="metric-val"><?= number_format($m['phone_submitted']) ?></div><div>ارسال شماره (<?= $m['phone_rate'] ?>%)</div></div>
                <div class="metric-box"><div class="metric-val"><?= number_format($m['eligible']) ?></div><div>واجد شرایط دوره (<?= $m['eligible_rate'] ?>%)</div></div>
                <div class="metric-box"><div class="metric-val" style="color: #34d399;"><?= number_format($m['approved']) ?></div><div>عضو کانال دوره (<?= $m['approved_rate'] ?>%)</div></div>
            </div>
        </div>

        <div class="card">
            <h3>👥 فهرست کاربران با نام کاربری (Username)</h3>
            <table>
                <thead>
                    <tr><th>#</th><th>نام</th><th>نام کاربری تلگرام</th><th>شماره تماس</th><th>شناسه تلگرام</th><th>واجد شرایط</th><th>کانال دوره</th><th>عملیات</th></tr>
                </thead>
                <tbody>
                    <?php foreach ($usersList as $i => $u): ?>
                        <tr>
                            <td><?= $i + 1 ?></td>
                            <td><?= htmlspecialchars($u['custom_name'] ?: ($u['first_name'] ?: 'کاربر'), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= !empty($u['username']) ? '<a href="https://t.me/' . htmlspecialchars(ltrim($u['username'], '@'), ENT_QUOTES, 'UTF-8') . '" target="_blank" class="user-tag">@' . htmlspecialchars(ltrim($u['username'], '@'), ENT_QUOTES, 'UTF-8') . '</a>' : '<span style="color:#64748b">ندارد</span>' ?></td>
                            <td dir="ltr"><?= htmlspecialchars((string)($u['phone_normalized'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= htmlspecialchars((string)$u['telegram_id'], ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= (int)$u['is_eligible'] === 1 ? 'بله ✅' : 'خیر ❌' ?></td>
                            <td><?= htmlspecialchars((string)$u['private_channel_status'], ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?php if ($u['private_channel_status'] !== 'approved'): ?><a href="?action=manual_approve&uid=<?= urlencode((string)$u['telegram_id']) ?>" class="btn">تأیید فوری</a><?php else: ?><span style="color:#34d399">عضو شده</span><?php endif; ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`
  },
  {
    name: 'worker.php',
    path: 'worker.php',
    description: 'پردازشگر دائمی صف تأیید عضویت و ارسال پیام‌های انبوه',
    content: `<?php

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Logger.php';
require_once __DIR__ . '/src/TelegramApi.php';
require_once __DIR__ . '/src/QueueService.php';
require_once __DIR__ . '/src/BotService.php';
require_once __DIR__ . '/src/BroadcastService.php';

$config = require __DIR__ . '/config.php';
$logger = new Logger($config);
$pdo = Database::getConnection($config);
$telegram = new TelegramApi($config['bot_token'], $logger);
$queue = new QueueService($pdo, $logger);
$bot = new BotService($pdo, $telegram, $queue, $config, $logger);
$broadcast = new BroadcastService($pdo, $telegram, $logger, (int)($config['broadcast_rate_per_sec'] ?? 25));

$once = in_array('--once', $argv, true);
$running = true;

if (function_exists('pcntl_signal')) {
    pcntl_signal(SIGTERM, function () use (&$running) {
        $running = false;
    });
    pcntl_signal(SIGINT, function () use (&$running) {
        $running = false;
    });
}

while ($running) {
    if (function_exists('pcntl_signal_dispatch')) {
        pcntl_signal_dispatch();
    }

    $jobs = $queue->reserve(10, 60);

    if (empty($jobs)) {
        $campaignStmt = $pdo->query('SELECT id FROM broadcasts WHERE status = "sending" LIMIT 1');
        $activeCampaign = $campaignStmt->fetchColumn();

        if ($activeCampaign) {
            $processed = $broadcast->processBatch((int)$activeCampaign, 25);
            if ($processed > 0) {
                continue;
            }
        }

        if ($once) {
            break;
        }
        sleep(2);
        continue;
    }

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
                    $queue->fail($id, 'Max attempts reached without success');
                } else {
                    $delay = pow(2, $attempts) * 5;
                    $queue->release($id, $delay, 'Failed attempt ' . $attempts);
                }
            }
        } catch (Throwable $e) {
            $logger->error('worker_job_exception', [
                'job_id' => $id,
                'job_type' => $type,
                'error' => $e->getMessage()
            ]);

            if ($attempts >= $maxAttempts) {
                $queue->fail($id, $e->getMessage());
            } else {
                $delay = pow(2, $attempts) * 5;
                $queue->release($id, $delay, $e->getMessage());
            }
        }
    }

    if ($once) {
        break;
    }
}`
  },
  {
    name: 'cron.php',
    path: 'cron.php',
    description: 'اسکریپت وظایف زمان‌بندی‌شده و پاک‌سازی داده‌ها',
    content: `<?php

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Logger.php';
require_once __DIR__ . '/src/QueueService.php';

$config = require __DIR__ . '/config.php';
$logger = new Logger($config);
$pdo = Database::getConnection($config);
$queue = new QueueService($pdo, $logger);

$logDir = dirname($config['log_file']);
$logger->enforceBudget($logDir);

$deletedJobs = $queue->cleanOldJobs(30);

$auditRetentionDays = 365;
$auditThreshold = date('Y-m-d H:i:s', strtotime("-{$auditRetentionDays} days"));
$stmt = $pdo->prepare('DELETE FROM audit_logs WHERE created_at < ?');
$stmt->execute([$auditThreshold]);
$deletedAudits = $stmt->rowCount();

$logger->info('cron_maintenance_completed', [
    'deleted_jobs' => $deletedJobs,
    'deleted_audits' => $deletedAudits
]);

echo "Maintenance finished. Cleared {$deletedJobs} old jobs, {$deletedAudits} old audit records.\n";`
  },
  {
    name: 'install.php',
    path: 'install.php',
    description: 'اسکریپت خط فرمان نصب پایگاه‌داده و مقداردهی اولیه',
    content: `<?php

require_once __DIR__ . '/src/Database.php';

$config = require __DIR__ . '/config.php';

echo "=== Viraa English Mini-Course Bot Installer ===\n";
echo "Setting up database and initial settings...\n";

try {
    $pdo = Database::getConnection($config);
    Database::initTables($pdo);

    $ownerId = $config['admin_telegram_id'] ?? '123456789';
    $now = date('Y-m-d H:i:s');
    $stmt = $pdo->prepare('
        INSERT OR IGNORE INTO admins (telegram_id, name, role, is_active, created_at, updated_at)
        VALUES (?, "مدیر ارشد (مالک)", "owner", 1, ?, ?)
    ');
    $stmt->execute([$ownerId, $now, $now]);

    $logDir = dirname($config['log_file']);
    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }

    echo "SUCCESS: Database schema created and default settings seeded!\n";
    echo "Initial Owner Telegram ID: " . $ownerId . "\n";
    echo "Web Admin Panel URL: " . ($config['app_url'] ?? 'http://localhost:8000') . "\n";
} catch (Throwable $e) {
    echo "ERROR during installation: " . $e->getMessage() . "\n";
    exit(1);
}`
  },
  {
    name: 'doctor.php',
    path: 'doctor.php',
    description: 'ابزار تشخیصی و سلامت‌سنجی خط فرمان سرور',
    content: `<?php

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/TelegramApi.php';

$config = require __DIR__ . '/config.php';

echo "=====================================================\n";
echo "   Viraa English Mini-Course Bot - System Doctor     \n";
echo "=====================================================\n\n";

$allPassed = true;

function checkItem(string $title, bool $condition, string $detail = ''): void {
    global $allPassed;
    if ($condition) {
        echo "  [OK] " . str_pad($title, 32) . ($detail ? " ($detail)" : "") . "\n";
    } else {
        $allPassed = false;
        echo "  [FAIL] " . str_pad($title, 32) . ($detail ? " ($detail)" : "") . "\n";
    }
}

checkItem('PHP Version >= 8.1', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION);

$reqExts = ['curl', 'pdo', 'mbstring', 'json'];
foreach ($reqExts as $ext) {
    checkItem("PHP Extension: $ext", extension_loaded($ext));
}

$dbDriver = $config['db_driver'] ?? 'sqlite';
if ($dbDriver === 'sqlite') {
    checkItem('PHP Extension: pdo_sqlite', extension_loaded('pdo_sqlite'));
} else {
    checkItem('PHP Extension: pdo_mysql', extension_loaded('pdo_mysql'));
}

$dirs = [
    'logs' => dirname($config['log_file']),
    'data' => dirname($config['db_file'])
];
foreach ($dirs as $name => $path) {
    if (!is_dir($path)) {
        mkdir($path, 0755, true);
    }
    checkItem("Directory Writable: $name", is_writable($path), $path);
}

try {
    $pdo = Database::getConnection($config);
    $pdo->query('SELECT 1');
    checkItem('Database Connection', true, $dbDriver);
} catch (Throwable $e) {
    checkItem('Database Connection', false, $e->getMessage());
}

$telegram = new TelegramApi($config['bot_token']);
$me = $telegram->getMe();
if ($me['ok'] ?? false) {
    checkItem('Telegram Bot Token', true, '@' . ($me['result']['username'] ?? ''));
    $wh = $telegram->getWebhookInfo();
    if ($wh['ok'] ?? false) {
        $url = $wh['result']['url'] ?? '';
        checkItem('Telegram Webhook Info', true, $url ?: 'Not registered yet');
    }
} else {
    checkItem('Telegram Bot Token', false, $me['description'] ?? 'Token invalid or no internet connection');
}

echo "\n-----------------------------------------------------\n";
if ($allPassed) {
    echo "  Status: ALL SYSTEMS OPERATIONAL!\n";
} else {
    echo "  Status: SOME CHECKS FAILED. Review items marked [FAIL].\n";
}
echo "=====================================================\n";`
  },
  {
    name: 'src/Database.php',
    path: 'src/Database.php',
    description: 'اتصال دیتابیس PDO و سازنده جداول',
    content: `<?php

class Database
{
    private static ?PDO $pdo = null;

    public static function getConnection(array $config): PDO
    {
        if (self::$pdo === null) {
            $driver = $config['db_driver'] ?? 'sqlite';
            if ($driver === 'sqlite') {
                $dbFile = $config['db_file'];
                $dir = dirname($dbFile);
                if (!is_dir($dir)) {
                    mkdir($dir, 0755, true);
                }
                self::$pdo = new PDO('sqlite:' . $dbFile);
                self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                self::$pdo->exec('PRAGMA journal_mode = WAL');
                self::$pdo->exec('PRAGMA busy_timeout = 5000');
            } else {
                $dsn = sprintf(
                    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                    $config['db_host'] ?? '127.0.0.1',
                    $config['db_port'] ?? '3306',
                    $config['db_name'] ?? 'viraa_bot'
                );
                self::$pdo = new PDO($dsn, $config['db_user'] ?? '', $config['db_pass'] ?? '');
                self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            }
            self::ensureTablesExist(self::$pdo);
        }
        return self::$pdo;
    }

    public static function ensureTablesExist(PDO $pdo): void
    {
        try {
            $pdo->query('SELECT 1 FROM users LIMIT 1');
        } catch (Throwable $e) {
            self::initTables($pdo);
        }
    }

    public static function initTables(PDO $pdo): void
    {
        $schemaFile = dirname(__DIR__) . '/schema.sql';
        if (file_exists($schemaFile)) {
            $sql = file_get_contents($schemaFile);
            $statements = array_filter(array_map('trim', explode(';', $sql)));
            foreach ($statements as $stmt) {
                if (!empty($stmt)) {
                    $pdo->exec($stmt);
                }
            }
        }
        self::seedDefaultSettings($pdo);
    }

    private static function seedDefaultSettings(PDO $pdo): void
    {
        $now = date('Y-m-d H:i:s');
        $defaults = [
            'require_public_channel' => '1',
            'msg_welcome' => "سلام {name} عزیز! 👋\n\nبه مینی‌دوره رایگان ویرا انگلیش خوش اومدی.\nتوی این مینی‌دوره قراره مهم‌ترین تکنیک‌های یادگیری مکالمه انگلیسی رو با هم یاد بگیریم.\n\nبرای شروع، لطفاً دکمه زیر رو بزن تا مراحل رو با هم پیش بریم:",
            'btn_start_registration' => 'دریافت دسترسی رایگان 🚀',
            'msg_ask_name' => "خیلی خوشحالیم که همراه مایی! ✨\n\nدوست داری با چه اسمی صدات کنیم؟\nلطفاً نام یا نام خانوادگیت رو بنویس:",
            'msg_ask_phone' => "ممنون {name} عزیز! 🌹\n\nجهت ثبت‌نام قطعی و ارسال نکات پشتیبانی دوره، شماره تماست رو برامون بفرست.\nمی‌تونی با زدن دکمه زیر شماره تلگرامت رو بفرستی، یا دستی تایپش کنی:",
            'btn_send_phone' => '📱 ارسال شماره من',
            'msg_public_channel_check' => "یک گام تا دسترسی کامل به مینی‌دوره باقی مونده! 📢\n\nلطفاً ابتدا در کانال اطلاع‌رسانی ویرا انگلیش عضو شو و بعد دکمه بررسی رو بزن:",
            'btn_join_public_channel' => 'عضویت در کانال عمومی ویرا 📢',
            'btn_check_public_channel' => 'عضو شدم؛ بررسی کن ✅',
            'msg_qualified' => "تبریک {name} عزیز! 🎉\n\nثبت‌نامت تکمیل شد و دسترسی رایگان برات باز شد.\nحالا روی لینک زیر کلیک کن و دکمه Request to Join (درخواست عضویت) رو بزن تا بلافاصله به کانال اختصاصی مینی‌دوره اضافه بشی:",
            'btn_private_join_request' => 'ورود به کانال مینی‌دوره 🎓',
            'msg_join_pending' => "درخواستت ثبت شد و در حال بررسیه! ⏳\nبه زودی تأیید میشه و پیامی برات میاد.",
            'msg_join_approved' => "دسترسی مینی‌دوره برات فعال شد! 🌟\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:",
            'btn_enter_course' => 'شروع درس‌های مینی‌دوره 🚀',
            'msg_already_member' => "شما از قبل عضو کانال مینی‌دوره هستید! 📚\nمی‌تونید همین الان از محتوای دوره استفاده کنید.",
            'msg_phone_invalid' => "شماره وارد شده معتبر نیست. لطفاً یک شماره موبایل صحیح (مثلاً 09123456789) ارسال کنید:"
        ];

        $stmt = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
        foreach ($defaults as $key => $val) {
            $stmt->execute([$key, $val, $now]);
        }
    }
}`
  },
  {
    name: 'src/TelegramApi.php',
    path: 'src/TelegramApi.php',
    description: 'کلاینت ارتباط با Bot API تلگرام با استفاده از cURL',
    content: `<?php

class TelegramApi
{
    private string $token;
    private string $baseUrl;
    private ?Logger $logger;

    public function __construct(string $token, ?Logger $logger = null)
    {
        $this->token = $token;
        $this->baseUrl = 'https://api.telegram.org/bot' . $token . '/';
        $this->logger = $logger;
    }

    public function getMe(): array
    {
        return $this->request('getMe');
    }

    public function sendMessage(string|int $chatId, string $text, ?array $replyMarkup = null, string $parseMode = 'HTML'): array
    {
        $params = [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => $parseMode,
            'disable_web_page_preview' => false
        ];
        if ($replyMarkup !== null) {
            $params['reply_markup'] = json_encode($replyMarkup);
        }
        return $this->request('sendMessage', $params);
    }

    public function sendPhoto(string|int $chatId, string $photo, string $caption = '', ?array $replyMarkup = null, string $parseMode = 'HTML'): array
    {
        $params = [
            'chat_id' => $chatId,
            'photo' => $photo,
            'caption' => $caption,
            'parse_mode' => $parseMode
        ];
        if ($replyMarkup !== null) {
            $params['reply_markup'] = json_encode($replyMarkup);
        }
        return $this->request('sendPhoto', $params);
    }

    public function getChat(string|int $chatId): array
    {
        return $this->request('getChat', [
            'chat_id' => $chatId
        ]);
    }

    public function answerCallbackQuery(string $callbackQueryId, ?string $text = null, bool $showAlert = false): array
    {
        $params = [
            'callback_query_id' => $callbackQueryId
        ];
        if ($text !== null) {
            $params['text'] = $text;
            $params['show_alert'] = $showAlert;
        }
        return $this->request('answerCallbackQuery', $params);
    }

    public function getChatMember(string|int $chatId, string|int $userId): array
    {
        return $this->request('getChatMember', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function approveChatJoinRequest(string|int $chatId, string|int $userId): array
    {
        return $this->request('approveChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function declineChatJoinRequest(string|int $chatId, string|int $userId): array
    {
        return $this->request('declineChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function createChatInviteLink(string|int $chatId, string $name, bool $createsJoinRequest = true): array
    {
        return $this->request('createChatInviteLink', [
            'chat_id' => $chatId,
            'name' => $name,
            'creates_join_request' => $createsJoinRequest
        ]);
    }

    public function setWebhook(string $url, ?string $secretToken = null, array $allowedUpdates = []): array
    {
        $params = [
            'url' => $url,
            'drop_pending_updates' => false
        ];
        if (!empty($secretToken)) {
            $params['secret_token'] = $secretToken;
        }
        if (!empty($allowedUpdates)) {
            $params['allowed_updates'] = json_encode($allowedUpdates);
        } else {
            $params['allowed_updates'] = json_encode(['message', 'callback_query', 'chat_join_request', 'my_chat_member']);
        }
        return $this->request('setWebhook', $params);
    }

    public function getWebhookInfo(): array
    {
        return $this->request('getWebhookInfo');
    }

    private function request(string $method, array $params = []): array
    {
        $url = $this->baseUrl . $method;
        $ch = curl_init();

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            if ($this->logger) {
                $this->logger->error('telegram_api_curl_failed', [
                    'method' => $method,
                    'error' => $error
                ]);
            }
            return [
                'ok' => false,
                'error_code' => 0,
                'description' => 'cURL Error: ' . $error
            ];
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            if ($this->logger) {
                $this->logger->error('telegram_api_invalid_json', [
                    'method' => $method,
                    'http_code' => $httpCode,
                    'raw_response' => substr($response, 0, 200)
                ]);
            }
            return [
                'ok' => false,
                'error_code' => $httpCode,
                'description' => 'Invalid JSON response from Telegram API'
            ];
        }

        if (!$decoded['ok'] && $this->logger) {
            $this->logger->warning('telegram_api_error_response', [
                'method' => $method,
                'http_code' => $httpCode,
                'error_code' => $decoded['error_code'] ?? null,
                'description' => $decoded['description'] ?? 'Unknown error'
            ]);
        }

        return $decoded;
    }
}`
  },
  {
    name: 'src/BotService.php',
    path: 'src/BotService.php',
    description: 'منطق فرآیند ثبت‌نام، شماره، کانال عمومی و تأیید درخواست عضویت',
    content: `<?php

class BotService
{
    private PDO $pdo;
    private TelegramApi $telegram;
    private QueueService $queue;
    private ?Logger $logger;
    private array $config;

    public function __construct(PDO $pdo, TelegramApi $telegram, QueueService $queue, array $config, ?Logger $logger = null)
    {
        $this->pdo = $pdo;
        $this->telegram = $telegram;
        $this->queue = $queue;
        $this->config = $config;
        $this->logger = $logger;
    }

    public function handleUpdate(array $update): void
    {
        if (isset($update['message'])) {
            $this->handleMessage($update['message']);
        } elseif (isset($update['callback_query'])) {
            $this->handleCallbackQuery($update['callback_query']);
        } elseif (isset($update['chat_join_request'])) {
            $this->handleChatJoinRequest($update['chat_join_request']);
        } elseif (isset($update['my_chat_member'])) {
            $this->handleMyChatMember($update['my_chat_member']);
        }
    }

    private function handleMessage(array $message): void
    {
        $from = $message['from'] ?? null;
        if (!$from || ($from['is_bot'] ?? false)) {
            return;
        }

        $telegramId = (string)$from['id'];
        $chatId = $message['chat']['id'] ?? $telegramId;
        $text = trim($message['text'] ?? '');
        $now = date('Y-m-d H:i:s');

        $user = $this->getOrCreateUser($from);

        if (str_starts_with($text, '/start')) {
            $parts = explode(' ', $text, 2);
            $campaign = isset($parts[1]) ? trim($parts[1]) : null;
            if ($campaign && empty($user['campaign_source'])) {
                $this->updateUser($telegramId, ['campaign_source' => $campaign]);
                $user['campaign_source'] = $campaign;
            }
            $this->logFunnelEvent($telegramId, 'bot_start', $user['campaign_source']);
            $this->sendWelcomeStep($chatId, $user);
            return;
        }

        if (isset($message['contact'])) {
            $this->handleContactInput($chatId, $user, $message['contact'], $from['id']);
            return;
        }

        $step = $user['registration_step'] ?? 'started';

        if ($step === 'started') {
            $this->sendWelcomeStep($chatId, $user);
        } elseif ($step === 'ask_name') {
            $this->handleNameInput($chatId, $user, $text);
        } elseif ($step === 'ask_phone') {
            $this->handlePhoneTextInput($chatId, $user, $text);
        } elseif ($step === 'public_channel_check') {
            $this->verifyPublicChannelStep($chatId, $user);
        } elseif ($step === 'eligible' || $step === 'approved') {
            $this->sendCourseLinkStep($chatId, $user);
        } else {
            $this->sendWelcomeStep($chatId, $user);
        }
    }

    private function handleCallbackQuery(array $callbackQuery): void
    {
        $id = $callbackQuery['id'];
        $from = $callbackQuery['from'];
        $telegramId = (string)$from['id'];
        $data = $callbackQuery['data'] ?? '';
        $message = $callbackQuery['message'] ?? null;
        $chatId = $message['chat']['id'] ?? $telegramId;

        $user = $this->getOrCreateUser($from);

        if ($data === 'start_registration') {
            $this->updateUser($telegramId, ['registration_step' => 'ask_name']);
            $this->logFunnelEvent($telegramId, 'registration_began', $user['campaign_source']);
            $namePrompt = $this->getSetting('msg_ask_name', "خیلی خوشحالیم که همراه مایی! ✨\\n\\nدوست داری با چه اسمی صدات کنیم؟\\nلطفاً نام یا نام خانوادگیت رو بنویس:");
            $this->telegram->sendMessage($chatId, $namePrompt);
        } elseif ($data === 'check_public_channel') {
            $this->verifyPublicChannelStep($chatId, $user);
        }

        $callbackId = (string)($callbackQuery['id'] ?? '');
        if (!empty($callbackId)) {
            $this->telegram->answerCallbackQuery($callbackId);
        }
    }

    private function handleChatJoinRequest(array $joinRequest): void
    {
        $from = $joinRequest['from'];
        $telegramId = (string)$from['id'];
        $chat = $joinRequest['chat'];
        $chatId = (string)$chat['id'];
        $inviteLink = $joinRequest['invite_link']['invite_link'] ?? null;
        $now = date('Y-m-d H:i:s');

        $user = $this->getOrCreateUser($from);

        $isEligible = ((int)($user['is_eligible'] ?? 0) === 1) ||
                      ((int)($user['public_channel_verified'] ?? 0) === 1) ||
                      (!empty($user['phone_normalized'])) ||
                      (!empty($user['phone']));

        $stmt = $this->pdo->prepare('
            INSERT INTO join_requests (telegram_id, chat_id, status, invite_link, created_at, updated_at)
            VALUES (?, ?, "pending", ?, ?, ?)
            ON CONFLICT(telegram_id, chat_id) DO UPDATE SET
                status = "pending",
                invite_link = COALESCE(excluded.invite_link, join_requests.invite_link),
                updated_at = excluded.updated_at
        ');
        $stmt->execute([$telegramId, $chatId, $inviteLink, $now, $now]);

        $this->logFunnelEvent($telegramId, 'join_request_submitted', $user['campaign_source'], ['chat_id' => $chatId]);

        if ($isEligible) {
            $this->updateUser($telegramId, [
                'is_eligible' => 1,
                'registration_step' => 'eligible'
            ]);
            $targetChatId = !empty($chatId) ? $chatId : ($this->config['private_channel_id'] ?? '');
            $this->executeApproveJoinRequest($telegramId, $targetChatId);
        } else {
            $msg = "درخواست ورودت به کانال خصوصی ثبت شد! ⏳\\nبرای اینکه عضویتت تأیید و کانال برات باز بشه، ابتدا باید دسترسی مینی‌دوره رو در ربات فعال کنی:";
            $this->telegram->sendMessage($telegramId, $msg, [
                'inline_keyboard' => [
                    [['text' => 'تکمیل ثبت‌نام و دریافت دسترسی فوری 🚀', 'callback_data' => 'start_registration']]
                ]
            ]);
        }
    }

    private function handleMyChatMember(array $myChatMember): void
    {
        $chat = $myChatMember['chat'];
        $newMember = $myChatMember['new_chat_member'] ?? [];
        $status = $newMember['status'] ?? '';
        $user = $myChatMember['from'];
        $telegramId = (string)$user['id'];

        if ($chat['type'] === 'private') {
            $isBlocked = in_array($status, ['kicked', 'left']) ? 1 : 0;
            $this->updateUser($telegramId, ['is_bot_blocked' => $isBlocked]);
        }
    }

    private function sendWelcomeStep(string|int $chatId, array $user): void
    {
        $this->updateUser($user['telegram_id'], ['registration_step' => 'started']);
        $name = $user['custom_name'] ?: ($user['first_name'] ?: 'کاربر');
        $text = $this->getSetting('msg_welcome');
        $btnText = $this->getSetting('btn_start_registration', 'دریافت دسترسی رایگان 🚀');

        $rendered = $this->replacePlaceholders($text, ['name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8')]);
        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnText, 'callback_data' => 'start_registration']
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $rendered, $keyboard);
    }

    private function handleNameInput(string|int $chatId, array $user, string $text): void
    {
        $telegramId = $user['telegram_id'];
        $cleanName = trim(strip_tags($text));

        if (mb_strlen($cleanName) < 2 || mb_strlen($cleanName) > 60) {
            $this->telegram->sendMessage($chatId, 'لطفاً یک نام معتبر (بین ۲ تا ۶۰ حرف) وارد کنید:');
            return;
        }

        $this->updateUser($telegramId, [
            'custom_name' => $cleanName,
            'registration_step' => 'ask_phone'
        ]);

        $this->logFunnelEvent($telegramId, 'name_submitted', $user['campaign_source'], ['name' => $cleanName]);

        $phoneMsg = $this->getSetting('msg_ask_phone');
        $rendered = $this->replacePlaceholders($phoneMsg, ['name' => htmlspecialchars($cleanName, ENT_QUOTES, 'UTF-8')]);
        $btnSendPhone = $this->getSetting('btn_send_phone', '📱 ارسال شماره من');

        $replyMarkup = [
            'keyboard' => [
                [
                    ['text' => $btnSendPhone, 'request_contact' => true]
                ]
            ],
            'resize_keyboard' => true,
            'one_time_keyboard' => true
        ];

        $this->telegram->sendMessage($chatId, $rendered, $replyMarkup);
    }

    private function handleContactInput(string|int $chatId, array $user, array $contact, int $senderId): void
    {
        $telegramId = $user['telegram_id'];
        $contactUserId = $contact['user_id'] ?? null;
        $rawPhone = $contact['phone_number'] ?? '';

        $isVerified = ($contactUserId !== null && (int)$contactUserId === (int)$senderId) ? 1 : 0;
        $normalized = $this->normalizePhone($rawPhone);

        if (!$normalized) {
            $err = $this->getSetting('msg_phone_invalid', 'شماره وارد شده معتبر نیست. لطفاً مجدداً شماره موبایل صحیح ارسال کنید:');
            $this->telegram->sendMessage($chatId, $err);
            return;
        }

        $this->updateUser($telegramId, [
            'phone' => $rawPhone,
            'phone_normalized' => $normalized,
            'phone_method' => 'contact_share',
            'phone_verified' => $isVerified,
            'registration_step' => 'public_channel_check'
        ]);

        $this->logFunnelEvent($telegramId, 'phone_submitted', $user['campaign_source'], [
            'method' => 'contact_share',
            'verified' => $isVerified
        ]);

        $this->removeReplyKeyboard($chatId);
        $this->proceedAfterPhone($chatId, $this->getUser($telegramId));
    }

    private function handlePhoneTextInput(string|int $chatId, array $user, string $text): void
    {
        $telegramId = $user['telegram_id'];
        $normalized = $this->normalizePhone($text);

        if (!$normalized) {
            $err = $this->getSetting('msg_phone_invalid', 'شماره وارد شده معتبر نیست. لطفاً یک شماره موبایل صحیح (مثلاً 09123456789) ارسال کنید:');
            $this->telegram->sendMessage($chatId, $err);
            return;
        }

        $this->updateUser($telegramId, [
            'phone' => $text,
            'phone_normalized' => $normalized,
            'phone_method' => 'manual_text',
            'phone_verified' => 0,
            'registration_step' => 'public_channel_check'
        ]);

        $this->logFunnelEvent($telegramId, 'phone_submitted', $user['campaign_source'], [
            'method' => 'manual_text',
            'verified' => 0
        ]);

        $this->removeReplyKeyboard($chatId);
        $this->proceedAfterPhone($chatId, $this->getUser($telegramId));
    }

    private function proceedAfterPhone(string|int $chatId, array $user): void
    {
        $requireChannel = $this->isPublicChannelRequired();

        if (!$requireChannel || (int)$user['public_channel_verified'] === 1) {
            $this->grantEligibility($chatId, $user);
        } else {
            $this->sendPublicChannelStep($chatId, $user);
        }
    }

    private function sendPublicChannelStep(string|int $chatId, array $user): void
    {
        $text = $this->getSetting('msg_public_channel_check');
        $btnJoin = $this->getSetting('btn_join_public_channel', 'عضویت در کانال عمومی ویرا 📢');
        $btnCheck = $this->getSetting('btn_check_public_channel', 'عضو شدم؛ بررسی کن ✅');
        $channelUrl = $this->config['public_channel_url'];

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnJoin, 'url' => $channelUrl]
                ],
                [
                    ['text' => $btnCheck, 'callback_data' => 'check_public_channel']
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $text, $keyboard);
    }

    public function verifyPublicChannelStep(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];

        if ((int)$user['public_channel_verified'] === 1) {
            $this->grantEligibility($chatId, $user);
            return;
        }

        $publicChannelId = $this->config['public_channel_id'];
        $resp = $this->telegram->getChatMember($publicChannelId, $telegramId);

        if ($resp['ok']) {
            $status = $resp['result']['status'] ?? '';
            if (in_array($status, ['creator', 'administrator', 'member'])) {
                $now = date('Y-m-d H:i:s');
                $this->updateUser($telegramId, [
                    'public_channel_verified' => 1,
                    'public_channel_verified_at' => $now
                ]);
                $this->logFunnelEvent($telegramId, 'public_channel_joined', $user['campaign_source']);
                $this->grantEligibility($chatId, $this->getUser($telegramId));
                return;
            }
        }

        $this->telegram->sendMessage($chatId, "هنوز عضویت شما در کانال عمومی تأیید نشده است. لطفاً ابتدا در کانال عضو شده و سپس مجدداً دکمه بررسی را بزنید:", [
            'inline_keyboard' => [
                [['text' => $this->getSetting('btn_join_public_channel'), 'url' => $this->config['public_channel_url']]],
                [['text' => $this->getSetting('btn_check_public_channel'), 'callback_data' => 'check_public_channel']]
            ]
        ]);
    }

    private function grantEligibility(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];
        $now = date('Y-m-d H:i:s');

        $this->updateUser($telegramId, [
            'is_eligible' => 1,
            'eligible_at' => $now,
            'registration_step' => 'eligible'
        ]);

        $this->logFunnelEvent($telegramId, 'eligible_granted', $user['campaign_source']);

        $this->sendCourseLinkStep($chatId, $user);

        $this->checkAndApprovePendingJoinRequests($telegramId);
    }

    private function sendCourseLinkStep(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];
        $privateChannelId = $this->config['private_channel_id'];

        $membershipCheck = $this->telegram->getChatMember($privateChannelId, $telegramId);
        if ($membershipCheck['ok']) {
            $status = $membershipCheck['result']['status'] ?? '';
            if (in_array($status, ['creator', 'administrator', 'member'])) {
                $alreadyMsg = $this->getSetting('msg_already_member');
                $this->telegram->sendMessage($chatId, $alreadyMsg);
                return;
            }
        }

        $inviteLink = $this->getOrCreateJoinRequestLink($privateChannelId);
        $name = $user['custom_name'] ?: ($user['first_name'] ?: 'کاربر');
        $msg = $this->getSetting('msg_qualified');
        $rendered = $this->replacePlaceholders($msg, [
            'name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'),
            'course_channel_link' => $inviteLink
        ]);

        $btnText = $this->getSetting('btn_private_join_request', 'ورود به کانال مینی‌دوره 🎓');
        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnText, 'url' => $inviteLink]
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $rendered, $keyboard);
    }

    public function checkAndApprovePendingJoinRequests(string $telegramId): void
    {
        $stmt = $this->pdo->prepare('
            SELECT id, chat_id
            FROM join_requests
            WHERE telegram_id = ? AND status = "pending"
        ');
        $stmt->execute([$telegramId]);
        $requests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($requests as $req) {
            $this->queue->push('approve_join_request', [
                'telegram_id' => $telegramId,
                'chat_id' => $req['chat_id']
            ], 1);
        }
    }

    public function executeApproveJoinRequest(string $telegramId, string $chatId): bool
    {
        $now = date('Y-m-d H:i:s');
        $primaryChatId = !empty($chatId) ? $chatId : ($this->config['private_channel_id'] ?? '');
        $fallbackChatId = (string)($this->config['private_channel_id'] ?? '');

        $resp = $this->telegram->approveChatJoinRequest($primaryChatId, $telegramId);

        if (empty($resp['ok']) && !empty($fallbackChatId) && (string)$primaryChatId !== $fallbackChatId) {
            $resp = $this->telegram->approveChatJoinRequest($fallbackChatId, $telegramId);
            if (!empty($resp['ok'])) {
                $primaryChatId = $fallbackChatId;
            }
        }

        if (empty($resp['ok']) && isset($resp['description']) && !str_contains($resp['description'], 'USER_ALREADY_PARTICIPANT')) {
            usleep(350000);
            $resp = $this->telegram->approveChatJoinRequest($primaryChatId, $telegramId);
        }

        $isSuccess = !empty($resp['ok']) || (isset($resp['description']) && str_contains($resp['description'], 'USER_ALREADY_PARTICIPANT'));

        if ($isSuccess) {
            $stmt = $this->pdo->prepare('
                UPDATE join_requests
                SET status = "approved", approved_at = ?, updated_at = ?
                WHERE telegram_id = ?
            ');
            $stmt->execute([$now, $now, $telegramId]);

            $this->updateUser($telegramId, [
                'private_channel_status' => 'approved',
                'private_channel_approved_at' => $now
            ]);

            $user = $this->getUser($telegramId);
            $this->logFunnelEvent($telegramId, 'join_request_approved', $user['campaign_source'] ?? null);

            $approvedMsg = $this->getSetting('msg_join_approved', "دسترسی مینی‌دوره برات فعال شد! 🌟\\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:");
            $btnEnter = $this->getSetting('btn_enter_course', 'شروع درس‌های مینی‌دوره 🚀');
            $courseUrl = !empty($fallbackChatId) ? 'https://t.me/c/' . ltrim($fallbackChatId, '-100') : ($this->config['public_channel_url'] ?? 'https://t.me');

            $this->telegram->sendMessage($telegramId, $approvedMsg, [
                'inline_keyboard' => [
                    [['text' => $btnEnter, 'url' => $courseUrl]]
                ]
            ]);

            return true;
        }

        $errorDesc = $resp['description'] ?? 'Telegram API error';
        $stmt = $this->pdo->prepare('
            UPDATE join_requests
            SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
            WHERE telegram_id = ?
        ');
        $stmt->execute([$errorDesc, $now, $telegramId]);

        return false;
    }

    private function getOrCreateJoinRequestLink(string $chatId): string
    {
        $stmt = $this->pdo->prepare('SELECT value FROM settings WHERE key = "cached_private_join_link"');
        $stmt->execute();
        $cached = $stmt->fetchColumn();
        if ($cached) {
            return $cached;
        }

        $resp = $this->telegram->createChatInviteLink($chatId, 'Viraa Mini Course Link', true);
        if ($resp['ok'] && isset($resp['result']['invite_link'])) {
            $link = $resp['result']['invite_link'];
            $now = date('Y-m-d H:i:s');
            $setStmt = $this->pdo->prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ("cached_private_join_link", ?, ?)');
            $setStmt->execute([$link, $now]);
            return $link;
        }

        return 'https://t.me/c/' . ltrim($chatId, '-100');
    }

    public function normalizePhone(string $phone): ?string
    {
        $persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        $arabicDigits  = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $englishDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

        $clean = str_replace($persianDigits, $englishDigits, $phone);
        $clean = str_replace($arabicDigits, $englishDigits, $clean);
        $clean = preg_replace('/[^\\d\\+]/', '', $clean);

        if (str_starts_with($clean, '0098')) {
            $clean = '0' . substr($clean, 4);
        } elseif (str_starts_with($clean, '+98')) {
            $clean = '0' . substr($clean, 3);
        } elseif (str_starts_with($clean, '98') && strlen($clean) === 12) {
            $clean = '0' . substr($clean, 2);
        }

        if (preg_match('/^09[0-9]{9}$/', $clean)) {
            return $clean;
        }

        if (str_starts_with($clean, '+') && strlen($clean) >= 8 && strlen($clean) <= 16) {
            return $clean;
        }

        return null;
    }

    private function removeReplyKeyboard(string|int $chatId): void
    {
        $this->telegram->sendMessage($chatId, 'شماره شما دریافت شد. در حال ادامه...', [
            'remove_keyboard' => true
        ]);
    }

    private function getOrCreateUser(array $from): array
    {
        $telegramId = (string)$from['id'];
        $now = date('Y-m-d H:i:s');

        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE telegram_id = ?');
        $stmt->execute([$telegramId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            $insert = $this->pdo->prepare('
                INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ');
            $insert->execute([
                $telegramId,
                $from['username'] ?? null,
                $from['first_name'] ?? null,
                $from['last_name'] ?? null,
                $now,
                $now
            ]);
            $stmt->execute([$telegramId]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
        } else {
            $update = $this->pdo->prepare('
                UPDATE users
                SET username = ?, first_name = ?, last_name = ?, updated_at = ?
                WHERE telegram_id = ?
            ');
            $update->execute([
                $from['username'] ?? null,
                $from['first_name'] ?? null,
                $from['last_name'] ?? null,
                $now,
                $telegramId
            ]);
        }

        return $user;
    }

    public function getUser(string $telegramId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE telegram_id = ?');
        $stmt->execute([$telegramId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function updateUser(string $telegramId, array $fields): void
    {
        $fields['updated_at'] = date('Y-m-d H:i:s');
        $setParts = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setParts[] = "{$col} = ?";
            $params[] = $val;
        }
        $params[] = $telegramId;

        $sql = 'UPDATE users SET ' . implode(', ', $setParts) . ' WHERE telegram_id = ?';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
    }

    private function isPublicChannelRequired(): bool
    {
        $val = $this->getSetting('require_public_channel');
        if ($val === '') {
            return (bool)($this->config['require_public_channel'] ?? true);
        }
        return (bool)$val;
    }

    public function getSetting(string $key, string $default = ''): string
    {
        $stmt = $this->pdo->prepare('SELECT value FROM settings WHERE key = ?');
        $stmt->execute([$key]);
        $val = $stmt->fetchColumn();
        return ($val !== false) ? (string)$val : $default;
    }

    public function logFunnelEvent(string $telegramId, string $eventName, ?string $source = null, array $meta = []): void
    {
        $stmt = $this->pdo->prepare('
            INSERT INTO funnel_events (telegram_id, event_name, campaign_source, metadata, created_at)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $telegramId,
            $eventName,
            $source,
            json_encode($meta, JSON_UNESCAPED_UNICODE),
            date('Y-m-d H:i:s')
        ]);
    }

    public function replacePlaceholders(string $text, array $vars): string
    {
        foreach ($vars as $k => $v) {
            $text = str_replace('{' . $k . '}', (string)$v, $text);
        }
        return $text;
    }
}`
  },
  {
    name: 'src/QueueService.php',
    path: 'src/QueueService.php',
    description: 'مدیریت صف وظایف، رزرو و قفل زمان‌دار',
    content: `<?php

class QueueService
{
    private PDO $pdo;
    private ?Logger $logger;

    public function __construct(PDO $pdo, ?Logger $logger = null)
    {
        $this->pdo = $pdo;
        $this->logger = $logger;
    }

    public function push(string $jobType, array $payload, int $priority = 10, ?string $runAfter = null): int
    {
        $now = date('Y-m-d H:i:s');
        $runAfter = $runAfter ?: $now;

        $stmt = $this->pdo->prepare('
            INSERT INTO job_queue (job_type, payload, status, priority, run_after, created_at, updated_at)
            VALUES (?, ?, "pending", ?, ?, ?, ?)
        ');
        $stmt->execute([
            $jobType,
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $priority,
            $runAfter,
            $now,
            $now
        ]);

        return (int)$this->pdo->lastInsertId();
    }

    public function reserve(int $limit = 10, int $leaseSeconds = 60): array
    {
        $now = date('Y-m-d H:i:s');
        $leaseExpiry = date('Y-m-d H:i:s', time() - $leaseSeconds);

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('
                SELECT id, job_type, payload, attempts, max_attempts
                FROM job_queue
                WHERE (status = "pending" AND run_after <= ?)
                   OR (status = "reserved" AND reserved_at <= ?)
                ORDER BY priority ASC, id ASC
                LIMIT ?
            ');
            $stmt->execute([$now, $leaseExpiry, $limit]);
            $jobs = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (!empty($jobs)) {
                $ids = array_column($jobs, 'id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $updateStmt = $this->pdo->prepare('
                    UPDATE job_queue
                    SET status = "reserved", reserved_at = ?, attempts = attempts + 1, updated_at = ?
                    WHERE id IN (' . $placeholders . ')
                ');
                $params = array_merge([$now, $now], $ids);
                $updateStmt->execute($params);
            }

            $this->pdo->commit();

            foreach ($jobs as &$job) {
                $job['payload'] = json_decode($job['payload'], true) ?: [];
            }
            return $jobs;
        } catch (Exception $e) {
            $this->pdo->rollBack();
            if ($this->logger) {
                $this->logger->error('queue_reserve_failed', ['error' => $e->getMessage()]);
            }
            return [];
        }
    }

    public function complete(int $jobId): void
    {
        $now = date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('
            UPDATE job_queue
            SET status = "completed", updated_at = ?
            WHERE id = ?
        ');
        $stmt->execute([$now, $jobId]);
    }

    public function release(int $jobId, int $delaySeconds, string $error): void
    {
        $now = date('Y-m-d H:i:s');
        $runAfter = date('Y-m-d H:i:s', time() + $delaySeconds);

        $stmt = $this->pdo->prepare('
            UPDATE job_queue
            SET status = "pending", run_after = ?, reserved_at = NULL, last_error = ?, updated_at = ?
            WHERE id = ?
        ');
        $stmt->execute([$runAfter, substr($error, 0, 500), $now, $jobId]);
    }

    public function fail(int $jobId, string $error): void
    {
        $now = date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('
            UPDATE job_queue
            SET status = "failed", last_error = ?, updated_at = ?
            WHERE id = ?
        ');
        $stmt->execute([substr($error, 0, 500), $now, $jobId]);
    }

    public function getStats(): array
    {
        $stmt = $this->pdo->query('
            SELECT status, COUNT(*) as count
            FROM job_queue
            GROUP BY status
        ');
        $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        return [
            'pending' => (int)($rows['pending'] ?? 0),
            'reserved' => (int)($rows['reserved'] ?? 0),
            'completed' => (int)($rows['completed'] ?? 0),
            'failed' => (int)($rows['failed'] ?? 0)
        ];
    }

    public function cleanOldJobs(int $days = 30): int
    {
        $threshold = date('Y-m-d H:i:s', strtotime("-{$days} days"));
        $stmt = $this->pdo->prepare('
            DELETE FROM job_queue
            WHERE status IN ("completed", "failed") AND updated_at < ?
        ');
        $stmt->execute([$threshold]);
        return $stmt->rowCount();
    }
}`
  },
  {
    name: 'src/BroadcastService.php',
    path: 'src/BroadcastService.php',
    description: 'مدیریت کمپین‌های پیام انبوه، سگمنت‌بندی و ارسال با کنترل نرخ',
    content: `<?php

class BroadcastService
{
    private PDO $pdo;
    private TelegramApi $telegram;
    private ?Logger $logger;
    private int $ratePerSecond;

    public function __construct(PDO $pdo, TelegramApi $telegram, ?Logger $logger = null, int $ratePerSecond = 25)
    {
        $this->pdo = $pdo;
        $this->telegram = $telegram;
        $this->logger = $logger;
        $this->ratePerSecond = $ratePerSecond > 0 ? $ratePerSecond : 25;
    }

    public function createCampaign(array $data, string $createdBy): int
    {
        $now = date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('
            INSERT INTO broadcasts (
                title, message_text, photo_url, button_text, button_url,
                target_segment, status, scheduled_at, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, "draft", ?, ?, ?, ?)
        ');
        $stmt->execute([
            $data['title'],
            $data['message_text'],
            $data['photo_url'] ?? null,
            $data['button_text'] ?? null,
            $data['button_url'] ?? null,
            $data['target_segment'] ?? 'all',
            $data['scheduled_at'] ?? null,
            $createdBy,
            $now,
            $now
        ]);
        return (int)$this->pdo->lastInsertId();
    }

    public function sendTest(int $broadcastId, string $adminTelegramId): array
    {
        $campaign = $this->getCampaign($broadcastId);
        if (!$campaign) {
            return ['ok' => false, 'error' => 'Campaign not found'];
        }

        $text = str_replace('{name}', 'مدیر گرامی (پیش‌نمایش)', $campaign['message_text']);
        $keyboard = null;
        if (!empty($campaign['button_text']) && !empty($campaign['button_url'])) {
            $keyboard = [
                'inline_keyboard' => [
                    [['text' => $campaign['button_text'], 'url' => $campaign['button_url']]]
                ]
            ];
        }

        if (!empty($campaign['photo_url'])) {
            return $this->telegram->sendPhoto($adminTelegramId, $campaign['photo_url'], $text, $keyboard);
        } else {
            return $this->telegram->sendMessage($adminTelegramId, $text, $keyboard);
        }
    }

    public function launchCampaign(int $broadcastId): array
    {
        $campaign = $this->getCampaign($broadcastId);
        if (!$campaign) {
            return ['ok' => false, 'error' => 'Campaign not found'];
        }

        $targetUsers = $this->getAudienceUsers($campaign['target_segment']);
        $now = date('Y-m-d H:i:s');

        $this->pdo->beginTransaction();
        try {
            $insertStmt = $this->pdo->prepare('
                INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, telegram_id, status)
                VALUES (?, ?, "pending")
            ');
            foreach ($targetUsers as $user) {
                $insertStmt->execute([$broadcastId, $user['telegram_id']]);
            }

            $update = $this->pdo->prepare('
                UPDATE broadcasts
                SET status = "sending", started_at = ?, total_target = ?, updated_at = ?
                WHERE id = ?
            ');
            $update->execute([$now, count($targetUsers), $now, $broadcastId]);

            $this->pdo->commit();
            return ['ok' => true, 'target_count' => count($targetUsers)];
        } catch (Exception $e) {
            $this->pdo->rollBack();
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    public function processBatch(int $broadcastId, int $batchSize = 25): int
    {
        $campaign = $this->getCampaign($broadcastId);
        if (!$campaign || $campaign['status'] !== 'sending') {
            return 0;
        }

        $stmt = $this->pdo->prepare('
            SELECT r.id, r.telegram_id, u.custom_name, u.first_name
            FROM broadcast_recipients r
            LEFT JOIN users u ON r.telegram_id = u.telegram_id
            WHERE r.broadcast_id = ? AND r.status = "pending"
            LIMIT ?
        ');
        $stmt->execute([$broadcastId, $batchSize]);
        $recipients = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($recipients)) {
            $this->finishCampaign($broadcastId);
            return 0;
        }

        $processed = 0;
        $delayMicroseconds = (int)(1000000 / $this->ratePerSecond);

        foreach ($recipients as $recipient) {
            $name = $recipient['custom_name'] ?: ($recipient['first_name'] ?: 'کاربر عزیز');
            $text = str_replace('{name}', htmlspecialchars($name, ENT_QUOTES, 'UTF-8'), $campaign['message_text']);

            $keyboard = null;
            if (!empty($campaign['button_text']) && !empty($campaign['button_url'])) {
                $keyboard = [
                    'inline_keyboard' => [
                        [['text' => $campaign['button_text'], 'url' => $campaign['button_url']]]
                    ]
                ];
            }

            if (!empty($campaign['photo_url'])) {
                $resp = $this->telegram->sendPhoto($recipient['telegram_id'], $campaign['photo_url'], $text, $keyboard);
            } else {
                $resp = $this->telegram->sendMessage($recipient['telegram_id'], $text, $keyboard);
            }

            $now = date('Y-m-d H:i:s');
            if ($resp['ok']) {
                $msgId = (string)($resp['result']['message_id'] ?? '');
                $updateRec = $this->pdo->prepare('
                    UPDATE broadcast_recipients
                    SET status = "sent", telegram_message_id = ?, sent_at = ?
                    WHERE id = ?
                ');
                $updateRec->execute([$msgId, $now, $recipient['id']]);

                $this->pdo->prepare('UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = ?')
                    ->execute([$broadcastId]);
            } else {
                $errCode = $resp['error_code'] ?? 0;
                $errDesc = $resp['description'] ?? 'Unknown error';

                if ($errCode === 403) {
                    $this->pdo->prepare('UPDATE users SET is_bot_blocked = 1 WHERE telegram_id = ?')
                        ->execute([$recipient['telegram_id']]);
                    $this->pdo->prepare('UPDATE broadcasts SET blocked_count = blocked_count + 1 WHERE id = ?')
                        ->execute([$broadcastId]);
                    $status = 'blocked';
                } else {
                    $this->pdo->prepare('UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = ?')
                        ->execute([$broadcastId]);
                    $status = 'failed';
                }

                $updateRec = $this->pdo->prepare('
                    UPDATE broadcast_recipients
                    SET status = ?, error_message = ?, sent_at = ?
                    WHERE id = ?
                ');
                $updateRec->execute([$status, $errDesc, $now, $recipient['id']]);

                if ($errCode === 429 && isset($resp['parameters']['retry_after'])) {
                    sleep((int)$resp['parameters']['retry_after']);
                }
            }

            $processed++;
            usleep($delayMicroseconds);
        }

        return $processed;
    }

    public function pauseCampaign(int $broadcastId): void
    {
        $now = date('Y-m-d H:i:s');
        $this->pdo->prepare('UPDATE broadcasts SET status = "paused", updated_at = ? WHERE id = ?')
            ->execute([$now, $broadcastId]);
    }

    public function resumeCampaign(int $broadcastId): void
    {
        $now = date('Y-m-d H:i:s');
        $this->pdo->prepare('UPDATE broadcasts SET status = "sending", updated_at = ? WHERE id = ?')
            ->execute([$now, $broadcastId]);
    }

    public function cancelCampaign(int $broadcastId): void
    {
        $now = date('Y-m-d H:i:s');
        $this->pdo->prepare('UPDATE broadcasts SET status = "cancelled", updated_at = ? WHERE id = ?')
            ->execute([$now, $broadcastId]);
    }

    private function finishCampaign(int $broadcastId): void
    {
        $now = date('Y-m-d H:i:s');
        $this->pdo->prepare('
            UPDATE broadcasts
            SET status = "completed", completed_at = ?, updated_at = ?
            WHERE id = ?
        ')->execute([$now, $now, $broadcastId]);
    }

    public function getCampaign(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM broadcasts WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function getAudienceUsers(string $segment): array
    {
        $sql = 'SELECT telegram_id FROM users WHERE is_bot_blocked = 0';
        if ($segment === 'eligible') {
            $sql .= ' AND is_eligible = 1';
        } elseif ($segment === 'approved') {
            $sql .= ' AND private_channel_status = "approved"';
        } elseif ($segment === 'with_phone') {
            $sql .= ' AND phone_normalized IS NOT NULL';
        } elseif ($segment === 'contact_verified') {
            $sql .= ' AND phone_verified = 1';
        } elseif (str_starts_with($segment, 'source:')) {
            $src = substr($segment, 7);
            $stmt = $this->pdo->prepare('SELECT telegram_id FROM users WHERE is_bot_blocked = 0 AND campaign_source = ?');
            $stmt->execute([$src]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        $stmt = $this->pdo->query($sql);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}`
  },
  {
    name: 'src/AdminService.php',
    path: 'src/AdminService.php',
    description: 'احراز هویت، نقش‌ها، شاخص‌های قیف، تایید دستی و خروجی CSV',
    content: `<?php

class AdminService
{
    private PDO $pdo;
    private array $config;
    private ?Logger $logger;

    public function __construct(PDO $pdo, array $config, ?Logger $logger = null)
    {
        $this->pdo = $pdo;
        $this->config = $config;
        $this->logger = $logger;
    }

    public function authenticate(string $password): ?array
    {
        $adminPass = $this->config['admin_password'] ?? 'ViraaAdmin@2026';
        if ($password !== $adminPass) {
            return null;
        }

        $ownerId = $this->config['admin_telegram_id'] ?? '123456789';
        $admin = $this->getAdminByTelegramId($ownerId);
        if (!$admin) {
            $this->createAdmin($ownerId, 'مدیر ارشد (مالک)', 'owner');
            $admin = $this->getAdminByTelegramId($ownerId);
        }
        return $admin;
    }

    public function checkPermission(string $role, string $permission): bool
    {
        $permissions = [
            'owner' => ['view_dashboard', 'view_users', 'view_pii', 'export_pii', 'approve_override', 'manage_broadcast', 'edit_settings', 'manage_admins'],
            'manager' => ['view_dashboard', 'view_users', 'view_pii', 'export_pii', 'approve_override', 'manage_broadcast', 'edit_settings'],
            'operator' => ['view_dashboard', 'view_users', 'view_pii', 'approve_override'],
            'analyst' => ['view_dashboard', 'view_users']
        ];
        return in_array($permission, $permissions[$role] ?? []);
    }

    public function getFunnelMetrics(): array
    {
        $totalUsers = (int)$this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $nameSubmitted = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE custom_name IS NOT NULL')->fetchColumn();
        $phoneSubmitted = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE phone_normalized IS NOT NULL')->fetchColumn();
        $contactVerified = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE phone_verified = 1')->fetchColumn();
        $manualPhone = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE phone_method = "manual_text"')->fetchColumn();
        $channelVerified = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE public_channel_verified = 1')->fetchColumn();
        $eligible = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE is_eligible = 1')->fetchColumn();
        $joinRequests = (int)$this->pdo->query('SELECT COUNT(*) FROM join_requests')->fetchColumn();
        $approved = (int)$this->pdo->query('SELECT COUNT(*) FROM join_requests WHERE status = "approved"')->fetchColumn();
        $blocked = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE is_bot_blocked = 1')->fetchColumn();

        $calcRate = fn(int $num, int $den) => $den > 0 ? round(($num / $den) * 100, 1) : 0;

        return [
            'total_users' => $totalUsers,
            'name_submitted' => $nameSubmitted,
            'name_rate' => $calcRate($nameSubmitted, $totalUsers),
            'phone_submitted' => $phoneSubmitted,
            'phone_rate' => $calcRate($phoneSubmitted, $totalUsers),
            'contact_verified' => $contactVerified,
            'manual_phone' => $manualPhone,
            'channel_verified' => $channelVerified,
            'channel_rate' => $calcRate($channelVerified, $totalUsers),
            'eligible' => $eligible,
            'eligible_rate' => $calcRate($eligible, $totalUsers),
            'join_requests' => $joinRequests,
            'approved' => $approved,
            'approval_rate' => $calcRate($approved, $joinRequests),
            'blocked' => $blocked
        ];
    }

    public function getUsersList(array $filters = [], int $limit = 50, int $offset = 0, bool $canViewPii = false): array
    {
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['search'])) {
            $s = '%' . trim($filters['search']) . '%';
            $where[] = '(telegram_id LIKE ? OR custom_name LIKE ? OR username LIKE ? OR phone LIKE ?)';
            $params = array_merge($params, [$s, $s, $s, $s]);
        }

        if (!empty($filters['status'])) {
            if ($filters['status'] === 'eligible') {
                $where[] = 'is_eligible = 1';
            } elseif ($filters['status'] === 'approved') {
                $where[] = 'private_channel_status = "approved"';
            } elseif ($filters['status'] === 'with_phone') {
                $where[] = 'phone_normalized IS NOT NULL';
            }
        }

        if (!empty($filters['phone_method'])) {
            $where[] = 'phone_method = ?';
            $params[] = $filters['phone_method'];
        }

        $sql = 'SELECT * FROM users WHERE ' . implode(' AND ', $where) . ' ORDER BY id DESC LIMIT ? OFFSET ?';
        $params[] = $limit;
        $params[] = $offset;

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (!$canViewPii) {
            foreach ($users as &$u) {
                if (!empty($u['phone_normalized'])) {
                    $u['phone'] = substr($u['phone_normalized'], 0, 4) . '***' . substr($u['phone_normalized'], -2);
                    $u['phone_normalized'] = $u['phone'];
                }
            }
        }

        return $users;
    }

    public function manualApprove(string $telegramId, string $adminId, string $adminName, string $reason): bool
    {
        $now = date('Y-m-d H:i:s');
        $chatId = $this->config['private_channel_id'];

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('
                INSERT INTO join_requests (telegram_id, chat_id, status, approved_at, created_at, updated_at)
                VALUES (?, ?, "approved", ?, ?, ?)
                ON CONFLICT(telegram_id, chat_id) DO UPDATE SET
                    status = "approved",
                    approved_at = excluded.approved_at,
                    updated_at = excluded.updated_at
            ');
            $stmt->execute([$telegramId, $chatId, $now, $now, $now]);

            $upd = $this->pdo->prepare('
                UPDATE users
                SET is_eligible = 1, private_channel_status = "approved", private_channel_approved_at = ?, updated_at = ?
                WHERE telegram_id = ?
            ');
            $upd->execute([$now, $now, $telegramId]);

            $this->logAudit($adminId, $adminName, 'manual_approve', 'user', $telegramId, [
                'reason' => $reason,
                'chat_id' => $chatId
            ]);

            $this->pdo->commit();
            return true;
        } catch (Exception $e) {
            $this->pdo->rollBack();
            return false;
        }
    }

    public function exportCsv(array $filters = [], bool $canExportPii = false): string
    {
        $users = $this->getUsersList($filters, 10000, 0, $canExportPii);

        $output = "\\xEF\\xBB\\xBF";
        $headers = ['شناسه کاربر', 'شناسه تلگرام', 'نام تلگرام', 'نام ثبت‌شده', 'شماره تماس', 'روش ثبت شماره', 'تأیید شماره', 'عضویت کانال عمومی', 'واجد شرایط', 'وضعیت کانال خصوصی', 'تاریخ ثبت‌نام'];
        $output .= implode(',', array_map([$this, 'escapeCsvField'], $headers)) . "\\r\\n";

        foreach ($users as $u) {
            $phone = $canExportPii ? ($u['phone_normalized'] ?: '') : 'محرمانه';
            $formattedPhone = !empty($phone) && $canExportPii ? '="' . $phone . '"' : $phone;

            $row = [
                $u['id'],
                $u['telegram_id'],
                $u['first_name'] . ' ' . $u['last_name'],
                $u['custom_name'] ?: '',
                $formattedPhone,
                $u['phone_method'] ?: 'ثبت نشده',
                $u['phone_verified'] ? 'تأیید رسمی تلگرام' : 'دستی',
                $u['public_channel_verified'] ? 'بله' : 'خیر',
                $u['is_eligible'] ? 'بله' : 'خیر',
                $u['private_channel_status'],
                $u['created_at']
            ];
            $output .= implode(',', array_map([$this, 'escapeCsvField'], $row)) . "\\r\\n";
        }

        return $output;
    }

    private function escapeCsvField(mixed $val): string
    {
        $str = (string)$val;
        if (preg_match('/^[=\\+\\-@]/', $str)) {
            $str = "'" . $str;
        }
        $str = str_replace('"', '""', $str);
        return '"' . $str . '"';
    }

    public function logAudit(string $adminId, string $adminName, string $action, string $targetType, string $targetId, array $details = []): void
    {
        $stmt = $this->pdo->prepare('
            INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $adminId,
            $adminName,
            $action,
            $targetType,
            $targetId,
            json_encode($details, JSON_UNESCAPED_UNICODE),
            date('Y-m-d H:i:s')
        ]);
    }

    public function getAdminByTelegramId(string $telegramId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM admins WHERE telegram_id = ?');
        $stmt->execute([$telegramId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function createAdmin(string $telegramId, string $name, string $role): bool
    {
        $now = date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('
            INSERT OR IGNORE INTO admins (telegram_id, name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
        ');
        return $stmt->execute([$telegramId, $name, $role, $now, $now]);
    }
}`
  },
  {
    name: 'src/Logger.php',
    path: 'src/Logger.php',
    description: 'لاگ‌گیری ساختاریافته، ماسک اطلاعات حساس و کنترل سقف دیسک',
    content: `<?php

class Logger
{
    private string $logFile;
    private string $errorLogFile;
    private int $maxBytes;
    private int $budgetBytes;

    public function __construct(array $config)
    {
        $this->logFile = $config['log_file'] ?? (__DIR__ . '/../logs/bot.log');
        $this->errorLogFile = $config['error_log_file'] ?? (__DIR__ . '/../logs/error.log');
        $this->maxBytes = ($config['log_max_mb'] ?? 10) * 1024 * 1024;
        $this->budgetBytes = ($config['log_budget_mb'] ?? 300) * 1024 * 1024;

        $dir = dirname($this->logFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
    }

    public function info(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('INFO', $this->logFile, $event, $context, $correlationId);
    }

    public function warning(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('WARNING', $this->logFile, $event, $context, $correlationId);
    }

    public function error(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('ERROR', $this->errorLogFile, $event, $context, $correlationId);
        $this->write('ERROR', $this->logFile, $event, $context, $correlationId);
    }

    private function write(string $level, string $targetFile, string $event, array $context, ?string $correlationId): void
    {
        $this->rotateIfNeeded($targetFile);

        $sanitized = $this->sanitizeContext($context);
        $entry = [
            'timestamp' => gmdate('Y-m-d\\TH:i:s\\Z'),
            'level' => $level,
            'correlation_id' => $correlationId ?: bin2hex(random_bytes(6)),
            'event' => $event,
            'context' => $sanitized
        ];

        file_put_contents($targetFile, json_encode($entry, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    private function rotateIfNeeded(string $file): void
    {
        if (file_exists($file) && filesize($file) >= $this->maxBytes) {
            $timestamp = date('Ymd_His');
            $archived = $file . '.' . $timestamp;
            rename($file, $archived);
            $this->enforceBudget(dirname($file));
        }
    }

    public function enforceBudget(string $dir): void
    {
        $files = glob($dir . '/*');
        if (!$files) {
            return;
        }

        $total = 0;
        $fileList = [];
        foreach ($files as $f) {
            if (is_file($f)) {
                $size = filesize($f);
                $total += $size;
                $fileList[] = ['path' => $f, 'size' => $size, 'time' => filemtime($f)];
            }
        }

        if ($total > $this->budgetBytes) {
            usort($fileList, fn($a, $b) => $a['time'] <=> $b['time']);
            foreach ($fileList as $item) {
                if ($total <= $this->budgetBytes) {
                    break;
                }
                if ($item['path'] !== $this->logFile && $item['path'] !== $this->errorLogFile) {
                    unlink($item['path']);
                    $total -= $item['size'];
                }
            }
        }
    }

    private function sanitizeContext(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            if (is_array($value)) {
                $clean[$key] = $this->sanitizeContext($value);
            } elseif (is_string($value)) {
                if (stripos($key, 'token') !== false || stripos($key, 'secret') !== false || stripos($key, 'password') !== false) {
                    $clean[$key] = '***MASKED***';
                } elseif (stripos($key, 'phone') !== false) {
                    $clean[$key] = $this->maskPhone($value);
                } else {
                    $clean[$key] = $value;
                }
            } else {
                $clean[$key] = $value;
            }
        }
        return $clean;
    }

    private function maskPhone(string $phone): string
    {
        $len = strlen($phone);
        if ($len <= 4) {
            return '****';
        }
        return substr($phone, 0, 4) . '***' . substr($phone, -2);
    }
}`
  }
];
