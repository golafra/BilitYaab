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

require_once __DIR__ . '/lib/MrBilitClient.php';
require_once __DIR__ . '/lib/BaleNotifier.php';
require_once __DIR__ . '/lib/StateStore.php';

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
$quota = (string) ($config['quota'] ?? 'general');
$dates = $config['departure_dates'] ?? [];
if (!is_array($dates) || count($dates) === 0) {
    monitor_log($logFile, 'ERROR: departure_dates empty');
    exit(1);
}

$state = new StateStore((string) ($config['state_file'] ?? __DIR__ . '/data/state.json'));
$disableCache = (time() % 240) < 60;

$alerts = 0;
foreach ($dates as $dateGregorian) {
    $dateGregorian = trim((string) $dateGregorian);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateGregorian)) {
        monitor_log($logFile, "SKIP invalid date: $dateGregorian");
        continue;
    }

    $result = MrBilitClient::fetchAvailability(
        $fromId,
        $toId,
        $dateGregorian,
        $routeSlug,
        $quota,
        $disableCache
    );

    if (!$result['ok']) {
        monitor_log($logFile, "[$dateGregorian] " . $result['message']);
        continue;
    }

    $seenKeys = [];
    foreach ($result['offers'] as $offer) {
        if ((int) $offer['capacity'] < $minSeats) {
            continue;
        }
        $key = $state->dedupeKey($offer, $dateGregorian);
        $seenKeys[] = $key;
        if ($state->wasAlreadyNotified($key)) {
            continue;
        }

        $msg = BaleNotifier::formatTrainMessage($offer);
        $sent = BaleNotifier::send(
            (string) ($config['bale_token'] ?? ''),
            (string) ($config['bale_chat_id'] ?? ''),
            $msg
        );
        if ($sent['ok']) {
            $state->markAvailable($key);
            $alerts++;
            monitor_log($logFile, "ALERT [$dateGregorian] train {$offer['train_number']} {$offer['wagon_name']}");
        } else {
            monitor_log($logFile, 'BALE ERROR: ' . $sent['message']);
        }
    }

    $state->markUnavailableForDate($dateGregorian, $seenKeys);
}

$state->save();
monitor_log($logFile, 'OK offers checked, alerts=' . $alerts);

if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "done alerts=$alerts\n";
}
