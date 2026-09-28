<?php

class TelegramApi
{
    private string $token;
    private string $baseUrl;
    private ?Logger $logger;

    public function __construct(string $token, ?Logger $logger = null)
    {
        $this->token = $token;
        $this->baseUrl = 'https://api.telegram.org/bot' . $token . '/';
        $this->logger = $logger;
    }

    public function getMe(): array
    {
        return $this->request('getMe');
    }

    public function sendMessage(string|int $chatId, string $text, ?array $replyMarkup = null, string $parseMode = 'HTML'): array
    {
        $params = [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => $parseMode,
            'disable_web_page_preview' => false
        ];
        if ($replyMarkup !== null) {
            $params['reply_markup'] = json_encode($replyMarkup);
        }
        return $this->request('sendMessage', $params);
    }

    public function sendPhoto(string|int $chatId, string $photo, string $caption = '', ?array $replyMarkup = null, string $parseMode = 'HTML'): array
    {
        $params = [
            'chat_id' => $chatId,
            'photo' => $photo,
            'caption' => $caption,
            'parse_mode' => $parseMode
        ];
        if ($replyMarkup !== null) {
            $params['reply_markup'] = json_encode($replyMarkup);
        }
        return $this->request('sendPhoto', $params);
    }

    public function getChat(string|int $chatId): array
    {
        return $this->request('getChat', [
            'chat_id' => $chatId
        ]);
    }

    public function getChatAdministrators(string|int $chatId): array
    {
        return $this->request('getChatAdministrators', [
            'chat_id' => $chatId
        ]);
    }

    public function answerCallbackQuery(string $callbackQueryId, ?string $text = null, bool $showAlert = false): array
    {
        $params = [
            'callback_query_id' => $callbackQueryId
        ];
        if ($text !== null) {
            $params['text'] = $text;
            $params['show_alert'] = $showAlert;
        }
        return $this->request('answerCallbackQuery', $params);
    }

    public function getChatMember(string|int $chatId, string|int $userId): array
    {
        return $this->request('getChatMember', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function approveChatJoinRequest(string|int $chatId, string|int $userId): array
    {
        return $this->request('approveChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function declineChatJoinRequest(string|int $chatId, string|int $userId): array
    {
        return $this->request('declineChatJoinRequest', [
            'chat_id' => $chatId,
            'user_id' => $userId
        ]);
    }

    public function createChatInviteLink(string|int $chatId, string $name, bool $createsJoinRequest = true): array
    {
        return $this->request('createChatInviteLink', [
            'chat_id' => $chatId,
            'name' => $name,
            'creates_join_request' => $createsJoinRequest
        ]);
    }

    public function setWebhook(string $url, ?string $secretToken = null, array $allowedUpdates = []): array
    {
        $params = [
            'url' => $url,
            'drop_pending_updates' => false
        ];
        if (!empty($secretToken)) {
            $params['secret_token'] = $secretToken;
        }
        if (!empty($allowedUpdates)) {
            $params['allowed_updates'] = json_encode($allowedUpdates);
        } else {
            $params['allowed_updates'] = json_encode(['message', 'callback_query', 'chat_join_request', 'my_chat_member']);
        }
        return $this->request('setWebhook', $params);
    }

    public function getWebhookInfo(): array
    {
        return $this->request('getWebhookInfo');
    }

    public function deleteWebhook(bool $dropPendingUpdates = false): array
    {
        return $this->request('deleteWebhook', [
            'drop_pending_updates' => $dropPendingUpdates
        ]);
    }

    private function request(string $method, array $params = []): array
    {
        $url = $this->baseUrl . $method;
        $ch = curl_init();

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            if ($this->logger) {
                $this->logger->error('telegram_api_curl_failed', [
                    'method' => $method,
                    'error' => $error
                ]);
            }
            return [
                'ok' => false,
                'error_code' => 0,
                'description' => 'cURL Error: ' . $error
            ];
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            if ($this->logger) {
                $this->logger->error('telegram_api_invalid_json', [
                    'method' => $method,
                    'http_code' => $httpCode,
                    'raw_response' => substr($response, 0, 200)
                ]);
            }
            return [
                'ok' => false,
                'error_code' => $httpCode,
                'description' => 'Invalid JSON response from Telegram API'
            ];
        }

        if (!$decoded['ok'] && $this->logger) {
            $this->logger->warning('telegram_api_error_response', [
                'method' => $method,
                'http_code' => $httpCode,
                'error_code' => $decoded['error_code'] ?? null,
                'description' => $decoded['description'] ?? 'Unknown error'
            ]);
        }

        return $decoded;
    }
}
