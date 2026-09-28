<?php

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
echo "=====================================================\n";
