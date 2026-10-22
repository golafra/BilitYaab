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

    // تاریخ حرکت میلادی (Y-m-d) — می‌توانید چند تاریخ بدهید
    'departure_dates' => [
        '2026-11-15',
    ],

    // حداقل صندلی خالی برای ارسال هشدار
    'min_seats' => 1,

    // سهمیه: general | men | women | car
    'quota' => 'general',

    // بله — از @BaleBot توکن و chat_id عددی
    'bale_token' => '',
    'bale_chat_id' => '',

    /**
     * اگر cron از مرورگر/URL فراخوانی می‌شود، یک رمز طولانی بگذارید:
     * https://دامنه/sh/php-host-mrbilit/cron.php?key=رمز
     * برای cron واقعی cPanel (CLI) خالی بماند.
     */
    'cron_secret' => '',

    // مسیر ذخیره وضعیت (نسبت به این پوشه)
    'state_file' => __DIR__ . '/data/state.json',
];
