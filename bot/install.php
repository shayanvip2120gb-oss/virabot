<?php

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
}
