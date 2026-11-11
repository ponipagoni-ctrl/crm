<?php
/*
 * Приём заявки «Получить КП для компании» с калькулятора (dedmoroz96.ru).
 *
 * Где что лежит на хостинге (LITE.HOST, сервер в России):
 *   www/dedmoroz96.ru/kp.php        — этот файл (выкладывается из calculator/)
 *   private/kp-leads.csv            — заявки (вне папки сайта, из браузера недоступно)
 *   private/kp-config.php           — токен Telegram-бота (пишет GitHub Actions из секрета)
 *   private/kp-chat.txt             — chat_id Владислава (определяется сам, см. tg_chat())
 *
 * В Telegram уходит только уведомление БЕЗ имени и телефона + ссылка на
 * закрытую страницу kp-leads.php на этом же хостинге — так персональные
 * данные не покидают сервер в России.
 */
declare(strict_types=1);
date_default_timezone_set('Asia/Yekaterinburg');

const ALLOWED_ORIGINS = ['https://dedmoroz96.ru', 'https://www.dedmoroz96.ru', 'https://ponipagoni-ctrl.github.io'];
const OWNER_TG_USERNAME = 'marsssellin'; // чей чат с ботом считать «своим»
const RATE_PER_HOUR = 5;

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { out(405, ['ok' => false]); }

function out(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function clean($v, int $max): string {
    $v = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v) ?? '';
    return mb_substr(trim($v), 0, $max);
}
function private_dir(): string {
    $dir = dirname(__DIR__, 2) . '/private';
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
    return $dir;
}
function config(): array {
    $f = private_dir() . '/kp-config.php';
    $c = is_file($f) ? include $f : [];
    return is_array($c) ? $c : [];
}
function tg(string $token, string $method, array $params): ?array {
    $ch = curl_init("https://api.telegram.org/bot{$token}/{$method}");
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($params),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    $j = is_string($res) ? json_decode($res, true) : null;
    return is_array($j) ? $j : null;
}
/* chat_id Владислава: берём из кэша, иначе ищем в последних сообщениях боту
   от аккаунта @marsssellin (ему достаточно один раз нажать /start). */
function tg_chat(string $token): string {
    $cache = private_dir() . '/kp-chat.txt';
    $id = is_file($cache) ? trim((string)file_get_contents($cache)) : '';
    if ($id !== '') { return $id; }
    $upd = tg($token, 'getUpdates', ['limit' => 100]);
    foreach (array_reverse($upd['result'] ?? []) as $u) {
        $m = $u['message'] ?? null;
        if ($m && strcasecmp((string)($m['from']['username'] ?? ''), OWNER_TG_USERNAME) === 0
            && ($m['chat']['type'] ?? '') === 'private') {
            $id = (string)$m['chat']['id'];
            file_put_contents($cache, $id, LOCK_EX);
            return $id;
        }
    }
    return '';
}

$in = json_decode((string)file_get_contents('php://input', false, null, 0, 4000), true);
if (!is_array($in)) { out(400, ['ok' => false, 'error' => 'bad_request']); }
if (!empty($in['website'])) { out(200, ['ok' => true]); } // ловушка для ботов

$name    = clean($in['name'] ?? '', 60);
$phone   = clean($in['phone'] ?? '', 30);
$company = clean($in['company'] ?? '', 100);
$digits  = preg_replace('/\D+/', '', $phone) ?? '';
if ($name === '' || strlen($digits) < 10 || strlen($digits) > 15) { out(422, ['ok' => false, 'error' => 'invalid']); }
if (($in['consent'] ?? false) !== true) { out(422, ['ok' => false, 'error' => 'consent']); }

$fmt    = clean($in['fmt'] ?? '', 10);
$pair   = clean($in['pair'] ?? '', 10);
$period = clean($in['period'] ?? '', 10);
$total  = max(0, min(1000000, (int)($in['total'] ?? 0)));
$from   = clean($in['from'] ?? '', 30);
$test   = !empty($in['test']);

$dir = private_dir();

// не больше RATE_PER_HOUR заявок в час с одного адреса (храним только хэш)
$rateFile = $dir . '/kp-rate.json';
$key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . date('Y-m-d-H'));
$fp = fopen($rateFile, 'c+');
if ($fp) {
    flock($fp, LOCK_EX);
    $rate = json_decode((string)stream_get_contents($fp), true) ?: [];
    $hour = date('Y-m-d-H');
    $rate = array_filter($rate, fn($v) => ($v['h'] ?? '') === $hour);
    $n = ($rate[$key]['n'] ?? 0) + 1;
    $rate[$key] = ['h' => $hour, 'n' => $n];
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($rate));
    flock($fp, LOCK_UN); fclose($fp);
    if ($n > RATE_PER_HOUR) { out(429, ['ok' => false, 'error' => 'rate']); }
}

// сохраняем заявку
$id = date('ymd-His') . '-' . bin2hex(random_bytes(2));
$csv = $dir . '/kp-leads.csv';
$isNew = !is_file($csv);
$fp = fopen($csv, 'a');
if (!$fp) { out(500, ['ok' => false, 'error' => 'storage']); }
flock($fp, LOCK_EX);
if ($isNew) { fputcsv($fp, ['время', 'id', 'имя', 'телефон', 'компания', 'формат', 'пара', 'период', 'сумма', 'источник', 'тест']); }
fputcsv($fp, [date('c'), $id, $name, $phone, $company, $fmt, $pair, $period, $total, $from, $test ? 'да' : '']);
flock($fp, LOCK_UN); fclose($fp);
@chmod($csv, 0600);

// уведомление в Telegram — без персональных данных
$cfg = config();
$token = (string)($cfg['tg_token'] ?? '');
$notified = false;
if ($token !== '') {
    $chat = tg_chat($token);
    if ($chat !== '') {
        $fmtName = ['corp' => 'Корпоратив', 'mass' => 'Массовый праздник / ёлка', 'home' => 'На дом'][$fmt] ?? 'не выбран';
        $perName = ['t2' => '1–27 декабря', 't3' => '28–30 декабря', 'd31' => '31 декабря', 'jan' => '1–10 января'][$period] ?? 'дата не выбрана';
        $text = ($test ? "🧪 ТЕСТ\n" : '') . "🎅 Новая заявка на КП\n"
              . "Формат: {$fmtName} · {$perName}" . ($total ? ' · ~' . number_format($total, 0, '', ' ') . ' ₽' : '') . "\n"
              . 'Источник: ' . ($from !== '' ? $from : 'не указан') . "\n\n"
              . 'Контакты: https://dedmoroz96.ru/kp-leads.php?k=' . urlencode((string)($cfg['view_key'] ?? ''));
        $r = tg($token, 'sendMessage', ['chat_id' => $chat, 'text' => $text, 'disable_web_page_preview' => 'true']);
        $notified = (bool)($r['ok'] ?? false);
    }
}

out(200, ['ok' => true, 'id' => $id, 'notified' => $notified]);
