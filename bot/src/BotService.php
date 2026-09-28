<?php

class BotService
{
    private PDO $pdo;
    private TelegramApi $telegram;
    private QueueService $queue;
    private ?Logger $logger;
    private array $config;

    public function __construct(PDO $pdo, TelegramApi $telegram, QueueService $queue, array $config, ?Logger $logger = null)
    {
        $this->pdo = $pdo;
        $this->telegram = $telegram;
        $this->queue = $queue;
        $this->config = $config;
        $this->logger = $logger;
    }

    public function handleUpdate(array $update): void
    {
        if (isset($update['message'])) {
            $this->handleMessage($update['message']);
        } elseif (isset($update['callback_query'])) {
            $this->handleCallbackQuery($update['callback_query']);
        } elseif (isset($update['chat_join_request'])) {
            $this->handleChatJoinRequest($update['chat_join_request']);
        } elseif (isset($update['my_chat_member'])) {
            $this->handleMyChatMember($update['my_chat_member']);
        }
    }

    private function handleMessage(array $message): void
    {
        $from = $message['from'] ?? null;
        if (!$from || ($from['is_bot'] ?? false)) {
            return;
        }

        $telegramId = (string)$from['id'];
        $chatId = $message['chat']['id'] ?? $telegramId;
        $text = trim($message['text'] ?? '');
        $now = date('Y-m-d H:i:s');

        $user = $this->getOrCreateUser($from);

        if ($text === '/admin' || str_starts_with($text, '/admin')) {
            $this->handleAdminCommand($chatId, $telegramId);
            return;
        }

        if (str_starts_with($text, '/start')) {
            $parts = explode(' ', $text, 2);
            $campaign = isset($parts[1]) ? trim($parts[1]) : null;
            if ($campaign && empty($user['campaign_source'])) {
                $this->updateUser($telegramId, ['campaign_source' => $campaign]);
                $user['campaign_source'] = $campaign;
            }
            $this->logFunnelEvent($telegramId, 'bot_start', $user['campaign_source']);
            $this->sendWelcomeStep($chatId, $user);
            return;
        }

        if (isset($message['contact'])) {
            $this->handleContactInput($chatId, $user, $message['contact'], $from['id']);
            return;
        }

        $step = $user['registration_step'] ?? 'started';

        if ($step === 'started') {
            $this->sendWelcomeStep($chatId, $user);
        } elseif ($step === 'ask_name') {
            $this->handleNameInput($chatId, $user, $text);
        } elseif ($step === 'ask_phone') {
            $this->handlePhoneTextInput($chatId, $user, $text);
        } elseif ($step === 'public_channel_check') {
            $this->verifyPublicChannelStep($chatId, $user);
        } elseif ($step === 'eligible' || $step === 'approved') {
            $this->sendCourseLinkStep($chatId, $user);
        } else {
            $this->sendWelcomeStep($chatId, $user);
        }
    }

    private function handleCallbackQuery(array $callbackQuery): void
    {
        $id = $callbackQuery['id'];
        $from = $callbackQuery['from'];
        $telegramId = (string)$from['id'];
        $data = $callbackQuery['data'] ?? '';
        $message = $callbackQuery['message'] ?? null;
        $chatId = $message['chat']['id'] ?? $telegramId;

        $user = $this->getOrCreateUser($from);

        if (str_starts_with($data, 'admin_')) {
            if (!$this->isAdmin($telegramId)) {
                $this->telegram->answerCallbackQuery($id, '⛔ شما ادمین نیستید!', true);
                return;
            }
            if ($data === 'admin_refresh_stats') {
                $this->sendAdminDashboardMessage($chatId);
            } elseif ($data === 'admin_pending_requests') {
                $this->sendAdminPendingRequests($chatId);
            } elseif (str_starts_with($data, 'admin_approve_')) {
                $targetId = substr($data, strlen('admin_approve_'));
                $this->executeApproveJoinRequest($targetId, $this->config['private_channel_id'] ?? '');
                $this->telegram->answerCallbackQuery($id, 'درخواست تأیید شد ✅', true);
                $this->telegram->sendMessage($chatId, '✅ درخواست کاربر با شناسه ' . $targetId . ' با موفقیت تأیید شد.');
            }
            $this->telegram->answerCallbackQuery($id);
            return;
        }

        if ($data === 'start_registration') {
            $this->updateUser($telegramId, ['registration_step' => 'ask_name']);
            $this->logFunnelEvent($telegramId, 'registration_began', $user['campaign_source']);
            $namePrompt = $this->getSetting('msg_ask_name', "خیلی خوشحالیم که همراه مایی! ✨\n\nدوست داری با چه اسمی صدات کنیم؟\nلطفاً نام یا نام خانوادگیت رو بنویس:");
            $this->telegram->sendMessage($chatId, $namePrompt);
        } elseif ($data === 'check_public_channel') {
            $this->verifyPublicChannelStep($chatId, $user);
        }

        $callbackId = (string)($callbackQuery['id'] ?? '');
        if (!empty($callbackId)) {
            $this->telegram->answerCallbackQuery($callbackId);
        }
    }

