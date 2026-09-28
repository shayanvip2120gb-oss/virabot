<?php

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/TelegramApi.php';

$detectedHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
$isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$scheme = $isHttps ? 'https' : 'http';
$scriptDir = dirname($_SERVER['SCRIPT_NAME']);
$autoDetectedUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\' ? '' : $scriptDir);

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
        $configContent = "<?php\n\nreturn [\n" .
            "    'bot_token' => '" . addslashes($botToken) . "',\n" .
            "    'bot_username' => '" . addslashes($cleanUsername) . "',\n" .
            "    'public_channel_id' => '" . addslashes($publicChannelId) . "',\n" .
            "    'public_channel_url' => '" . addslashes($publicChannelUrl) . "',\n" .
            "    'private_channel_id' => '" . addslashes($privateChannelId) . "',\n" .
            "    'require_public_channel' => " . $requirePublic . ",\n" .
            "    'admin_telegram_id' => '" . addslashes($adminTelegramId) . "',\n" .
            "    'admin_password' => '" . addslashes($adminPassword ?: 'ViraaAdmin@2026') . "',\n" .
            "    'webhook_secret' => '" . addslashes($webhookSecret) . "',\n" .
            "    'app_url' => '" . addslashes($appUrl) . "',\n" .
            "    'db_driver' => 'sqlite',\n" .
            "    'db_file' => __DIR__ . '/data/database.sqlite',\n" .
            "    'db_host' => '127.0.0.1',\n" .
            "    'db_port' => '3306',\n" .
            "    'db_name' => 'viraa_bot',\n" .
            "    'db_user' => 'root',\n" .
            "    'db_pass' => '',\n" .
            "    'log_file' => __DIR__ . '/logs/bot.log',\n" .
            "    'error_log_file' => __DIR__ . '/logs/error.log',\n" .
            "    'log_max_mb' => 10,\n" .
            "    'log_budget_mb' => 300,\n" .
            "    'broadcast_rate_per_sec' => 25\n" .
            "];\n";

        $saved = file_put_contents(__DIR__ . '/config.php', $configContent);

        if ($saved === false) {
            $message = 'خطا در ذخیره فایل config.php! لطفاً دسترسی نوشتن (Permission 775 یا 777) در پوشه را بررسی کنید.';
            $messageType = 'error';
        } else {
            $message = 'فایل کانفیگ (config.php) با موفقیت ایجاد و ذخیره شد! 🎉';
            $messageType = 'success';

            try {
                $newConfig = require __DIR__ . '/config.php';
                $pdo = Database::getConnection($newConfig);
                Database::initTables($pdo);
                if (!empty($adminTelegramId)) {
                    $now = date('Y-m-d H:i:s');
                    $stmt = $pdo->prepare('INSERT OR IGNORE INTO admins (telegram_id, name, role, is_active, created_at, updated_at) VALUES (?, "مدیر ارشد", "owner", 1, ?, ?)');
                    $stmt->execute([$adminTelegramId, $now, $now]);
                }
            } catch (Throwable $e) {
            }

            $webhookUrl = $appUrl . '/webhook.php';
            $allowedList = ['message', 'callback_query', 'chat_join_request', 'chat_member', 'my_chat_member'];
            $allowedJson = urlencode(json_encode($allowedList));
            $directTelegramUrl = 'https://api.telegram.org/bot' . $botToken . '/setWebhook?url=' . urlencode($webhookUrl) . '&allowed_updates=' . $allowedJson;
            if (!empty($webhookSecret)) {
                $directTelegramUrl .= '&secret_token=' . urlencode($webhookSecret);
            }

            if ($autoSetWebhook) {
                $api = new TelegramApi($botToken);
                $webhookResult = $api->setWebhook($webhookUrl, $webhookSecret, $allowedList);
            }
        }
    }
}

