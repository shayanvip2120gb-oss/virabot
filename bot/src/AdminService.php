<?php

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

        $output = "\xEF\xBB\xBF";
        $headers = ['شناسه کاربر', 'شناسه تلگرام', 'نام کاربری (Username)', 'نام تلگرام', 'نام ثبت‌شده', 'شماره تماس', 'روش ثبت شماره', 'تأیید شماره', 'عضویت کانال عمومی', 'واجد شرایط', 'وضعیت کانال خصوصی', 'تاریخ ثبت‌نام'];
        $output .= implode(',', array_map([$this, 'escapeCsvField'], $headers)) . "\r\n";

        foreach ($users as $u) {
            $phone = $canExportPii ? ($u['phone_normalized'] ?: ($u['phone'] ?: '')) : 'محرمانه';
            $username = !empty($u['username']) ? '@' . ltrim($u['username'], '@') : '';

            $row = [
                $u['id'],
                $u['telegram_id'],
                $username,
                trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')),
                $u['custom_name'] ?: '',
                $phone,
                $u['phone_method'] ?: 'ثبت نشده',
                !empty($u['phone_verified']) ? 'تأیید رسمی تلگرام' : 'دستی',
                !empty($u['public_channel_verified']) ? 'بله' : 'خیر',
                !empty($u['is_eligible']) ? 'بله' : 'خیر',
                $u['private_channel_status'] ?? 'none',
                $u['created_at'] ?? ''
            ];
            $output .= implode(',', array_map([$this, 'escapeCsvField'], $row)) . "\r\n";
        }

        return $output;
    }

    private function escapeCsvField(mixed $val): string
    {
        $str = (string)$val;
        if (preg_match('/^[=\+\-@]/', $str)) {
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
}
