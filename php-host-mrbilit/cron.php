<?php

declare(strict_types=1);

/**
 * هر ۱ دقیقه از cron هاست فراخوانی شود.
 * cPanel: * * * * * /usr/bin/php /path/to/php-host-mrbilit/cron.php
 */

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    exit('config.php not found. Copy config.example.php to config.php');
}

/** @var array<string, mixed> $config */
$config = require $configPath;

$isCli = PHP_SAPI === 'cli';
$secret = (string) ($config['cron_secret'] ?? '');
if (!$isCli) {
    $key = isset($_GET['key']) ? (string) $_GET['key'] : '';
    if ($secret === '' || !hash_equals($secret, $key)) {
        http_response_code(403);
        exit('Forbidden');
    }
}

$debug = !$isCli && isset($_GET['debug']) && (string) $_GET['debug'] === '1';
$resetState = !$isCli && isset($_GET['reset']) && (string) $_GET['reset'] === '1';
$testBale = !$isCli && isset($_GET['test_bale']) && (string) $_GET['test_bale'] === '1';

require_once __DIR__ . '/lib/polyfill.php';
require_once __DIR__ . '/lib/MrBilitClient.php';
require_once __DIR__ . '/lib/BaleNotifier.php';
require_once __DIR__ . '/lib/StateStore.php';

$baleVerifySsl = !isset($config['bale_verify_ssl']) || $config['bale_verify_ssl'] !== false;

if ($testBale) {
    header('Content-Type: application/json; charset=utf-8');
    $token = (string) ($config['bale_token'] ?? '');
    $chatId = (string) ($config['bale_chat_id'] ?? '');
    $getMe = BaleNotifier::getMe($token, $baleVerifySsl);
    $send = ['ok' => false, 'message' => 'send رد شد چون getMe ناموفق بود'];
    if ($getMe['ok']) {
        $send = BaleNotifier::sendTest($token, $chatId, $baleVerifySsl);
        if (!$send['ok'] && $baleVerifySsl) {
            $sendRetry = BaleNotifier::sendTest($token, $chatId, false);
            $send['message'] .= ' | retry_ssl_off: ' . $sendRetry['message'];
            $send['ok'] = $sendRetry['ok'];
        }
    } elseif ($baleVerifySsl) {
        $getMeSslOff = BaleNotifier::getMe($token, false);
        if ($getMeSslOff['ok']) {
            $getMe = $getMeSslOff;
            $getMe['message'] .= ' (با bale_verify_ssl=false)';
            $send = BaleNotifier::sendTest($token, $chatId, false);
        }
    }
    echo json_encode(
        [
            'php_version' => PHP_VERSION,
            'curl_enabled' => function_exists('curl_init'),
            'chat_id_config' => $chatId,
            'getMe' => $getMe,
            'send_test' => $send,
            'hint_unauthorized' => 'اگر getMe HTTP 401 است، توکن را از پنل بله دوباره کپی کنید (بدون فاصله). سپس به همان ربات /start بزنید.',
            'hint_chat_id' => 'chat_id باید از getUpdates بعد از /start باشد، نه عدد اول توکن.',
        ],
        JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
    );
    exit;
}

$logFile = __DIR__ . '/data/run.log';
function monitor_log(string $logFile, string $line): void
{
    $dir = dirname($logFile);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    file_put_contents($logFile, gmdate('Y-m-d H:i:s') . ' UTC ' . $line . "\n", FILE_APPEND | LOCK_EX);
}

$fromId = (int) ($config['origin_station_id'] ?? 1);
$toId = (int) ($config['destination_station_id'] ?? 191);
$routeSlug = (string) ($config['route_slug'] ?? 'tehran-mashhad');
$minSeats = max(1, (int) ($config['min_seats'] ?? 1));
$maxPriceToman = max(0, (int) ($config['max_price_toman'] ?? 0));
$quota = (string) ($config['quota'] ?? 'general');
$dates = $config['departure_dates'] ?? [];
if (!is_array($dates) || count($dates) === 0) {
    monitor_log($logFile, 'ERROR: departure_dates empty');
    exit(1);
}

$statePath = (string) ($config['state_file'] ?? __DIR__ . '/data/state.json');
if ($resetState && is_file($statePath)) {
    unlink($statePath);
}

$state = new StateStore($statePath);