$currentToken = $_POST['bot_token'] ?? ($existingConfig['bot_token'] ?? '');
$currentUsername = $_POST['bot_username'] ?? ($existingConfig['bot_username'] ?? 'viraa_mini_course_bot');
$currentPublicId = $_POST['public_channel_id'] ?? ($existingConfig['public_channel_id'] ?? '-1001234567890');
$currentPublicUrl = $_POST['public_channel_url'] ?? ($existingConfig['public_channel_url'] ?? 'https://t.me/viraa_english');
$currentPrivateId = $_POST['private_channel_id'] ?? ($existingConfig['private_channel_id'] ?? '-1009876543210');
$currentAdminId = $_POST['admin_telegram_id'] ?? ($existingConfig['admin_telegram_id'] ?? '123456789');
$currentAdminPass = $_POST['admin_password'] ?? ($existingConfig['admin_password'] ?? 'ViraaAdmin@2026');
$currentAppUrl = $_POST['app_url'] ?? ($existingConfig['app_url'] ?? $autoDetectedUrl);
$currentRequirePublic = isset($_POST['require_public_channel']) ? true : ($existingConfig['require_public_channel'] ?? true);
$currentSecret = $_POST['webhook_secret'] ?? ($existingConfig['webhook_secret'] ?? 'viraa_secret_key_123');

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Config Maker | سازنده خودکار فایل کانفیگ ویرا انگلیش</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; line-height: 1.5; }
        .card { max-width: 720px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
        h1 { margin-top: 0; font-size: 22px; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
        p.subtitle { color: #94a3b8; font-size: 13px; margin-top: 4px; margin-bottom: 24px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-group { margin-bottom: 16px; }
        .form-group.full { grid-column: span 2; }
        label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #cbd5e1; }
        input[type="text"], input[type="password"] { width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; color: #f8fafc; font-size: 13px; outline: none; transition: border-color 0.2s; font-family: monospace; }
        input[type="text"]:focus, input[type="password"]:focus { border-color: #38bdf8; }
        .hint { font-size: 11px; color: #64748b; margin-top: 4px; }
        .checkbox-group { display: flex; items-center: center; gap: 10px; background: #0f172a; padding: 12px 14px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 16px; }
        .checkbox-group input { width: 18px; height: 18px; cursor: pointer; accent-color: #0284c7; }
        .checkbox-group label { margin-bottom: 0; cursor: pointer; font-size: 13px; }
        .btn-submit { width: 100%; background: #0284c7; color: #fff; border: none; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
        .btn-submit:hover { background: #0369a1; }
        .alert { padding: 16px; border-radius: 10px; margin-bottom: 20px; font-size: 14px; }
        .alert-success { background: #064e3b; border: 1px solid #059669; color: #a7f3d0; }
        .alert-error { background: #7f1d1d; border: 1px solid #dc2626; color: #fecaca; }
        .result-box { background: #020617; border: 1px solid #1e293b; border-radius: 10px; padding: 16px; margin-top: 20px; }
        .direct-link { word-break: break-all; color: #38bdf8; font-family: monospace; font-size: 12px; display: block; margin: 8px 0; background: #0f172a; padding: 8px 12px; border-radius: 6px; }
        .actions-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
        .actions-row a { display: inline-block; background: #334155; color: #f8fafc; padding: 8px 14px; border-radius: 6px; font-size: 12px; text-decoration: none; }
        .actions-row a:hover { background: #475569; }
    </style>
</head>
<body>
    <div class="card">
        <h1>⚙️ ابزار ساخت خودکار فایل کانفیگ (Config Maker)</h1>
        <p class="subtitle">اطلاعات ربات و کانال‌ها را وارد کنید تا فایل <code>config.php</code> ایجاد و وب‌هوک روی <code>webhook.php</code> متصل گردد.</p>

        <?php if (!empty($message)): ?>
            <div class="alert <?= $messageType === 'success' ? 'alert-success' : 'alert-error' ?>">
                <?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?>
            </div>
        <?php endif; ?>

        <?php if ($webhookResult !== null || !empty($directTelegramUrl)): ?>
            <div class="result-box">
                <h3 style="margin-top: 0; color: #34d399; font-size: 15px;">🔗 نتیجه اتصال به تلگرام</h3>
                <?php if ($webhookResult !== null): ?>
                    <p style="margin: 4px 0; font-size: 13px;">
                        <strong>پاسخ ست کردن خودکار:</strong>
                        <?= ($webhookResult['ok'] ?? false) ? '<span style="color: #34d399;">موفقیت‌آمیز ✅ (' . htmlspecialchars($webhookResult['description'] ?? '', ENT_QUOTES, 'UTF-8') . ')</span>' : '<span style="color: #f87171;">خطا ❌ (' . htmlspecialchars($webhookResult['description'] ?? '', ENT_QUOTES, 'UTF-8') . ')</span>' ?>
                    </p>
                <?php endif; ?>

                <p style="margin: 12px 0 4px 0; font-size: 13px;"><strong>لینک مستقیم تنظیم وب‌هوک با API رسمی تلگرام در مرورگر:</strong></p>
                <a href="<?= htmlspecialchars($directTelegramUrl, ENT_QUOTES, 'UTF-8') ?>" target="_blank" class="direct-link">
                    <?= htmlspecialchars($directTelegramUrl, ENT_QUOTES, 'UTF-8') ?>
                </a>
                <span class="hint">روی لینک بالا کلیک کنید تا پاسخ <code>{"ok":true,"result":true,"description":"Webhook was set"}</code> را مستقیم در تلگرام ببینید.</span>

                <div class="actions-row">
                    <a href="webhook.php?action=set">⚡ ست کردن از طریق webhook.php</a>
                    <a href="webhook.php?action=info" target="_blank">🔍 استعلام وب‌هوک (info)</a>
                    <a href="index.php">📊 ورود به پنل مدیریت</a>
                </div>
            </div>
            <div style="height: 20px;"></div>
        <?php endif; ?>

        <form method="POST">
            <div class="grid">
                <div class="form-group full">
                    <label>توکن ربات تلگرام (Bot Token):</label>
                    <input type="text" name="bot_token" value="<?= htmlspecialchars($currentToken, ENT_QUOTES, 'UTF-8') ?>" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" required>
                    <div class="hint">توکنی که از BotFather@ دریافت کرده‌اید.</div>
                </div>

                <div class="form-group">
                    <label>نام کاربری ربات (بدون @):</label>
                    <input type="text" name="bot_username" value="<?= htmlspecialchars($currentUsername, ENT_QUOTES, 'UTF-8') ?>" placeholder="viraa_mini_course_bot">
                </div>

                <div class="form-group">
                    <label>شناسه کانال عمومی:</label>
                    <input type="text" name="public_channel_id" value="<?= htmlspecialchars($currentPublicId, ENT_QUOTES, 'UTF-8') ?>" placeholder="-1001234567890">
                </div>

                <div class="form-group full">
                    <label>لینک کانال عمومی ویرا:</label>
                    <input type="text" name="public_channel_url" value="<?= htmlspecialchars($currentPublicUrl, ENT_QUOTES, 'UTF-8') ?>" placeholder="https://t.me/viraa_english">
                </div>

                <div class="form-group">
                    <label>شناسه عددی کانال خصوصی مینی‌دوره:</label>
                    <input type="text" name="private_channel_id" value="<?= htmlspecialchars($currentPrivateId, ENT_QUOTES, 'UTF-8') ?>" placeholder="-1009876543210" required>
                    <div class="hint">شناسه کانالی که کاربر باید بعد از ثبت‌نام به آن ملحق شود.</div>
                </div>

                <div class="form-group">
                    <label>آیدی عددی تلگرام مدیر ارشد (مالک):</label>
                    <input type="text" name="admin_telegram_id" value="<?= htmlspecialchars($currentAdminId, ENT_QUOTES, 'UTF-8') ?>" placeholder="123456789">
                </div>

                <div class="form-group">
                    <label>رمز عبور پنل مدیریت وب:</label>
                    <input type="password" name="admin_password" value="<?= htmlspecialchars($currentAdminPass, ENT_QUOTES, 'UTF-8') ?>" placeholder="ViraaAdmin@2026">
                </div>

                <div class="form-group">
                    <label>کلید امنیتی وب‌هوک (Webhook Secret):</label>
                    <input type="text" name="webhook_secret" value="<?= htmlspecialchars($currentSecret, ENT_QUOTES, 'UTF-8') ?>" placeholder="viraa_secret_key_123">
                </div>

                <div class="form-group full">
                    <label>آدرس کامل دامنه هاست (App URL):</label>
                    <input type="text" name="app_url" value="<?= htmlspecialchars($currentAppUrl, ENT_QUOTES, 'UTF-8') ?>" placeholder="https://example.com">
                    <div class="hint">آدرس سایت به صورت خودکار از مرورگر تشخیص داده شده است. آدرس وب‌هوک برابر با <code><?= htmlspecialchars($currentAppUrl . '/webhook.php', ENT_QUOTES, 'UTF-8') ?></code> خواهد شد.</div>
                </div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="require_public_channel" name="require_public_channel" <?= $currentRequirePublic ? 'checked' : '' ?>>
                <label for="require_public_channel">بررسی و الزام عضویت در کانال عمومی (یک‌بار برای همیشه در جریان ثبت‌نام)</label>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="auto_set_webhook" name="auto_set_webhook" checked>
                <label for="auto_set_webhook">ست کردن خودکار وب‌هوک روی فایل <code>webhook.php</code> همزمان با ذخیره فرم</label>
            </div>

            <button type="submit" class="btn-submit">💾 ایجاد فایل کانفیگ و راه‌اندازی ربات</button>
        </form>
    </div>
</body>
</html>
