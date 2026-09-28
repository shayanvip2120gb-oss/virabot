<?php

class Database
{
    private static ?PDO $pdo = null;

    public static function getConnection(array $config): PDO
    {
        if (self::$pdo === null) {
            $driver = $config['db_driver'] ?? 'sqlite';
            if ($driver === 'sqlite') {
                $dbFile = $config['db_file'];
                $dir = dirname($dbFile);
                if (!is_dir($dir)) {
                    mkdir($dir, 0755, true);
                }
                self::$pdo = new PDO('sqlite:' . $dbFile);
                self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                self::$pdo->exec('PRAGMA journal_mode = WAL');
                self::$pdo->exec('PRAGMA busy_timeout = 5000');
            } else {
                $dsn = sprintf(
                    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                    $config['db_host'] ?? '127.0.0.1',
                    $config['db_port'] ?? '3306',
                    $config['db_name'] ?? 'viraa_bot'
                );
                self::$pdo = new PDO($dsn, $config['db_user'] ?? '', $config['db_pass'] ?? '');
                self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            }
            self::ensureTablesExist(self::$pdo);
        }
        return self::$pdo;
    }

    public static function ensureTablesExist(PDO $pdo): void
    {
        try {
            $pdo->query('SELECT 1 FROM users LIMIT 1');
        } catch (Throwable $e) {
            self::initTables($pdo);
        }
    }

    public static function initTables(PDO $pdo): void
    {
        $schemaFile = dirname(__DIR__) . '/schema.sql';
        if (file_exists($schemaFile)) {
            $sql = file_get_contents($schemaFile);
            $statements = array_filter(array_map('trim', explode(';', $sql)));
            foreach ($statements as $stmt) {
                if (!empty($stmt)) {
                    $pdo->exec($stmt);
                }
            }
        }
        try {
            $pdo->exec('ALTER TABLE users ADD COLUMN username TEXT');
        } catch (Throwable $e) {
        }
        self::seedDefaultSettings($pdo);
    }

    private static function seedDefaultSettings(PDO $pdo): void
    {
        $now = date('Y-m-d H:i:s');
        $defaults = [
            'require_public_channel' => '1',
            'msg_welcome' => "سلام {name} عزیز! 👋\n\nبه مینی‌دوره رایگان ویرا انگلیش خوش اومدی.\nتوی این مینی‌دوره قراره مهم‌ترین تکنیک‌های یادگیری مکالمه انگلیسی رو با هم یاد بگیریم.\n\nبرای شروع، لطفاً دکمه زیر رو بزن تا مراحل رو با هم پیش بریم:",
            'btn_start_registration' => 'دریافت دسترسی رایگان 🚀',
            'msg_ask_name' => "خیلی خوشحالیم که همراه مایی! ✨\n\nدوست داری با چه اسمی صدات کنیم؟\nلطفاً نام یا نام خانوادگیت رو بنویس:",
            'msg_ask_phone' => "ممنون {name} عزیز! 🌹\n\nجهت ثبت‌نام قطعی و ارسال نکات پشتیبانی دوره، شماره تماست رو برامون بفرست.\nمی‌تونی با زدن دکمه زیر شماره تلگرامت رو بفرستی، یا دستی تایپش کنی:",
            'btn_send_phone' => '📱 ارسال شماره من',
            'msg_public_channel_check' => "یک گام تا دسترسی کامل به مینی‌دوره باقی مونده! 📢\n\nلطفاً ابتدا در کانال اطلاع‌رسانی ویرا انگلیش عضو شو و بعد دکمه بررسی رو بزن:",
            'btn_join_public_channel' => 'عضویت در کانال عمومی ویرا 📢',
            'btn_check_public_channel' => 'عضو شدم؛ بررسی کن ✅',
            'msg_qualified' => "تبریک {name} عزیز! 🎉\n\nثبت‌نامت تکمیل شد و دسترسی رایگان برات باز شد.\nحالا روی لینک زیر کلیک کن و دکمه Request to Join (درخواست عضویت) رو بزن تا بلافاصله به کانال اختصاصی مینی‌دوره اضافه بشی:",
            'btn_private_join_request' => 'ورود به کانال مینی‌دوره 🎓',
            'msg_join_pending' => "درخواستت ثبت شد و در حال بررسیه! ⏳\nبه زودی تأیید میشه و پیامی برات میاد.",
            'msg_join_approved' => "دسترسی مینی‌دوره برات فعال شد! 🌟\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:",
            'btn_enter_course' => 'شروع درس‌های مینی‌دوره 🚀',
            'msg_already_member' => "شما از قبل عضو کانال مینی‌دوره هستید! 📚\nمی‌تونید همین الان از محتوای دوره استفاده کنید.",
            'msg_phone_invalid' => "شماره وارد شده معتبر نیست. لطفاً یک شماره موبایل صحیح (مثلاً 09123456789) ارسال کنید:"
        ];

        $stmt = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
        foreach ($defaults as $key => $val) {
            $stmt->execute([$key, $val, $now]);
        }
    }
}
