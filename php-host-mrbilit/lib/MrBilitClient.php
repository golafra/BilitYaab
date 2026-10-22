<?php

declare(strict_types=1);

require_once __DIR__ . '/Jalali.php';

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
     * @return array{ok: bool, message: string, offers: list<array<string, mixed>>}
     */
    public static function fetchAvailability(
        int $fromId,
        int $toId,
        string $dateGregorian,
        string $routeSlug,
        string $quota = 'general',
        bool $disableCache = false
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
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 25,
                'header' => implode("\r\n", [
                    'Accept: application/json, text/plain, */*',
                    'Accept-Language: fa-IR,fa;q=0.9',
                    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Origin: https://mrbilit.com',
                    'Referer: https://mrbilit.com/',
                ]),
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $ctx);
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('/\d{3}/', $http_response_header[0], $m)) {
            $status = (int) $m[0];
        }

        if ($raw === false) {
            return ['ok' => false, 'message' => 'خطا در اتصال به مستربلیط', 'offers' => []];
        }
        if ($status === 403 || $status === 429) {
            return ['ok' => false, 'message' => "محدودیت دسترسی ($status)", 'offers' => []];
        }
        if ($status !== 200) {
            return ['ok' => false, 'message' => "پاسخ HTTP $status", 'offers' => []];
        }

        $body = json_decode($raw, true);
        if (!is_array($body)) {
            return ['ok' => false, 'message' => 'JSON نامعتبر', 'offers' => []];
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
                    $capacity = (int) ($c['capacity'] ?? 0);
                    $priceRaw = (int) ($c['price'] ?? 0);
                    $bookable = !empty($c['isAvailable']) && $priceRaw > 0 && $capacity > 0;
                    if (!$bookable) {
                        continue;
                    }
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
            'message' => count($offers) . ' کلاس باز',
            'offers' => $offers,
        ];
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
