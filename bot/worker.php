<?php

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
}
