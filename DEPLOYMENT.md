# راهنمای جامع استقرار سرور برای مدیر سیستم (Viraa English Bot)

این سند مراحل اجرایی و دقیق استقرار سامانه را بر روی سرورهای ابری (VPS) یا سرورهای اختصاصی مشخص می‌کند.

---

## ۱. حداقل مشخصات سرور پیشنهادی
- **پردازنده:** ۱ هسته (vCPU)
- **رم:** ۱ گیگابایت
- **دیسک:** ۱۰ گیگابایت SSD/NVMe
- **سیستم‌عامل:** Ubuntu 22.04 LTS / Debian 12

---

## ۲. نصب نیازمندی‌های سیستم‌عامل
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx php8.2-fpm php8.2-cli php8.2-curl php8.2-mbstring php8.2-sqlite3 php8.2-xml curl git unzip
```

---

## ۳. تنظیم وب‌سرور Nginx
یک فایل پیکربندی برای دامنه ایجاد کنید:
```bash
sudo nano /etc/nginx/sites-available/viraa-bot
```

محتوای فایل پیکربندی:
```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    root /var/www/viraa-bot;
    index index.php;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.(ht|env|git) {
        deny all;
    }

    location /data/ {
        deny all;
    }

    location /logs/ {
        deny all;
    }
}
```

فعال‌سازی هاست و اعمال تنظیمات:
```bash
sudo ln -s /etc/nginx/sites-available/viraa-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

دریافت گواهی رایگان SSL با Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

---

## ۴. استقرار سورس کد و مجوزها
```bash
sudo mkdir -p /var/www/viraa-bot
sudo chown -R www-data:www-data /var/www/viraa-bot
sudo chmod -R 775 /var/www/viraa-bot
```

انتقال فایل‌های پروژه به `/var/www/viraa-bot` و سپس ایجاد دایرکتوری‌های داده و لاگ:
```bash
cd /var/www/viraa-bot
sudo -u www-data mkdir -p data logs
sudo -u www-data php install.php
sudo -u www-data php doctor.php
```

---

## ۵. تنظیم فرآیند دائمی با Supervisor (جایگزین اختیاری برای Systemd)
در صورت ترجیح استفاده از Supervisor به جای Systemd:
```bash
sudo apt install -y supervisor
sudo nano /etc/supervisor/conf.d/viraa-worker.conf
```
محتوای فایل:
```ini
[program:viraa-worker]
process_name=%(program_name)s_%(process_num)02d
command=/usr/bin/php /var/www/viraa-bot/worker.php
autostart=true
autorestart=true
user=www-data
numprocs=1
redirect_stderr=true
stdout_logfile=/var/www/viraa-bot/logs/worker.log
```
بارگذاری تنظیمات:
```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start viraa-worker:*
```

---

## ۶. تنظیم Logrotate برای وب‌سرور و سرویس‌های سیستمی
```bash
sudo nano /etc/logrotate.d/viraa-bot
```
محتوا:
```text
/var/www/viraa-bot/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

---

## ۷. پشتیبان‌گیری منظم (Backup)
برای پشتیبان‌گیری خودکار از دیتابیس SQLite و فایل تنظیمات:
```bash
sudo nano /usr/local/bin/backup-viraa.sh
```
محتوا:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/viraa"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"
sqlite3 /var/www/viraa-bot/data/database.sqlite ".backup '$BACKUP_DIR/db_$TIMESTAMP.sqlite'"
cp /var/www/viraa-bot/config.php "$BACKUP_DIR/config_$TIMESTAMP.php"
find "$BACKUP_DIR" -type f -mtime +30 -delete
```
اعطای دسترسی اجرا:
```bash
sudo chmod +x /usr/local/bin/backup-viraa.sh
```
افزودن به Crontab برای اجرای شبانه ساعت ۴ صبح:
```cron
0 4 * * * /usr/local/bin/backup-viraa.sh > /dev/null 2>&1
```
