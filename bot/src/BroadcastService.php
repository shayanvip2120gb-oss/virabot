<?php

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
}
