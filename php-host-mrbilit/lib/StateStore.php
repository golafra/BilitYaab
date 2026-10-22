<?php

declare(strict_types=1);

final class StateStore
{
    private string $path;

    /** @var array<string, bool> */
    private array $wasAvailable = [];

    public function __construct(string $path)
    {
        $this->path = $path;
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        if (is_file($path)) {
            $json = file_get_contents($path);
            $data = json_decode($json ?: '{}', true);
            if (is_array($data) && isset($data['was_available']) && is_array($data['was_available'])) {
                foreach ($data['was_available'] as $k => $v) {
                    $this->wasAvailable[(string) $k] = (bool) $v;
                }
            }
        }
    }

    public function dedupeKey(array $offer, string $dateGregorian): string
    {
        $train = (string) ($offer['train_number'] ?? '');
        $wagon = (string) ($offer['wagon_name'] ?? '');
        return $train . '-' . $dateGregorian . '-' . $wagon;
    }

    /** آیا قبلاً برای این کلاس هشدار رفته و هنوز «باز» محسوب می‌شود */
    public function wasAlreadyNotified(string $key): bool
    {
        return ($this->wasAvailable[$key] ?? false) === true;
    }

    public function markAvailable(string $key): void
    {
        $this->wasAvailable[$key] = true;
    }

    /** وقتی در دور بعد ظرفیت نیست، دوباره قابل هشدار می‌شود */
    public function markUnavailableForDate(string $dateGregorian, array $seenKeys): void
    {
        $suffix = '-' . $dateGregorian . '-';
        foreach (array_keys($this->wasAvailable) as $key) {
            if (str_contains($key, $suffix) && !in_array($key, $seenKeys, true)) {
                $this->wasAvailable[$key] = false;
            }
        }
    }

    public function save(): void
    {
        $payload = json_encode(
            ['was_available' => $this->wasAvailable, 'updated_at' => gmdate('c')],
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
        file_put_contents($this->path, $payload, LOCK_EX);
    }
}
