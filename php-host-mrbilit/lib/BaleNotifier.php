<?php

declare(strict_types=1);

require_once __DIR__ . '/Jalali.php';

final class BaleNotifier
{
    /**
     * @param array<string, mixed> $offer
     */
    public static function formatTrainMessage(array $offer): string
    {
        $dateGregorian = (string) ($offer['date_gregorian'] ?? '');
        $dateShamsi = format_jalali_fa($dateGregorian);
        $wagon = htmlspecialchars((string) ($offer['wagon_name'] ?? ''), ENT_QUOTES, 'UTF-8');
        $comp = (string) ($offer['compartment_type'] ?? '');
        $wagonLine = $wagon . ($comp !== '' ? ' (' . htmlspecialchars($comp, ENT_QUOTES, 'UTF-8') . ')' : '');
        $link = htmlspecialchars((string) ($offer['buy_link'] ?? ''), ENT_QUOTES, 'UTF-8');
        $price = number_format((int) ($offer['price_toman'] ?? 0));

        return "🚆 <b>ظرفیت قطار باز شد!</b>\n\n"
            . '🏢 <b>شرکت:</b> ' . htmlspecialchars((string) ($offer['company'] ?? ''), ENT_QUOTES, 'UTF-8') . "\n"
            . '🔢 <b>شماره قطار:</b> ' . htmlspecialchars((string) ($offer['train_number'] ?? ''), ENT_QUOTES, 'UTF-8') . "\n"
            . "🛏 <b>واگن:</b> {$wagonLine}\n"
            . '⏰ <b>حرکت:</b> ' . htmlspecialchars((string) ($offer['departure_time'] ?? ''), ENT_QUOTES, 'UTF-8')
            . ' — <b>رسیدن:</b> ' . htmlspecialchars((string) ($offer['arrival_time'] ?? ''), ENT_QUOTES, 'UTF-8') . "\n"
            . "📅 <b>تاریخ:</b> {$dateShamsi} ({$dateGregorian})\n"
            . '💺 <b>صندلی خالی:</b> ' . (int) ($offer['capacity'] ?? 0) . "\n"
            . "💰 <b>قیمت (تومان):</b> {$price}\n\n"
            . "🔗 <a href=\"{$link}\">رزرو در مستربلیط</a>\n\n"
            . '🔔 <i>پایش قطار (هاست PHP)</i>';
    }

    /**
     * @return array{ok: bool, message: string}
     */
    public static function send(string $token, string $chatId, string $text): array
    {
        if ($token === '' || $chatId === '') {
            return ['ok' => false, 'message' => 'توکن یا chat_id بله تنظیم نشده'];
        }

        $url = 'https://tapi.bale.ai/bot' . $token . '/sendMessage';
        $payload = json_encode([
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => 'HTML',
        ], JSON_UNESCAPED_UNICODE);

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $payload,
                'timeout' => 20,
            ],
        ]);

        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            return ['ok' => false, 'message' => 'خطا در ارسال به بله'];
        }
        $data = json_decode($raw, true);
        if (is_array($data) && !empty($data['ok'])) {
            return ['ok' => true, 'message' => 'ارسال شد'];
        }

        return ['ok' => false, 'message' => 'پاسخ بله: ' . substr($raw, 0, 200)];
    }
}