    private function handleChatJoinRequest(array $joinRequest): void
    {
        $from = $joinRequest['from'];
        $telegramId = (string)$from['id'];
        $chat = $joinRequest['chat'];
        $chatId = (string)$chat['id'];
        $inviteLink = $joinRequest['invite_link']['invite_link'] ?? null;
        $now = date('Y-m-d H:i:s');

        $user = $this->getOrCreateUser($from);

        $isEligible = ((int)($user['is_eligible'] ?? 0) === 1) ||
                      ((int)($user['public_channel_verified'] ?? 0) === 1) ||
                      (!empty($user['phone_normalized'])) ||
                      (!empty($user['phone']));

        $this->logger->info('chat_join_request_received', [
            'telegram_id' => $telegramId,
            'chat_id' => $chatId,
            'is_eligible' => $isEligible ? 1 : 0,
            'registration_step' => $user['registration_step'] ?? 'unknown',
            'phone' => $user['phone'] ?? null
        ]);

        $stmt = $this->pdo->prepare('
            INSERT INTO join_requests (telegram_id, chat_id, status, invite_link, created_at, updated_at)
            VALUES (?, ?, "pending", ?, ?, ?)
            ON CONFLICT(telegram_id, chat_id) DO UPDATE SET
                status = "pending",
                invite_link = COALESCE(excluded.invite_link, join_requests.invite_link),
                updated_at = excluded.updated_at
        ');
        $stmt->execute([$telegramId, $chatId, $inviteLink, $now, $now]);

        $this->logFunnelEvent($telegramId, 'join_request_submitted', $user['campaign_source'], ['chat_id' => $chatId]);

        if ($isEligible) {
            $this->updateUser($telegramId, [
                'is_eligible' => 1,
                'registration_step' => 'eligible'
            ]);
            $targetChatId = !empty($chatId) ? $chatId : ($this->config['private_channel_id'] ?? '');
            $this->executeApproveJoinRequest($telegramId, $targetChatId);
        } else {
            $msg = "درخواست ورودت به کانال خصوصی ثبت شد! ⏳\nبرای اینکه عضویتت تأیید و کانال برات باز بشه، ابتدا باید دسترسی مینی‌دوره رو در ربات فعال کنی:";
            $this->telegram->sendMessage($telegramId, $msg, [
                'inline_keyboard' => [
                    [['text' => 'تکمیل ثبت‌نام و دریافت دسترسی فوری 🚀', 'callback_data' => 'start_registration']]
                ]
            ]);
        }
    }

    private function handleMyChatMember(array $myChatMember): void
    {
        $chat = $myChatMember['chat'];
        $newMember = $myChatMember['new_chat_member'] ?? [];
        $status = $newMember['status'] ?? '';
        $user = $myChatMember['from'];
        $telegramId = (string)$user['id'];

        if ($chat['type'] === 'private') {
            $isBlocked = in_array($status, ['kicked', 'left']) ? 1 : 0;
            $this->updateUser($telegramId, ['is_bot_blocked' => $isBlocked]);
        }
    }

    private function sendWelcomeStep(string|int $chatId, array $user): void
    {
        $this->updateUser($user['telegram_id'], ['registration_step' => 'started']);
        $name = $user['custom_name'] ?: ($user['first_name'] ?: 'کاربر');
        $text = $this->getSetting('msg_welcome');
        $btnText = $this->getSetting('btn_start_registration', 'دریافت دسترسی رایگان 🚀');

        $rendered = $this->replacePlaceholders($text, ['name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8')]);
        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnText, 'callback_data' => 'start_registration']
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $rendered, $keyboard);
    }

    private function handleNameInput(string|int $chatId, array $user, string $text): void
    {
        $telegramId = $user['telegram_id'];
        $cleanName = trim(strip_tags($text));

        if (mb_strlen($cleanName) < 2 || mb_strlen($cleanName) > 60) {
            $this->telegram->sendMessage($chatId, 'لطفاً یک نام معتبر (بین ۲ تا ۶۰ حرف) وارد کنید:');
            return;
        }

        $this->updateUser($telegramId, [
            'custom_name' => $cleanName,
            'registration_step' => 'ask_phone'
        ]);

        $this->logFunnelEvent($telegramId, 'name_submitted', $user['campaign_source'], ['name' => $cleanName]);

        $phoneMsg = $this->getSetting('msg_ask_phone');
        $rendered = $this->replacePlaceholders($phoneMsg, ['name' => htmlspecialchars($cleanName, ENT_QUOTES, 'UTF-8')]);
        $btnSendPhone = $this->getSetting('btn_send_phone', '📱 ارسال شماره من');

        $replyMarkup = [
            'keyboard' => [
                [
                    ['text' => $btnSendPhone, 'request_contact' => true]
                ]
            ],
            'resize_keyboard' => true,
            'one_time_keyboard' => true
        ];

        $this->telegram->sendMessage($chatId, $rendered, $replyMarkup);
    }

    private function handleContactInput(string|int $chatId, array $user, array $contact, int $senderId): void
    {
        $telegramId = $user['telegram_id'];
        $contactUserId = $contact['user_id'] ?? null;
        $rawPhone = $contact['phone_number'] ?? '';

        $isVerified = ($contactUserId !== null && (int)$contactUserId === (int)$senderId) ? 1 : 0;
        $normalized = $this->normalizePhone($rawPhone);

        if (!$normalized) {
            $err = $this->getSetting('msg_phone_invalid', 'شماره وارد شده معتبر نیست. لطفاً مجدداً شماره موبایل صحیح ارسال کنید:');
            $this->telegram->sendMessage($chatId, $err);
            return;
        }

        $this->updateUser($telegramId, [
            'phone' => $rawPhone,
            'phone_normalized' => $normalized,
            'phone_method' => 'contact_share',
            'phone_verified' => $isVerified,
            'registration_step' => 'public_channel_check'
        ]);

        $this->logFunnelEvent($telegramId, 'phone_submitted', $user['campaign_source'], [
            'method' => 'contact_share',
            'verified' => $isVerified
        ]);

        $this->removeReplyKeyboard($chatId);
        $this->proceedAfterPhone($chatId, $this->getUser($telegramId));
    }

    private function handlePhoneTextInput(string|int $chatId, array $user, string $text): void
    {
        $telegramId = $user['telegram_id'];
        $normalized = $this->normalizePhone($text);

        if (!$normalized) {
            $err = $this->getSetting('msg_phone_invalid', 'شماره وارد شده معتبر نیست. لطفاً یک شماره موبایل صحیح (مثلاً 09123456789) ارسال کنید:');
            $this->telegram->sendMessage($chatId, $err);
            return;
        }

        $this->updateUser($telegramId, [
            'phone' => $text,
            'phone_normalized' => $normalized,
            'phone_method' => 'manual_text',
            'phone_verified' => 0,
            'registration_step' => 'public_channel_check'
        ]);

        $this->logFunnelEvent($telegramId, 'phone_submitted', $user['campaign_source'], [
            'method' => 'manual_text',
            'verified' => 0
        ]);

        $this->removeReplyKeyboard($chatId);
        $this->proceedAfterPhone($chatId, $this->getUser($telegramId));
    }

    private function proceedAfterPhone(string|int $chatId, array $user): void
    {
        $requireChannel = $this->isPublicChannelRequired();

        if (!$requireChannel || (int)$user['public_channel_verified'] === 1) {
            $this->grantEligibility($chatId, $user);
        } else {
            $this->sendPublicChannelStep($chatId, $user);
        }
    }

    private function sendPublicChannelStep(string|int $chatId, array $user): void
    {
        $text = $this->getSetting('msg_public_channel_check');
        $btnJoin = $this->getSetting('btn_join_public_channel', 'عضویت در کانال عمومی ویرا 📢');
        $btnCheck = $this->getSetting('btn_check_public_channel', 'عضو شدم؛ بررسی کن ✅');
        $channelUrl = $this->config['public_channel_url'];

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnJoin, 'url' => $channelUrl]
                ],
                [
                    ['text' => $btnCheck, 'callback_data' => 'check_public_channel']
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $text, $keyboard);
    }

    public function verifyPublicChannelStep(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];

        if ((int)$user['public_channel_verified'] === 1) {
            $this->grantEligibility($chatId, $user);
            return;
        }

        $publicChannelId = $this->config['public_channel_id'] ?? '';
        $resp = !empty($publicChannelId) ? $this->telegram->getChatMember($publicChannelId, $telegramId) : ['ok' => false, 'description' => 'empty_channel_id'];

        if ($resp['ok']) {
            $status = $resp['result']['status'] ?? '';
            if (in_array($status, ['creator', 'administrator', 'member'])) {
                $now = date('Y-m-d H:i:s');
                $this->updateUser($telegramId, [
                    'public_channel_verified' => 1,
                    'public_channel_verified_at' => $now
                ]);
                $this->logFunnelEvent($telegramId, 'public_channel_joined', $user['campaign_source']);
                $this->grantEligibility($chatId, $this->getUser($telegramId));
                return;
            }
        } else {
            $this->logger->warning('get_chat_member_failed', [
                'public_channel_id' => $publicChannelId,
                'user_id' => $telegramId,
                'description' => $resp['description'] ?? 'unknown'
            ]);
        }

        $btnJoinText = $this->getSetting('btn_join_public_channel', 'عضویت در کانال عمومی ویرا 📢');
        $btnCheckText = $this->getSetting('btn_check_public_channel', 'عضو شدم؛ بررسی کن ✅');
        $publicUrl = !empty($this->config['public_channel_url']) ? $this->config['public_channel_url'] : 'https://t.me';

        $this->telegram->sendMessage($chatId, "هنوز عضویت شما در کانال عمومی تأیید نشده است. لطفاً ابتدا در کانال عضو شده و سپس مجدداً دکمه بررسی را بزنید:", [
            'inline_keyboard' => [
                [['text' => $btnJoinText, 'url' => $publicUrl]],
                [['text' => $btnCheckText, 'callback_data' => 'check_public_channel']]
            ]
        ]);
    }

    private function grantEligibility(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];
        $now = date('Y-m-d H:i:s');

        $this->updateUser($telegramId, [
            'is_eligible' => 1,
            'eligible_at' => $now,
            'registration_step' => 'eligible'
        ]);

        $this->logFunnelEvent($telegramId, 'eligible_granted', $user['campaign_source']);

        $this->sendCourseLinkStep($chatId, $user);

        $this->checkAndApprovePendingJoinRequests($telegramId);
    }

    private function sendCourseLinkStep(string|int $chatId, array $user): void
    {
        $telegramId = $user['telegram_id'];
        $privateChannelId = $this->config['private_channel_id'];

        $membershipCheck = $this->telegram->getChatMember($privateChannelId, $telegramId);
        if ($membershipCheck['ok']) {
            $status = $membershipCheck['result']['status'] ?? '';
            if (in_array($status, ['creator', 'administrator', 'member'])) {
                $alreadyMsg = $this->getSetting('msg_already_member');
                $this->telegram->sendMessage($chatId, $alreadyMsg);
                return;
            }
        }

        $inviteLink = $this->getOrCreateJoinRequestLink($privateChannelId);
        $name = $user['custom_name'] ?: ($user['first_name'] ?: 'کاربر');
        $msg = $this->getSetting('msg_qualified');
        $rendered = $this->replacePlaceholders($msg, [
            'name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'),
            'course_channel_link' => $inviteLink
        ]);

        $btnText = $this->getSetting('btn_private_join_request', 'ورود به کانال مینی‌دوره 🎓');
        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => $btnText, 'url' => $inviteLink]
                ]
            ]
        ];

        $this->telegram->sendMessage($chatId, $rendered, $keyboard);
    }

    public function checkAndApprovePendingJoinRequests(string $telegramId): void
    {
        $stmt = $this->pdo->prepare('
            SELECT id, chat_id
            FROM join_requests
            WHERE telegram_id = ? AND status = "pending"
        ');
        $stmt->execute([$telegramId]);
        $requests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($requests as $req) {
            $this->queue->push('approve_join_request', [
                'telegram_id' => $telegramId,
                'chat_id' => $req['chat_id']
            ], 1);
            $this->executeApproveJoinRequest($telegramId, $req['chat_id']);
        }
    }

    public function executeApproveJoinRequest(string $telegramId, string $chatId): bool
    {
        $now = date('Y-m-d H:i:s');
        $primaryChatId = !empty($chatId) ? $chatId : ($this->config['private_channel_id'] ?? '');
        $fallbackChatId = (string)($this->config['private_channel_id'] ?? '');

        $resp = $this->telegram->approveChatJoinRequest($primaryChatId, $telegramId);

        if (empty($resp['ok']) && !empty($fallbackChatId) && (string)$primaryChatId !== $fallbackChatId) {
            $resp = $this->telegram->approveChatJoinRequest($fallbackChatId, $telegramId);
            if (!empty($resp['ok'])) {
                $primaryChatId = $fallbackChatId;
            }
        }

        if (empty($resp['ok']) && isset($resp['description']) && !str_contains($resp['description'], 'USER_ALREADY_PARTICIPANT')) {
            usleep(350000);
            $resp = $this->telegram->approveChatJoinRequest($primaryChatId, $telegramId);
        }

        $this->logger->info('execute_approve_join_request_called', [
            'chat_id' => $primaryChatId,
            'telegram_id' => $telegramId,
            'response' => $resp
        ]);

        $isSuccess = !empty($resp['ok']) || (isset($resp['description']) && str_contains($resp['description'], 'USER_ALREADY_PARTICIPANT'));

        if ($isSuccess) {
            $stmt = $this->pdo->prepare('
                UPDATE join_requests
                SET status = "approved", approved_at = ?, updated_at = ?
                WHERE telegram_id = ?
            ');
            $stmt->execute([$now, $now, $telegramId]);

            $this->updateUser($telegramId, [
                'private_channel_status' => 'approved',
                'private_channel_approved_at' => $now
            ]);

            $user = $this->getUser($telegramId);
            $this->logFunnelEvent($telegramId, 'join_request_approved', $user['campaign_source'] ?? null);

            $approvedMsg = $this->getSetting('msg_join_approved', "دسترسی مینی‌دوره برات فعال شد! 🌟\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:");
            $btnEnter = $this->getSetting('btn_enter_course', 'شروع درس‌های مینی‌دوره 🚀');
            $courseUrl = !empty($fallbackChatId) ? 'https://t.me/c/' . ltrim($fallbackChatId, '-100') : ($this->config['public_channel_url'] ?? 'https://t.me');

            $this->telegram->sendMessage($telegramId, $approvedMsg, [
                'inline_keyboard' => [
                    [['text' => $btnEnter, 'url' => $courseUrl]]
                ]
            ]);

            return true;
        }

        $errorDesc = $resp['description'] ?? 'Telegram API error';
        $this->logger->error('execute_approve_join_request_failed', [
            'chat_id' => $primaryChatId,
            'telegram_id' => $telegramId,
            'description' => $errorDesc,
            'response' => $resp
        ]);

        $stmt = $this->pdo->prepare('
            UPDATE join_requests
            SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
            WHERE telegram_id = ?
        ');
        $stmt->execute([$errorDesc, $now, $telegramId]);

        return false;
    }

    private function getOrCreateJoinRequestLink(string $chatId): string
    {
        $stmt = $this->pdo->prepare('SELECT value FROM settings WHERE key = "cached_private_join_link"');
        $stmt->execute();
        $cached = $stmt->fetchColumn();
        if ($cached) {
            return $cached;
        }

        $resp = $this->telegram->createChatInviteLink($chatId, 'Viraa Mini Course Link', true);
        if ($resp['ok'] && isset($resp['result']['invite_link'])) {
            $link = $resp['result']['invite_link'];
            $now = date('Y-m-d H:i:s');
            $setStmt = $this->pdo->prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ("cached_private_join_link", ?, ?)');
            $setStmt->execute([$link, $now]);
            return $link;
        }

        return 'https://t.me/c/' . ltrim($chatId, '-100');
    }

    public function normalizePhone(string $phone): ?string
    {
        $persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        $arabicDigits  = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $englishDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

        $clean = str_replace($persianDigits, $englishDigits, $phone);
        $clean = str_replace($arabicDigits, $englishDigits, $clean);
        $clean = preg_replace('/[^\d\+]/', '', $clean);

        if (str_starts_with($clean, '0098')) {
            $clean = '0' . substr($clean, 4);
        } elseif (str_starts_with($clean, '+98')) {
            $clean = '0' . substr($clean, 3);
        } elseif (str_starts_with($clean, '98') && strlen($clean) === 12) {
            $clean = '0' . substr($clean, 2);
        }

        if (preg_match('/^09[0-9]{9}$/', $clean)) {
            return $clean;
        }

        if (str_starts_with($clean, '+') && strlen($clean) >= 8 && strlen($clean) <= 16) {
            return $clean;
        }

        return null;
    }

    private function removeReplyKeyboard(string|int $chatId): void
    {
        $this->telegram->sendMessage($chatId, 'شماره شما دریافت شد. در حال ادامه...', [
            'remove_keyboard' => true
        ]);
    }

    private function getOrCreateUser(array $from): array
    {
        $telegramId = (string)$from['id'];
        $now = date('Y-m-d H:i:s');

        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE telegram_id = ?');
        $stmt->execute([$telegramId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            $insert = $this->pdo->prepare('
                INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ');
            $insert->execute([
                $telegramId,
                $from['username'] ?? null,
                $from['first_name'] ?? null,
                $from['last_name'] ?? null,
                $now,
                $now
            ]);
            $stmt->execute([$telegramId]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
        } else {
            $update = $this->pdo->prepare('
                UPDATE users
                SET username = ?, first_name = ?, last_name = ?, updated_at = ?
                WHERE telegram_id = ?
            ');
            $update->execute([
                $from['username'] ?? null,
                $from['first_name'] ?? null,
                $from['last_name'] ?? null,
                $now,
                $telegramId
            ]);
            $user['username'] = $from['username'] ?? ($user['username'] ?? null);
            $user['first_name'] = $from['first_name'] ?? ($user['first_name'] ?? null);
            $user['last_name'] = $from['last_name'] ?? ($user['last_name'] ?? null);
        }

        return $user;
    }

    public function getUser(string $telegramId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE telegram_id = ?');
        $stmt->execute([$telegramId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function updateUser(string $telegramId, array $fields): void
    {
        $fields['updated_at'] = date('Y-m-d H:i:s');
        $setParts = [];
        $params = [];
        foreach ($fields as $col => $val) {
            $setParts[] = "{$col} = ?";
            $params[] = $val;
        }
        $params[] = $telegramId;

        $sql = 'UPDATE users SET ' . implode(', ', $setParts) . ' WHERE telegram_id = ?';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
    }

    private function isPublicChannelRequired(): bool
    {
        $val = $this->getSetting('require_public_channel');
        if ($val === '') {
            return (bool)($this->config['require_public_channel'] ?? true);
        }
        return (bool)$val;
    }

    public function getSetting(string $key, string $default = ''): string
    {
        $stmt = $this->pdo->prepare('SELECT value FROM settings WHERE key = ?');
        $stmt->execute([$key]);
        $val = $stmt->fetchColumn();
        return ($val !== false && $val !== null && $val !== '') ? (string)$val : $default;
    }

    public function logFunnelEvent(string $telegramId, string $eventName, ?string $source = null, array $meta = []): void
    {
        $stmt = $this->pdo->prepare('
            INSERT INTO funnel_events (telegram_id, event_name, campaign_source, metadata, created_at)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $telegramId,
            $eventName,
            $source,
            json_encode($meta, JSON_UNESCAPED_UNICODE),
            date('Y-m-d H:i:s')
        ]);
    }

    public function replacePlaceholders(string $text, array $vars): string
    {
        foreach ($vars as $k => $v) {
            $text = str_replace('{' . $k . '}', (string)$v, $text);
        }
        return $text;
    }

    public function isAdmin(string $telegramId): bool
    {
        $ownerId = (string)($this->config['admin_telegram_id'] ?? '');
        if (!empty($ownerId) && (string)$telegramId === $ownerId) {
            return true;
        }
        try {
            $stmt = $this->pdo->prepare('SELECT id FROM admins WHERE telegram_id = ? AND is_active = 1');
            $stmt->execute([$telegramId]);
            return (bool)$stmt->fetchColumn();
        } catch (Throwable $e) {
            return false;
        }
    }

    private function handleAdminCommand(string|int $chatId, string $telegramId): void
    {
        if (!$this->isAdmin($telegramId)) {
            $this->telegram->sendMessage($chatId, "⛔ شما به بخش مدیریت این ربات دسترسی ندارید.\nشناسه تلگرام شما: " . $telegramId);
            return;
        }
        $this->sendAdminDashboardMessage($chatId);
    }

    public function sendAdminDashboardMessage(string|int $chatId): void
    {
        $totalUsers = (int)$this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $nameSubmitted = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE custom_name IS NOT NULL')->fetchColumn();
        $phoneSubmitted = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE phone_normalized IS NOT NULL')->fetchColumn();
        $eligible = (int)$this->pdo->query('SELECT COUNT(*) FROM users WHERE is_eligible = 1')->fetchColumn();
        $approved = (int)$this->pdo->query('SELECT COUNT(*) FROM join_requests WHERE status = "approved"')->fetchColumn();
        $pending = (int)$this->pdo->query('SELECT COUNT(*) FROM join_requests WHERE status = "pending"')->fetchColumn();

        $appUrl = rtrim($this->config['app_url'] ?? '', '/');
        $panelUrl = !empty($appUrl) ? $appUrl . '/index.php' : '';
        $logsUrl = !empty($appUrl) ? $appUrl . '/webhook.php?action=logs' : '';
        $diagUrl = !empty($appUrl) ? $appUrl . '/webhook.php?action=diagnose' : '';

        $text = "🎓 *پنل مدیریت ویرا انگلیش (تلگرام)*\n\n" .
            "👥 کل کاربران شروع‌کننده: *" . number_format($totalUsers) . " نفر*\n" .
            "📝 ثبت نام کرده: *" . number_format($nameSubmitted) . " نفر*\n" .
            "📱 شماره موبایل داده: *" . number_format($phoneSubmitted) . " نفر*\n" .
            "🌟 واجدین شرایط مینی‌دوره: *" . number_format($eligible) . " نفر*\n" .
            "🎓 اعضای کانال خصوصی دوره: *" . number_format($approved) . " نفر*\n" .
            "⏳ درخواست‌های معلق در صف: *" . number_format($pending) . " درخواست*\n\n" .
            "عملیات سریع:";

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => '🔄 بروزرسانی آمار', 'callback_data' => 'admin_refresh_stats'],
                    ['text' => '⏳ درخواست‌های معلق (' . $pending . ')', 'callback_data' => 'admin_pending_requests']
                ]
            ]
        ];

        if (!empty($panelUrl)) {
            $keyboard['inline_keyboard'][] = [
                ['text' => '🌐 باز کردن پنل مدیریت تحت وب', 'url' => $panelUrl]
            ];
        }

        if (!empty($logsUrl)) {
            $keyboard['inline_keyboard'][] = [
                ['text' => '📜 مشاهده لاگ‌ها', 'url' => $logsUrl],
                ['text' => '🩺 عیب‌یابی سرور', 'url' => $diagUrl]
            ];
        }

        $this->telegram->sendMessage($chatId, $text, $keyboard, 'Markdown');
    }

    public function sendAdminPendingRequests(string|int $chatId): void
    {
        $stmt = $this->pdo->query('
            SELECT j.telegram_id, j.created_at, u.custom_name, u.first_name, u.username, u.phone_normalized
            FROM join_requests j
            LEFT JOIN users u ON u.telegram_id = j.telegram_id
            WHERE j.status = "pending"
            ORDER BY j.id DESC
            LIMIT 5
        ');
        $requests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($requests)) {
            $this->telegram->sendMessage($chatId, "✅ هیچ درخواست معلقی در صف وجود ندارد. همه درخواست‌ها تأیید شده‌اند.");
            return;
        }

        foreach ($requests as $r) {
            $name = $r['custom_name'] ?: ($r['first_name'] ?: 'کاربر');
            $userTag = !empty($r['username']) ? '@' . ltrim($r['username'], '@') : 'ندارد';
            $phone = $r['phone_normalized'] ?: 'ثبت نشده';

            $msg = "👤 درخواست عضویت کاربر:\n" .
                "نام: " . $name . "\n" .
                "یوزرنیم: " . $userTag . "\n" .
                "تلفن: " . $phone . "\n" .
                "شناسه تلگرام: `" . $r['telegram_id'] . "`";

            $btn = [
                'inline_keyboard' => [
                    [['text' => 'تأیید فوری دسترسی ✅', 'callback_data' => 'admin_approve_' . $r['telegram_id']]]
                ]
            ];

            $this->telegram->sendMessage($chatId, $msg, $btn, 'Markdown');
        }
    }
}
