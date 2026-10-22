# پایش قطار مستربلیط (PHP — هاست اشتراکی)

اسکریپت سبک برای چک کردن ظرفیت قطار از **train.mrbilit.com** و ارسال هشدار به **بله** وقتی صندلی باز شد.

پیش‌فرض منطقی: مسیر **تهران → مشهد** (ایستگاه ۱ به ۱۹۱).

## نصب روی هاست

1. پوشه `php-host-mrbilit` را روی هاست آپلود کنید (مثلاً خارج از `public_html` یا داخل یک زیرپوشه).
2. `config.example.php` را کپی کنید به `config.php`.
3. در `config.php` مقدار دهید:
   - `departure_dates` — تاریخ حرکت **میلادی** (`2026-11-15`)
   - `bale_token` و `bale_chat_id`
   - در صورت نیاز `min_seats` و `quota`
4. مطمئن شوید PHP 8.1+ و `allow_url_fopen=On` (یا curl فعال) برای درخواست HTTPS باشد.

## cron هر ۱ دقیقه

در cPanel → Cron Jobs:

```text
* * * * * /usr/bin/php /home/USERNAME/path/to/php-host-mrbilit/cron.php
```

مسیر `php` را از هاست بپرسید (گاهی `/usr/local/bin/php`).

### روش دوم (URL + رمز)

اگر cron CLI ندارید، در `config.php` مقدار `cron_secret` بگذارید و هر دقیقه این URL را صدا بزنید:

```text
https://your-domain.com/php-host-mrbilit/cron.php?key=همان_رمز_طولانی
```

## رفتار هشدار

- فقط وقتی یک **کلاس واگن** از حالت «بدون ظرفیت» به «با ظرفیت» می‌رود، یک پیام بله می‌رود (تا هر دقیقه اسپم نشود).
- لاگ اجرا: `data/run.log`
- وضعیت dedupe: `data/state.json`

## محدودیت

درخواست هر **۱ دقیقه** ممکن است گاهی از طرف مستربلیط محدود شود (۴۰۳/۴۲۹). در آن صورت در لاگ ثبت می‌شود؛ در صورت تکرار، فاصله cron را به ۲–۳ دقیقه افزایش دهید.

## تست دستی

```bash
php cron.php
```

یا با مرورگر (بعد از تنظیم `cron_secret`):

`cron.php?key=...`
