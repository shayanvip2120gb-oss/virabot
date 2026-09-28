<?php

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
    if (!empty($config['webhook_secret']) && !empty($secretToken) && $secretToken !== $config['webhook_secret']) {
        http_response_code(403);
        $logger->warning('webhook_invalid_secret', ['received' => $secretToken]);
        echo 'Forbidden';
        exit;
    }

    $rawInput = file_get_contents('php://input');
    $update = json_decode($rawInput, true);

    if (!is_array($update)) {
        http_response_code(400);
        $logger->warning('webhook_invalid_json', ['raw' => substr((string)$rawInput, 0, 200)]);
        echo 'Invalid JSON';
        exit;
    }

    $logger->info('webhook_payload_received', [
        'update_id' => $update['update_id'] ?? null,
        'types' => array_keys($update)
    ]);

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
    $baseUrl = $scheme . '://' . $detectedHost . ($scriptDir === '/' || $scriptDir === '\\' ? '' : $scriptDir);
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
    ?>
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>نتیجه تنظیم وب‌هوک | ویرا انگلیش</title>
        <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; text-align: center; }
            .box { max-width: 620px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #334155; }
            .tag-ok { background: #065f46; color: #34d399; padding: 6px 16px; border-radius: 9999px; font-weight: bold; }
            .tag-err { background: #991b1b; color: #f87171; padding: 6px 16px; border-radius: 9999px; font-weight: bold; }
            code { background: #020617; padding: 6px 10px; border-radius: 8px; font-family: monospace; color: #38bdf8; word-break: break-all; display: inline-block; margin: 8px 0; }
            a { color: #38bdf8; text-decoration: none; margin: 0 8px; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>🔗 وضعیت ثبت وب‌هوک در تلگرام</h2>
            <p>
                <?php if ($ok): ?>
                    <span class="tag-ok">موفقیت‌آمیز ✅</span>
                <?php else: ?>
                    <span class="tag-err">خطا ❌</span>
                <?php endif; ?>
            </p>
            <p><strong>پاسخ تلگرام:</strong> <?= htmlspecialchars($desc, ENT_QUOTES, 'UTF-8') ?></p>
            <p><strong>آدرس وب‌هوک متصل شده:</strong><br><code><?= htmlspecialchars($webhookUrl, ENT_QUOTES, 'UTF-8') ?></code></p>
            <hr style="border: 0; border-top: 1px solid #334155; margin: 24px 0;">
            <div>
                <a href="webhook.php?action=diagnose">🩺 عیب‌یابی اتصال ربات و کانال‌ها</a> |
                <a href="webhook.php?action=logs">📜 مشاهده زنده لاگ‌ها</a> |
                <a href="index.php">🏠 پنل مدیریت</a>
            </div>
        </div>
    </body>
    </html>
    <?php
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
    $errFile = $config['error_log_file'] ?? (__DIR__ . '/logs/error.log');

    $readLastLines = function (string $file, int $lines = 60): array {
        if (!file_exists($file)) {
            return [];
        }
        $data = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!$data) {
            return [];
        }
        return array_slice($data, -$lines);
    };

    $botLogs = $readLastLines($logFile, 70);
    $errLogs = $readLastLines($errFile, 40);
    ?>
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>مشاهده زنده لاگ‌های ربات</title>
        <style>
            body { font-family: system-ui, monospace; background: #020617; color: #f8fafc; padding: 20px; font-size: 13px; line-height: 1.6; }
            .container { max-width: 1100px; margin: 0 auto; }
            h2 { color: #38bdf8; display: flex; justify-content: space-between; align-items: center; }
            .btn { background: #1e293b; color: #38bdf8; padding: 6px 14px; border-radius: 6px; text-decoration: none; border: 1px solid #334155; font-size: 12px; }
            .log-box { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 16px; margin-bottom: 24px; overflow-x: auto; max-height: 450px; overflow-y: auto; }
            .line { padding: 4px 6px; border-bottom: 1px solid #1e293b; font-family: monospace; white-space: pre-wrap; word-break: break-all; }
            .line-info { color: #94a3b8; }
            .line-error { color: #f87171; background: #450a0a22; }
            .line-warn { color: #facc15; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>
                <span>📜 گزارش زنده رویدادها و لاگ‌های ربات</span>
                <div>
                    <a href="webhook.php?action=logs" class="btn">🔄 بروزرسانی لاگ‌ها</a>
                    <a href="webhook.php?action=diagnose" class="btn">🩺 تست عیب‌یابی</a>
                    <a href="index.php" class="btn">🏠 پنل مدیریت</a>
                </div>
            </h2>
            <p style="color: #64748b;">مسیر فایل لاگ معمولی: <code><?= htmlspecialchars($logFile, ENT_QUOTES, 'UTF-8') ?></code></p>
            <div class="log-box">
                <?php if (empty($botLogs)): ?>
                    <div style="color: #64748b; text-align: center; padding: 20px;">هنوز رویدادی ثبت نشده است. به محض ارسال اولین پیام یا درخواست به ربات، لاگ‌ها اینجا دیده می‌شوند.</div>
                <?php else: ?>
                    <?php foreach (array_reverse($botLogs) as $l): ?>
                        <?php
                            $cls = 'line-info';
                            if (str_contains($l, 'ERROR') || str_contains($l, 'failed')) {
                                $cls = 'line-error';
                            } elseif (str_contains($l, 'WARN')) {
                                $cls = 'line-warn';
                            }
                        ?>
                        <div class="line <?= $cls ?>"><?= htmlspecialchars($l, ENT_QUOTES, 'UTF-8') ?></div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>

            <?php if (!empty($errLogs)): ?>
                <h3 style="color: #f87171;">⚠️ آخرین خطاهای ثبت‌شده (error.log):</h3>
                <div class="log-box" style="border-color: #7f1d1d;">
                    <?php foreach (array_reverse($errLogs) as $l): ?>
                        <div class="line line-error"><?= htmlspecialchars($l, ENT_QUOTES, 'UTF-8') ?></div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </body>
    </html>
    <?php
    exit;
}

if ($action === 'diagnose') {
    header('Content-Type: text/html; charset=utf-8');
    $me = $telegram->getMe();
    $webhookInfo = $telegram->getWebhookInfo();

    $botId = $me['result']['id'] ?? null;
    $botUser = $me['result']['username'] ?? null;

    $privateChannelId = $config['private_channel_id'] ?? '';
    $publicChannelId = $config['public_channel_id'] ?? '';

    $privateChat = !empty($privateChannelId) ? $telegram->getChat($privateChannelId) : null;
    $privateBotMember = (!empty($privateChannelId) && $botId) ? $telegram->getChatMember($privateChannelId, $botId) : null;

    $publicChat = !empty($publicChannelId) ? $telegram->getChat($publicChannelId) : null;
    $publicBotMember = (!empty($publicChannelId) && $botId) ? $telegram->getChatMember($publicChannelId, $botId) : null;

    $recentRequests = [];
    try {
        $stmt = $pdo->query('SELECT * FROM join_requests ORDER BY id DESC LIMIT 10');
        $recentRequests = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
    }

    $recentUsers = [];
    try {
        $stmt = $pdo->query('SELECT id, telegram_id, custom_name, phone, is_eligible, private_channel_status, created_at FROM users ORDER BY id DESC LIMIT 10');
        $recentUsers = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
    }
    ?>
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>عیب‌یابی پیشرفته ربات و کانال‌ها</title>
        <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; font-size: 13px; line-height: 1.6; }
            .container { max-width: 900px; margin: 0 auto; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 20px; margin-bottom: 20px; }
            h2, h3 { margin-top: 0; }
            .badge-ok { background: #065f46; color: #34d399; padding: 4px 10px; border-radius: 6px; font-weight: bold; }
            .badge-err { background: #991b1b; color: #f87171; padding: 4px 10px; border-radius: 6px; font-weight: bold; }
            .badge-warn { background: #854d0e; color: #fef08a; padding: 4px 10px; border-radius: 6px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            th, td { border: 1px solid #334155; padding: 8px 12px; text-align: right; }
            th { background: #0f172a; color: #94a3b8; }
            code { background: #020617; padding: 3px 6px; border-radius: 4px; color: #38bdf8; font-family: monospace; }
            .btn { background: #0284c7; color: #fff; padding: 6px 14px; border-radius: 6px; text-decoration: none; font-size: 12px; display: inline-block; margin-left: 6px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0; color: #38bdf8;">🩺 عیب‌یابی خودکار دسترسی‌ها و درخواست‌های عضویت</h2>
                <div>
                    <a href="webhook.php?action=diagnose" class="btn">🔄 بررسی مجدد</a>
                    <a href="webhook.php?action=logs" class="btn" style="background: #334155;">📜 لاگ‌ها</a>
                    <a href="index.php" class="btn" style="background: #334155;">🏠 پنل</a>
                </div>
            </div>

            <div class="card">
                <h3>۱. وضعیت توکن و ربات</h3>
                <?php if ($me['ok'] ?? false): ?>
                    <p><span class="badge-ok">توکن صحیح است ✅</span> نام ربات: <strong><?= htmlspecialchars($me['result']['first_name'] ?? '', ENT_QUOTES, 'UTF-8') ?></strong> (<code>@<?= htmlspecialchars($me['result']['username'] ?? '', ENT_QUOTES, 'UTF-8') ?></code>) - شناسه عددی: <code><?= htmlspecialchars((string)$botId, ENT_QUOTES, 'UTF-8') ?></code></p>
                <?php else: ?>
                    <p><span class="badge-err">توکن نامعتبر است ❌</span> خطا: <?= htmlspecialchars($me['description'] ?? 'عدم اتصال به تلگرام', ENT_QUOTES, 'UTF-8') ?></p>
                <?php endif; ?>
            </div>

            <div class="card">
                <h3>۲. وضعیت وب‌هوک در تلگرام</h3>
                <?php
                    $whOk = $webhookInfo['ok'] ?? false;
                    $whUrl = $webhookInfo['result']['url'] ?? '';
                    $whPending = $webhookInfo['result']['pending_update_count'] ?? 0;
                    $whLastErr = $webhookInfo['result']['last_error_message'] ?? null;
                    $whAllowed = $webhookInfo['result']['allowed_updates'] ?? [];
                ?>
                <p>آدرس وب‌هوک ثبت‌شده: <code><?= htmlspecialchars($whUrl ?: 'ست نشده!', ENT_QUOTES, 'UTF-8') ?></code></p>
                <p>تعداد پیام‌های معلق در صف تلگرام: <strong><?= (int)$whPending ?></strong></p>
                <?php if ($whLastErr): ?>
                    <p><span class="badge-err">آخرین خطای وب‌هوک از طرف تلگرام:</span> <code><?= htmlspecialchars($whLastErr, ENT_QUOTES, 'UTF-8') ?></code></p>
                <?php endif; ?>
                <p>رویدادهای مجاز (Allowed Updates): <code><?= htmlspecialchars(json_encode($whAllowed, JSON_UNESCAPED_UNICODE), ENT_QUOTES, 'UTF-8') ?></code></p>
                <?php if (!empty($whAllowed) && !in_array('chat_join_request', $whAllowed)): ?>
                    <p><span class="badge-warn">هشدار:</span> رویداد <code>chat_join_request</code> در وب‌هوک شما فعال نیست! حتماً روی <a href="webhook.php?action=set" style="color: #38bdf8;">تنظیم مجدد وب‌هوک</a> کلیک کنید.</p>
                <?php endif; ?>
            </div>

            <div class="card">
                <h3>۳. بررسی کانال خصوصی مینی‌دوره (کانال پذیرش درخواست)</h3>
                <p>شناسه کانال در کانفیگ: <code><?= htmlspecialchars($privateChannelId, ENT_QUOTES, 'UTF-8') ?></code></p>
                <?php
                    $isPrivateAdmin = false;
                    $canInvite = false;
                    if ($privateBotMember['ok'] ?? false) {
                        $mStatus = $privateBotMember['result']['status'] ?? '';
                        $isPrivateAdmin = in_array($mStatus, ['administrator', 'creator']);
                        $canInvite = $privateBotMember['result']['can_invite_users'] ?? false;
                    }
                ?>
                <?php if ($privateChat['ok'] ?? false): ?>
                    <p>عنوان کانال: <strong><?= htmlspecialchars($privateChat['result']['title'] ?? '', ENT_QUOTES, 'UTF-8') ?></strong></p>
                <?php else: ?>
                    <p><span class="badge-err">کانال پیدا نشد ❌</span> (پاسخ تلگرام: <?= htmlspecialchars($privateChat['description'] ?? 'عدم دسترسی', ENT_QUOTES, 'UTF-8') ?>)</p>
                    <p style="color: #f87171; font-size: 12px;">نکته: شناسه کانال‌های خصوصی باید حتماً با <code>-100</code> شروع شود (مثلاً <code>-1001234567890</code>). همچنین ربات باید از قبل به عنوان مدیر در آن اد شده باشد.</p>
                <?php endif; ?>

                <p>
                    وضعیت مدیریت ربات در کانال خصوصی:
                    <?php if ($isPrivateAdmin): ?>
                        <span class="badge-ok">ربات ادمین است ✅</span>
                    <?php else: ?>
                        <span class="badge-err">ربات ادمین این کانال نیست! ❌</span>
                    <?php endif; ?>
                </p>

                <p>
                    دسترسی پذیرش اعضا و دعوت (can_invite_users):
                    <?php if ($canInvite): ?>
                        <span class="badge-ok">دسترسی فعال است ✅</span>
                    <?php else: ?>
                        <span class="badge-err">دسترسی غیرفعال است! ❌</span>
                        <div style="background: #450a0a; border: 1px solid #b91c1c; padding: 10px; border-radius: 8px; margin-top: 8px; color: #fca5a5;">
                            <strong>مهم:</strong> برای قبول کردن ریکوئست‌ها توسط ربات، در تنظیمات ادمین‌های کانال، حتماً تیک گزینه <strong>«Invite Users via Link» (دعوت کاربران از طریق پیوند)</strong> را برای این ربات فعال کنید.
                        </div>
                    <?php endif; ?>
                </p>
            </div>

            <div class="card">
                <h3>۴. آخرین درخواست‌های عضویت ثبت‌شده در دیتابیس (join_requests)</h3>
                <?php if (empty($recentRequests)): ?>
                    <p style="color: #64748b;">هنوز هیچ درخواستی در دیتابیس ثبت نشده است.</p>
                <?php else: ?>
                    <table>
                        <thead>
                            <tr>
                                <th>شناسه</th>
                                <th>کاربر (Telegram ID)</th>
                                <th>وضعیت</th>
                                <th>تعداد تلاش</th>
                                <th>آخرین خطا</th>
                                <th>تاریخ</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($recentRequests as $r): ?>
                                <tr>
                                    <td><?= htmlspecialchars((string)$r['id'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td><code><?= htmlspecialchars((string)$r['telegram_id'], ENT_QUOTES, 'UTF-8') ?></code></td>
                                    <td>
                                        <?php if ($r['status'] === 'approved'): ?>
                                            <span class="badge-ok">تأیید شد</span>
                                        <?php elseif ($r['status'] === 'pending'): ?>
                                            <span class="badge-warn">معلق (Pending)</span>
                                        <?php else: ?>
                                            <span class="badge-err"><?= htmlspecialchars($r['status'], ENT_QUOTES, 'UTF-8') ?></span>
                                        <?php endif; ?>
                                    </td>
                                    <td><?= htmlspecialchars((string)$r['attempt_count'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td style="color: #f87171;"><?= htmlspecialchars((string)($r['last_error'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                                    <td><?= htmlspecialchars((string)$r['created_at'], ENT_QUOTES, 'UTF-8') ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>

            <div class="card">
                <h3>۵. آخرین کاربران ثبت‌نام شده در دیتابیس (users)</h3>
                <?php if (empty($recentUsers)): ?>
                    <p style="color: #64748b;">هنوز کاربری ثبت‌نام نکرده است.</p>
                <?php else: ?>
                    <table>
                        <thead>
                            <tr>
                                <th>شناسه</th>
                                <th>Telegram ID</th>
                                <th>نام</th>
                                <th>شماره موبایل</th>
                                <th>واجد شرایط (Eligible)</th>
                                <th>وضعیت کانال خصوصی</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($recentUsers as $u): ?>
                                <tr>
                                    <td><?= htmlspecialchars((string)$u['id'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td><code><?= htmlspecialchars((string)$u['telegram_id'], ENT_QUOTES, 'UTF-8') ?></code></td>
                                    <td><?= htmlspecialchars((string)($u['custom_name'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                                    <td dir="ltr"><?= htmlspecialchars((string)($u['phone'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                                    <td><?= (int)$u['is_eligible'] === 1 ? '<span class="badge-ok">بله ✅</span>' : '<span class="badge-warn">خیر (مراحل ناقص)</span>' ?></td>
                                    <td><?= htmlspecialchars((string)($u['private_channel_status'] ?? 'none'), ENT_QUOTES, 'UTF-8') ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>
    </body>
    </html>
    <?php
    exit;
}

$allowedUpdatesJson = urlencode(json_encode(['message', 'callback_query', 'chat_join_request', 'chat_member', 'my_chat_member']));
$directTelegramUrl = 'https://api.telegram.org/bot' . $config['bot_token'] . '/setWebhook?url=' . urlencode($webhookUrl) . '&allowed_updates=' . $allowedUpdatesJson;
if (!empty($config['webhook_secret'])) {
    $directTelegramUrl .= '&secret_token=' . urlencode($config['webhook_secret']);
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>اندپوینت وب‌هوک تلگرام | webhook.php</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 30px; line-height: 1.6; }
        .box { max-width: 680px; margin: 20px auto; background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #334155; }
        .btn { display: inline-block; background: #2563eb; color: #fff; padding: 12px 22px; border-radius: 10px; text-decoration: none; font-weight: bold; margin: 6px 0; }
        .btn:hover { background: #1d4ed8; }
        .btn-sec { background: #334155; color: #e2e8f0; }
        .btn-sec:hover { background: #475569; }
        code { background: #020617; padding: 6px 12px; border-radius: 8px; font-family: monospace; color: #38bdf8; word-break: break-all; display: block; margin: 10px 0; font-size: 13px; text-align: left; }
        .step { background: #0f172a; border: 1px solid #334155; padding: 16px; border-radius: 12px; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="box">
        <h2 style="margin-top: 0; color: #38bdf8;">⚡ اندپوینت رسمی وب‌هوک (webhook.php)</h2>
        <p style="color: #94a3b8; font-size: 14px;">این فایل همان آدرسی است که سرور تلگرام آپدیت‌ها را به صورت POST به آن ارسال می‌کند.</p>

        <div class="step">
            <h3 style="margin-top: 0; font-size: 15px; color: #34d399;">روش ۱: ست کردن مستقیم وب‌هوک با همین فایل</h3>
            <p style="font-size: 13px; margin: 6px 0;">تنها با کلیک روی دکمه زیر، وب‌هوک همراه با تمام مجوزهای لازم (از جمله دریافت درخواست عضویت کانال) در تلگرام ثبت می‌شود:</p>
            <a href="webhook.php?action=set" class="btn">🚀 ست کردن وب‌هوک در تلگرام با ۱ کلیک</a>
        </div>

        <div class="step">
            <h3 style="margin-top: 0; font-size: 15px; color: #60a5fa;">روش ۲: با API رسمی تلگرام در مرورگر</h3>
            <p style="font-size: 13px; margin: 6px 0;">می‌توانید لینک زیر را در مرورگر باز کنید تا مستقیماً با سرور تلگرام ست شود:</p>
            <code><?= htmlspecialchars($directTelegramUrl, ENT_QUOTES, 'UTF-8') ?></code>
            <a href="<?= htmlspecialchars($directTelegramUrl, ENT_QUOTES, 'UTF-8') ?>" target="_blank" class="btn btn-sec">🌐 باز کردن لینک در سرور تلگرام</a>
        </div>

        <div style="text-align: center; margin-top: 20px;">
            <a href="webhook.php?action=diagnose" class="btn" style="background: #0284c7; font-size: 12px; padding: 8px 14px;">🩺 تست عیب‌یابی کانال‌ها و ربات</a>
            <a href="webhook.php?action=logs" class="btn btn-sec" style="font-size: 12px; padding: 8px 14px;">📜 مشاهده زنده لاگ‌ها</a>
            <a href="webhook.php?action=info" class="btn btn-sec" style="font-size: 12px; padding: 8px 14px;">🔍 استعلام وب‌هوک</a>
            <a href="index.php" class="btn btn-sec" style="font-size: 12px; padding: 8px 14px;">📊 پنل مدیریت</a>
        </div>
    </div>
</body>
</html>
