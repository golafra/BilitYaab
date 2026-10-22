<?php

declare(strict_types=1);

require_once __DIR__ . '/polyfill.php';
require_once __DIR__ . '/Jalali.php';
require_once __DIR__ . '/HttpClient.php';

final class BaleNotifier
{
    /**
     * پیام بدون HTML — کلاینت بله تگ‌های HTML را اغلب خام نشان می‌دهد.
     *
     * @param array<string, mixed> $offer
     */
    public static function formatTrainMessage(array $offer): string
    {
        $dateGregorian = (string) ($offer['date_gregorian'] ?? '');
        $dateShamsi = format_jalali_fa($dateGregorian);
        $wagon = (string) ($offer['wagon_name'] ?? '');
        $comp = (string) ($offer['compartment_type'] ?? '');
        $wagonLine = $wagon . ($comp !== '' ? ' (' . $comp . ')' : '');
        $link = (string) ($offer['buy_link'] ?? '');
        $price = number_format((int) ($offer['price_toman'] ?? 0));

        return "🚆 ظرفیت قطار باز شد!\n\n"
            . '🏢 شرکت: ' . ($offer['company'] ?? '') . "\n"
            . '🔢 شماره قطار: ' . ($offer['train_number'] ?? '') . "\n"
            . "🛏 واگن: {$wagonLine}\n"
            . '⏰ حرکت: ' . ($offer['departure_time'] ?? '')
            . ' — رسیدن: ' . ($offer['arrival_time'] ?? '') . "\n"
            . "📅 تاریخ: {$dateShamsi} ({$dateGregorian})\n"
            . '💺 صندلی خالی: ' . (int) ($offer['capacity'] ?? 0) . "\n"
            . "💰 قیمت (تومان): {$price}\n\n"
            . "🔗 رزرو در مستربلیط:\n{$link}\n\n"
            . '🔔 پایش قطار (هاست PHP)';
    }

    /**
     * @return array{ok: bool, message: string, username?: string|null}
     */
    public static function getMe(string $token, bool $verifySsl = true): array
    {
        $token = self::normalizeToken($token);
        if ($token === '') {
            return ['ok' => false, 'message' => 'توکن خالی است'];
        }
        $url = 'https://tapi.bale.ai/bot' . $token . '/getMe';
        $res = HttpClient::get($url, ['Accept: application/json'], 20, $verifySsl);
        if ($res['body'] === false) {
            return ['ok' => false, 'message' => 'getMe اتصال ناموفق: ' . ($res['error'] ?? '')];
        }
        $data = json_decode($res['body'], true);
        if (is_array($data) && !empty($data['ok']) && is_array($data['result'] ?? null)) {
            $username = (string) ($data['result']['username'] ?? '');
            return [
                'ok' => true,
                'message' => 'توکن معتبر (@' . $username . ')',
                'username' => $username,
            ];
        }
        $desc = is_array($data) ? (string) ($data['description'] ?? 'نامعتبر') : substr((string) $res['body'], 0, 200);
        return [
            'ok' => false,
            'message' => 'getMe HTTP ' . $res['status'] . ': ' . $desc,
        ];
    }

    /**
     * @return array{ok: bool, message: string}
     */
    public static function sendTest(string $token, string $chatId, bool $verifySsl = true): array
    {
        return self::sendRaw($token, $chatId, '✅ تست ارسال از پایش قطار (هاست PHP)', $verifySsl);
    }

    /**
     * @return array{ok: bool, message: string}
     */
    public static function send(string $token, string $chatId, string $text, bool $verifySsl = true): array
    {
        return self::sendRaw($token, $chatId, $text, $verifySsl);
    }

    /**
     * @return array{ok: bool, message: string}
     */
    private static function sendRaw(string $token, string $chatId, string $text, bool $verifySsl): array
    {
        $token = self::normalizeToken($token);
        $chatId = trim($chatId);
        if ($token === '' || $chatId === '') {
            return ['ok' => false, 'message' => 'توکن یا chat_id بله تنظیم نشده'];
        }

        $url = 'https://tapi.bale.ai/bot' . $token . '/sendMessage';
        $payloadData = [
            'chat_id' => is_numeric($chatId) ? (int) $chatId : $chatId,
            'text' => $text,
        ];
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

    private static function normalizeToken(string $token): string
    {
        $token = trim($token);
        if ($token === '') {
            return '';
        }
        if (str_starts_with(strtolower($token), 'bot')) {
            $token = substr($token, 3);
        }
        return $token;
    }
}
