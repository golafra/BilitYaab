<?php

declare(strict_types=1);

require_once __DIR__ . '/Jalali.php';
require_once __DIR__ . '/HttpClient.php';

final class MrBilitClient
{
    private const API_BASE = 'https://train.mrbilit.com';

    /** @var array<string, int> */
    private const QUOTA_CODES = [
        'general' => 3,
        'men' => 1,
        'women' => 2,
        'car' => 4,
    ];

    /**
     * @return array{
     *   ok: bool,
     *   message: string,
     *   offers: list<array<string, mixed>>,
     *   http_status?: int,
     *   train_rows?: int,
     *   api_error?: string|null
     * }
     */
    public static function fetchAvailability(
        int $fromId,
        int $toId,
        string $dateGregorian,
        string $routeSlug,
        string $quota = 'general',
        bool $disableCache = true
    ): array {
        $gender = self::QUOTA_CODES[$quota] ?? self::QUOTA_CODES['general'];
        $query = http_build_query([
            'from' => $fromId,
            'to' => $toId,
            'date' => $dateGregorian,
            'genderCode' => $gender,
            'adultCount' => 1,
            'childCount' => 0,
            'infantCount' => 0,
            'exclusive' => 'false',
            'availableStatus' => 'Both',
            'disableCache' => $disableCache ? 'true' : 'false',
        ]);

        $url = self::API_BASE . '/api/GetAvailable/v2?' . $query;
        $headers = [
            'Accept: application/json, text/plain, */*',
            'Accept-Language: fa-IR,fa;q=0.9',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Origin: https://mrbilit.com',
            'Referer: https://mrbilit.com/',
        ];

        $res = HttpClient::get($url, $headers);
        $status = $res['status'];
        $raw = $res['body'];

        if ($raw === false) {
            return [
                'ok' => false,
                'message' => 'خطا در اتصال به مستربلیط' . ($res['error'] ? ' (' . $res['error'] . ')' : ''),
                'offers' => [],
                'http_status' => $status,
            ];
        }

        $body = json_decode($raw, true);
        if (!is_array($body)) {
            return [
                'ok' => false,
                'message' => 'JSON نامعتبر از مستربلیط',
                'offers' => [],
                'http_status' => $status,
            ];
        }

        $apiError = isset($body['Error']) ? (string) $body['Error'] : null;
        if ($apiError !== null && $apiError !== '') {
            return [
                'ok' => false,
                'message' => 'مستربلیط: ' . $apiError,
                'offers' => [],
                'http_status' => $status,
                'api_error' => $apiError,
                'train_rows' => 0,
            ];
        }

        if ($status === 403 || $status === 429) {
            return [
                'ok' => false,
                'message' => "محدودیت دسترسی ($status)",
                'offers' => [],
                'http_status' => $status,
            ];
        }
        if ($status !== 200) {
            return [
                'ok' => false,
                'message' => "پاسخ HTTP $status",
                'offers' => [],
                'http_status' => $status,
            ];
        }

        $buyLink = self::buildTrainUrl($routeSlug, $dateGregorian);
        $offers = [];
        $trains = $body['trains'] ?? [];
        if (!is_array($trains)) {
            $trains = [];
        }

        foreach ($trains as $train) {
            if (!is_array($train)) {
                continue;
            }
            $trainNumber = $train['trainNumber'] ?? '?';
            $company = (string) ($train['corporationName'] ?? $train['providerName'] ?? 'قطار');
            $departureTime = self::formatTime($train['departureTime'] ?? null);
            $arrivalTime = self::formatTime($train['arrivalTime'] ?? null);
            $originName = (string) ($train['fromName'] ?? '');
            $destName = (string) ($train['toName'] ?? '');
            $prices = $train['prices'] ?? [];
            if (!is_array($prices)) {
                continue;
            }
            foreach ($prices as $priceGroup) {
                if (!is_array($priceGroup)) {
                    continue;
                }
                $classes = $priceGroup['classes'] ?? [];
                if (!is_array($classes)) {
                    continue;
                }
                foreach ($classes as $c) {
                    if (!is_array($c)) {
                        continue;
                    }
                    if (!self::isClassBookable($c)) {
                        continue;
                    }
                    $capacity = (int) ($c['capacity'] ?? 0);
                    $priceRaw = (int) ($c['price'] ?? 0);
                    $offers[] = [
                        'train_number' => $trainNumber,
                        'company' => $company,
                        'wagon_name' => trim((string) ($c['wagonName'] ?? $c['shortTitle'] ?? '')),
                        'compartment_type' => (string) ($c['compartmentType'] ?? ''),
                        'departure_time' => $departureTime,
                        'arrival_time' => $arrivalTime,
                        'date_gregorian' => $dateGregorian,
                        'origin_name' => $originName,
                        'destination_name' => $destName,
                        'capacity' => $capacity,
                        'price_toman' => (int) round($priceRaw / 10),
                        'buy_link' => $buyLink,
                    ];
                }
            }
        }

        return [
            'ok' => true,
            'message' => count($offers) . ' کلاس باز (از ' . count($trains) . ' قطار در پاسخ API)',
            'offers' => $offers,
            'http_status' => 200,
            'train_rows' => count($trains),
            'api_error' => null,
        ];
    }

    /**
     * همان منطق فرانت مستربلیط: isAvailable + price؛ ظرفیت صفر را رد می‌کنیم.
     *
     * @param array<string, mixed> $c
     */
    private static function isClassBookable(array $c): bool
    {
        $priceRaw = (int) ($c['price'] ?? 0);
        if ($priceRaw <= 0) {
            return false;
        }
        $available = $c['isAvailable'] ?? null;
        if ($available === false || $available === 0 || $available === '0' || $available === 'false') {
            return false;
        }
        if ($available === true || $available === 1 || $available === '1' || $available === 'true') {
            $capacity = (int) ($c['capacity'] ?? 0);
            return $capacity > 0;
        }
        // اگر isAvailable نیامده ولی قیمت و ظرفیت هست
        $capacity = (int) ($c['capacity'] ?? 0);
        return $capacity > 0;
    }

    public static function buildTrainUrl(string $routeSlug, string $dateGregorian): string
    {
        $jalali = jalali_from_gregorian_string($dateGregorian);
        return 'https://mrbilit.com/trains/' . rawurlencode($routeSlug) . '?departureDate=' . rawurlencode($jalali);
    }

    private static function formatTime(?string $iso): string
    {
        if ($iso === null || $iso === '') {
            return 'نامعلوم';
        }
        if (preg_match('/T(\d{2}:\d{2})/', $iso, $m)) {
            return $m[1];
        }
        return substr($iso, 11, 5) ?: $iso;
    }
}
