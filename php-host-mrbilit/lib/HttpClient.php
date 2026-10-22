<?php

declare(strict_types=1);

final class HttpClient
{
    /**
     * @param list<string> $headers "Name: value"
     * @return array{status: int, body: string|false, error: string|null}
     */
    public static function get(string $url, array $headers = [], int $timeout = 25, bool $verifySsl = true): array
    {
        return self::request('GET', $url, null, $headers, $timeout, $verifySsl);
    }

    /**
     * @param list<string> $headers "Name: value"
     * @return array{status: int, body: string|false, error: string|null}
     */
    public static function post(
        string $url,
        string $body,
        array $headers = [],
        int $timeout = 25,
        bool $verifySsl = true
    ): array {
        return self::request('POST', $url, $body, $headers, $timeout, $verifySsl);
    }

    /**
     * @param list<string> $headers
     * @return array{status: int, body: string|false, error: string|null}
     */
    private static function request(
        string $method,
        string $url,
        ?string $body,
        array $headers,
        int $timeout,
        bool $verifySsl
    ): array {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return ['status' => 0, 'body' => false, 'error' => 'curl_init failed'];
            }
            $opts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_SSL_VERIFYPEER => $verifySsl,
                CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
                CURLOPT_ENCODING => '',
            ];
            if ($method === 'POST') {
                $opts[CURLOPT_POST] = true;
                $opts[CURLOPT_POSTFIELDS] = $body ?? '';
            }
            curl_setopt_array($ch, $opts);
            $responseBody = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if ($responseBody === false) {
                return ['status' => $status, 'body' => false, 'error' => $err !== '' ? $err : 'curl_exec failed'];
            }
            return ['status' => $status, 'body' => $responseBody, 'error' => null];
        }

        $headerLines = $headers;
        if ($method === 'POST' && $body !== null) {
            $headerLines[] = 'Content-Length: ' . strlen($body);
        }
        $ctx = stream_context_create([
            'http' => [
                'method' => $method,
                'timeout' => $timeout,
                'header' => implode("\r\n", $headerLines),
                'content' => $method === 'POST' ? ($body ?? '') : null,
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => $verifySsl,
                'verify_peer_name' => $verifySsl,
            ],
        ]);
        $responseBody = @file_get_contents($url, false, $ctx);
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }
        if ($responseBody === false) {
            return [
                'status' => $status,
                'body' => false,
                'error' => 'file_get_contents failed (curl غیرفعال است؟ allow_url_fopen؟)',
            ];
        }
        return ['status' => $status, 'body' => $responseBody, 'error' => null];
    }
}
