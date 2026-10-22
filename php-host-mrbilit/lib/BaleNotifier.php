<?php

declare(strict_types=1);

require_once __DIR__ . '/Jalali.php';
require_once __DIR__ . '/HttpClient.php';

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

    public static function formatTrainMessagePlain(array $offer): string
    {
        $dateGregorian = (string) ($offer['date_gregorian'] ?? '');
        $dateShamsi = format_jalali_fa($dateGregorian);
        return "ظرفیت قطار باز شد\n"
            . 'شرکت: ' . ($offer['company'] ?? '') . "\n"
            . 'قطار: ' . ($offer['train_number'] ?? '') . "\n"
            . 'واگن: ' . ($offer['wagon_name'] ?? '') . "\n"
            . "تاریخ: {$dateShamsi}\n"
            . 'صندلی: ' . (int) ($offer['capacity'] ?? 0) . "\n"
            . 'قیمت تومان: ' . (int) ($offer['price_toman'] ?? 0) . "\n"
            . ($offer['buy_link'] ?? '');
    }

    /**
     * @return array{ok: bool, message: string}
     */
    public static function sendTest(string $token, string $chatId, bool $verifySsl = true): array
    {
        return self::sendRaw($token, $chatId, '✅ تست ارسال از پایش قطار (هاست PHP)', null, $verifySsl);
    }

    /**
     * @param array<string, mixed>|null $offer برای fallback متن ساده
     * @return array{ok: bool, message: string}
     */
    public static function send(
        string $token,
        string $chatId,
        string $text,
        ?array $offer = null,
        bool $verifySsl = true
    ): array {
        $result = self::sendRaw($token, $chatId, $text, 'HTML', $verifySsl);
        if ($result['ok']) {
            return $result;
        }
        if ($offer !== null) {
            $plain = self::formatTrainMessagePlain($offer);
            $fallback = self::sendRaw($token, $chatId, $plain, null, $verifySsl);
            if ($fallback['ok']) {
                return ['ok' => true, 'message' => 'ارسال شد (متن ساده، بدون HTML)'];
            }
            return [
                'ok' => false,
                'message' => $result['message'] . ' | fallback: ' . $fallback['message'],
            ];
        }
        return $result;
    }

    /**
     * @return array{ok: bool, message: string}
     */
    private static function sendRaw(
        string $token,
        string $chatId,
        string $text,
        ?string $parseMode,
        bool $verifySsl
    ): array {
        $token = trim($token);
        $chatId = trim($chatId);
        if ($token === '' || $chatId === '') {
            return ['ok' => false, 'message' => 'توکن یا chat_id بله تنظیم نشده'];
        }
        if (str_starts_with(strtolower($token), 'bot')) {
            $token = substr($token, 3);
        }

        $url = 'https://tapi.bale.ai/bot' . $token . '/sendMessage';
        $payloadData = [
            'chat_id' => is_numeric($chatId) ? (int) $chatId : $chatId,
            'text' => $text,
        ];
        if ($parseMode !== null && $parseMode !== '') {
            $payloadData['parse_mode'] = $parseMode;
        }
        $payload = json_encode($payloadData, JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return ['ok' => false, 'message' => 'خطا در ساخت JSON پیام'];
        }

        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
        ];
        $res = HttpClient::post($url, $payload, $headers, 25, $verifySsl);

        if ($res['body'] === false) {
            $hint = $res['error'] ?? 'بدون جزئیات';
            if (!$verifySsl) {
                return ['ok' => false, 'message' => "اتصال به tapi.bale.ai ناموفق: {$hint}"];
            }
            return [
                'ok' => false,
                'message' => "اتصال به tapi.bale.ai ناموفق: {$hint} (اگر SSL است، bale_verify_ssl را false کنید)",
            ];
        }

        $raw = $res['body'];
        $data = json_decode($raw, true);
        if (is_array($data) && !empty($data['ok'])) {
            return ['ok' => true, 'message' => 'ارسال شد'];
        }

        $desc = '';
        if (is_array($data)) {
            $desc = (string) ($data['description'] ?? $data['error'] ?? $data['message'] ?? '');
        }
        if ($desc === '') {
            $desc = substr($raw, 0, 300);
        }

        return [
            'ok' => false,
            'message' => 'بله HTTP ' . $res['status'] . ': ' . $desc,
        ];
    }
}
