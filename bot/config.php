<?php

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
];
