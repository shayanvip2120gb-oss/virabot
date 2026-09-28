<?php

class Logger
{
    private string $logFile;
    private string $errorLogFile;
    private int $maxBytes;
    private int $budgetBytes;

    public function __construct(array $config)
    {
        $this->logFile = $config['log_file'] ?? (__DIR__ . '/../logs/bot.log');
        $this->errorLogFile = $config['error_log_file'] ?? (__DIR__ . '/../logs/error.log');
        $this->maxBytes = ($config['log_max_mb'] ?? 10) * 1024 * 1024;
        $this->budgetBytes = ($config['log_budget_mb'] ?? 300) * 1024 * 1024;

        $dir = dirname($this->logFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
    }

    public function info(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('INFO', $this->logFile, $event, $context, $correlationId);
    }

    public function warning(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('WARNING', $this->logFile, $event, $context, $correlationId);
    }

    public function error(string $event, array $context = [], ?string $correlationId = null): void
    {
        $this->write('ERROR', $this->errorLogFile, $event, $context, $correlationId);
        $this->write('ERROR', $this->logFile, $event, $context, $correlationId);
    }

    private function write(string $level, string $targetFile, string $event, array $context, ?string $correlationId): void
    {
        $this->rotateIfNeeded($targetFile);

        $sanitized = $this->sanitizeContext($context);
        $entry = [
            'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
            'level' => $level,
            'correlation_id' => $correlationId ?: bin2hex(random_bytes(6)),
            'event' => $event,
            'context' => $sanitized
        ];

        file_put_contents($targetFile, json_encode($entry, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    private function rotateIfNeeded(string $file): void
    {
        if (file_exists($file) && filesize($file) >= $this->maxBytes) {
            $timestamp = date('Ymd_His');
            $archived = $file . '.' . $timestamp;
            rename($file, $archived);
            $this->enforceBudget(dirname($file));
        }
    }

    public function enforceBudget(string $dir): void
    {
        $files = glob($dir . '/*');
        if (!$files) {
            return;
        }

        $total = 0;
        $fileList = [];
        foreach ($files as $f) {
            if (is_file($f)) {
                $size = filesize($f);
                $total += $size;
                $fileList[] = ['path' => $f, 'size' => $size, 'time' => filemtime($f)];
            }
        }

        if ($total > $this->budgetBytes) {
            usort($fileList, fn($a, $b) => $a['time'] <=> $b['time']);
            foreach ($fileList as $item) {
                if ($total <= $this->budgetBytes) {
                    break;
                }
                if ($item['path'] !== $this->logFile && $item['path'] !== $this->errorLogFile) {
                    unlink($item['path']);
                    $total -= $item['size'];
                }
            }
        }
    }

    private function sanitizeContext(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            if (is_array($value)) {
                $clean[$key] = $this->sanitizeContext($value);
            } elseif (is_string($value)) {
                if (stripos($key, 'token') !== false || stripos($key, 'secret') !== false || stripos($key, 'password') !== false) {
                    $clean[$key] = '***MASKED***';
                } elseif (stripos($key, 'phone') !== false) {
                    $clean[$key] = $this->maskPhone($value);
                } else {
                    $clean[$key] = $value;
                }
            } else {
                $clean[$key] = $value;
            }
        }
        return $clean;
    }

    private function maskPhone(string $phone): string
    {
        $len = strlen($phone);
        if ($len <= 4) {
            return '****';
        }
        return substr($phone, 0, 4) . '***' . substr($phone, -2);
    }
}
