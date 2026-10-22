<?php

declare(strict_types=1);

function gregorian_to_jalali(int $g_y, int $g_m, int $g_d): array
{
    $g_days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    $j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

    $gy = $g_y - 1600;
    $gm = $g_m - 1;
    $gd = $g_d - 1;

    $g_day_no = 365 * $gy + intdiv($gy + 3, 4) - intdiv($gy + 99, 100) + intdiv($gy + 399, 400);
    for ($i = 0; $i < $gm; ++$i) {
        $g_day_no += $g_days_in_month[$i];
    }
    if ($gm > 1 && (($gy % 4 === 0 && $gy % 100 !== 0) || $gy % 400 === 0)) {
        $g_day_no++;
    }
    $g_day_no += $gd;

    $j_day_no = $g_day_no - 79;
    $j_np = intdiv($j_day_no, 12053);
    $j_day_no %= 12053;
    $jy = 979 + 33 * $j_np + 4 * intdiv($j_day_no, 1461);
    $j_day_no %= 1461;
    if ($j_day_no >= 366) {
        $jy += intdiv($j_day_no - 1, 365);
        $j_day_no = ($j_day_no - 1) % 365;
    }
    for ($i = 0; $i < 11 && $j_day_no >= $j_days_in_month[$i]; ++$i) {
        $j_day_no -= $j_days_in_month[$i];
    }
    $jm = $i + 1;
    $jd = $j_day_no + 1;

    return [$jy, $jm, $jd];
}

function jalali_from_gregorian_string(string $dateStr): string
{
    $parts = explode('-', $dateStr);
    if (count($parts) !== 3) {
        return '';
    }
    [$y, $m, $d] = array_map('intval', $parts);
    [$jy, $jm, $jd] = gregorian_to_jalali($y, $m, $d);
    return sprintf('%d-%02d-%02d', $jy, $jm, $jd);
}

function format_jalali_fa(string $dateStr): string
{
    $j = jalali_from_gregorian_string($dateStr);
    return $j !== '' ? str_replace('-', '/', $j) : $dateStr;
}
