<?php
/**
 * کپی این فایل به config.php و مقادیر را پر کنید.
 * config.php را در گیت commit نکنید (شامل توکن بله است).
 */
return [
    // ایستگاه‌ها — تهران=۱، مشهد=۱۹۱
    'origin_station_id' => 1,
    'destination_station_id' => 191,
    'route_slug' => 'tehran-mashhad',

    // تاریخ حرکت میلادی (Y-m-d) — نه شمسی! مثلاً 2026-10-30 (معادل 1405/08/08)
    'departure_dates' => [
        '2026-10-30',
    ],

    // حداقل صندلی خالی برای ارسال هشدار
    'min_seats' => 1,

    // حداکثر قیمت هر بلیت (تومان) — ۰ یعنی بدون سقف
    'max_price_toman' => 0,

    // سهمیه: general | men | women | car
    'quota' => 'general',

    // بله — توکن ربات (بدون پیشوند bot) و chat_id کاربر (از getUpdates بعد از /start؛ نه آیدی ربات)
    'bale_token' => '',
    'bale_chat_id' => '',

    // اگر خطای SSL/اتصال به tapi.bale.ai دارید، false کنید (هاست‌های ایرانی گاهاً CA ندارند)
    // روی هاست 208.ir اگر ارسال نشد، true بماند؛ در صورت خطای SSL امتحان کنید false
    'bale_verify_ssl' => true,

    /**
     * اگر cron از مرورگر/URL فراخوانی می‌شود، یک رمز طولانی بگذارید:
     * https://دامنه/sh/php-host-mrbilit/cron.php?key=رمز
     * برای cron واقعی cPanel (CLI) خالی بماند.
     */
    'cron_secret' => '',

    // مسیر ذخیره وضعیت (نسبت به این پوشه)
    'state_file' => __DIR__ . '/data/state.json',
];
