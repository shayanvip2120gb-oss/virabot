<?php

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

echo "Maintenance finished. Cleared {$deletedJobs} old jobs, {$deletedAudits} old audit records.\n";
