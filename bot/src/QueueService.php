<?php

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
}