$alerts = 0;
$totalOffers = 0;
$skippedDedupe = 0;
$skippedMinSeats = 0;
$skippedMaxPrice = 0;
$baleBroken = false;
/** @var list<array<string, mixed>> $debugRows */
$debugRows = [];

foreach ($dates as $dateGregorian) {
    $dateGregorian = trim((string) $dateGregorian);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateGregorian)) {
        monitor_log($logFile, "SKIP invalid date: $dateGregorian");
        continue;
    }

    $jalaliHint = jalali_from_gregorian_string($dateGregorian);
    $result = MrBilitClient::fetchAvailability(
        $fromId,
        $toId,
        $dateGregorian,
        $routeSlug,
        $quota,
        true
    );

    if (!$result['ok']) {
        $line = "[$dateGregorian / $jalaliHint] " . $result['message'];
        monitor_log($logFile, $line);
        if ($debug) {
            $debugRows[] = [
                'date_gregorian' => $dateGregorian,
                'date_jalali' => $jalaliHint,
                'api_ok' => false,
                'message' => $result['message'],
                'http_status' => $result['http_status'] ?? null,
            ];
        }
        continue;
    }

    $offerCount = count($result['offers']);
    $totalOffers += $offerCount;
    monitor_log(
        $logFile,
        "[$dateGregorian / $jalaliHint] {$result['message']} (min_seats=$minSeats, max_price_toman=$maxPriceToman)"
    );

    $seenKeys = [];
    foreach ($result['offers'] as $offer) {
        if ((int) $offer['capacity'] < $minSeats) {
            $skippedMinSeats++;
            continue;
        }
        $priceToman = (int) ($offer['price_toman'] ?? 0);
        if ($maxPriceToman > 0 && ($priceToman <= 0 || $priceToman > $maxPriceToman)) {
            $skippedMaxPrice++;
            continue;
        }
        $key = $state->dedupeKey($offer, $dateGregorian);
        $seenKeys[] = $key;
        if ($state->wasAlreadyNotified($key)) {
            $skippedDedupe++;
            continue;
        }

        if ($baleBroken) {
            continue;
        }

        $msg = BaleNotifier::formatTrainMessage($offer);
        $sent = BaleNotifier::send(
            (string) ($config['bale_token'] ?? ''),
            (string) ($config['bale_chat_id'] ?? ''),
            $msg,
            $baleVerifySsl
        );
        if ($sent['ok']) {
            $state->markAvailable($key);
            $alerts++;
            monitor_log($logFile, "ALERT [$dateGregorian] train {$offer['train_number']} {$offer['wagon_name']}");
        } else {
            $baleBroken = true;
            monitor_log($logFile, 'BALE ERROR: ' . $sent['message']);
        }
    }

    $state->markUnavailableForDate($dateGregorian, $seenKeys);

    if ($debug) {
        $debugRows[] = [
            'date_gregorian' => $dateGregorian,
            'date_jalali' => $jalaliHint,
            'api_ok' => true,
            'train_rows' => $result['train_rows'] ?? null,
            'bookable_offers' => $offerCount,
            'mrbilit_link' => MrBilitClient::buildTrainUrl($routeSlug, $dateGregorian),
            'sample_offers' => array_slice($result['offers'], 0, 3),
        ];
    }
}

$state->save();
monitor_log(
    $logFile,
    "OK offers=$totalOffers alerts=$alerts dedupe_skipped=$skippedDedupe min_seats_skipped=$skippedMinSeats max_price_skipped=$skippedMaxPrice"
);

if ($debug) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        [
            'offers' => $totalOffers,
            'alerts' => $alerts,
            'dedupe_skipped' => $skippedDedupe,
            'min_seats_skipped' => $skippedMinSeats,
            'max_price_skipped' => $skippedMaxPrice,
            'max_price_toman' => $maxPriceToman,
            'hint' => 'تاریخ در config باید میلادی Y-m-d باشد (مثلاً 2026-10-30 نه 1405-08-08).',
            'dates' => $debugRows,
        ],
        JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
    );
    exit;
}

if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "done offers=$totalOffers alerts=$alerts dedupe_skipped=$skippedDedupe max_price_skipped=$skippedMaxPrice\n";
    if ($totalOffers === 0) {
        echo "tip: برای جزئیات ?debug=1 همان key را بزنید؛ لاگ: data/run.log\n";
    }
}
