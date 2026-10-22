# پایش قطار مستربلیط (PHP — هاست اشتراکی)

اسکریپت سبک برای چک کردن ظرفیت قطار از **train.mrbilit.com** و ارسال هشدار به **بله** وقتی صندلی باز شد.

پیش‌فرض منطقی: مسیر **تهران → مشهد** (ایستگاه ۱ به ۱۹۱).

## نصب روی هاست

1. پوشه `php-host-mrbilit` را روی هاست آپلود کنید (مثلاً خارج از `public_html` یا داخل یک زیرپوشه).
2. `config.example.php` را کپی کنید به `config.php`.
3. در `config.php` مقدار دهید:
   - `departure_dates` — تاریخ حرکت **میلادی** (`2026-11-15`)
   - `bale_token` و `bale_chat_id`
   - در صورت نیاز `min_seats`، `max_price_toman` (۰ = بدون سقف) و `quota`
4. مطمئن شوید **PHP 7.4+** (ترجیحاً 8.x) و **cURL** یا `allow_url_fopen=On` برای HTTPS فعال باشد.

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

خروجی نمونه: `done offers=12 alerts=0 dedupe_skipped=0`

- **offers=0** یعنی API مستربلیط کلاس قابل‌خرید برنگردانده (یا خطا — `data/run.log` را ببینید).
- **alerts=0** با **offers>0** یعنی یا قبلاً همان واگن را اعلام کرده‌اید (`dedupe_skipped`) یا بله خطا داده.
- تاریخ در `config.php` حتماً **میلادی** باشد (`2026-10-30`)، نه شمسی (`1405-08-08`).

### عیب‌یابی در مرورگر

```text
cron.php?key=رمز&debug=1
```

جزئیات JSON (تعداد قطار API، نمونه واگن‌ها، لینک مستربلیط).

برای پاک کردن dedupe و تست دوبارهٔ هشدار:

```text
cron.php?key=رمز&reset=1
```

(فقط state را پاک می‌کند؛ برای ارسال دوباره بعدش یک بار بدون reset اجرا کنید.)

### تست بله (بدون مستربلیط)

```text
cron.php?key=رمز&test_bale=1
```

خروجی JSON: `ok: true` یعنی پیام تست به بله رسید. اگر `اتصال به tapi.bale.ai ناموفق` دیدید، در `config.php` بگذارید `'bale_verify_ssl' => false` یا با هاستینگ دربارهٔ خروجی HTTPS به `tapi.bale.ai` صحبت کنید.

در `run.log` خط `BALE ERROR` حالا **دلیل دقیق** (HTTP و متن API بله) را نشان می‌دهد.
