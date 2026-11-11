<?php
/*
 * Закрытая страница с заявками «Получить КП» (только для Владислава).
 * Открывается по ссылке из Telegram-уведомления: kp-leads.php?k=<ключ>.
 * Ключ лежит в private/kp-config.php на хостинге (его пишет GitHub Actions).
 */
declare(strict_types=1);
date_default_timezone_set('Asia/Yekaterinburg');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('Content-Type: text/html; charset=utf-8');

$dir = dirname(__DIR__, 2) . '/private';
$cfgFile = $dir . '/kp-config.php';
$cfg = is_file($cfgFile) ? include $cfgFile : [];
$key = (string)(is_array($cfg) ? ($cfg['view_key'] ?? '') : '');
if ($key === '' || !hash_equals($key, (string)($_GET['k'] ?? ''))) {
    http_response_code(404);
    echo 'Not found';
    exit;
}

$rows = [];
$csv = $dir . '/kp-leads.csv';
if (is_file($csv) && ($fp = fopen($csv, 'r'))) {
    $head = fgetcsv($fp);
    while (($r = fgetcsv($fp)) !== false) { $rows[] = $r; }
    fclose($fp);
}
$rows = array_slice(array_reverse($rows), 0, 200);
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$fmtName = ['corp' => 'Корпоратив', 'mass' => 'Массовый / ёлка', 'home' => 'На дом'];
$perName = ['t2' => '1–27 дек', 't3' => '28–30 дек', 'd31' => '31 дек', 'jan' => '1–10 янв'];
?><!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Заявки на КП</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f4f5fa;color:#1e2233}
  .wrap{max-width:760px;margin:0 auto;padding:16px}
  h1{font-size:20px;margin:8px 0 14px}
  .card{background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(30,34,51,.08)}
  .top{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#7a8199}
  .name{font-size:17px;font-weight:700;margin:6px 0 2px}
  .phone a{font-size:17px;color:#4f46e5;text-decoration:none;font-weight:600}
  .meta{font-size:14px;color:#3a3f52;margin-top:6px}
  .test{background:#fff7e6;color:#a15c00;border-radius:6px;padding:1px 6px;font-size:12px;margin-left:6px}
  .empty{color:#7a8199}
</style></head><body><div class="wrap">
<h1>Заявки на КП · <?= count($rows) ?></h1>
<?php if (!$rows): ?><p class="empty">Пока заявок нет.</p><?php endif; ?>
<?php foreach ($rows as $r):
  [$at, $id, $name, $phone, $company, $fmt, $pair, $period, $total, $from] = array_pad($r, 11, '');
  $test = ($r[10] ?? '') !== '';
  $tel = preg_replace('/[^\d+]/', '', $phone);
  $when = strtotime($at) ? date('d.m.Y H:i', strtotime($at)) : $at; ?>
  <div class="card">
    <div class="top"><span><?= $h($when) ?><?= $test ? '<span class="test">тест</span>' : '' ?></span><span>№ <?= $h($id) ?></span></div>
    <div class="name"><?= $h($name) ?><?= $company !== '' ? ' · ' . $h($company) : '' ?></div>
    <div class="phone"><a href="tel:<?= $h($tel) ?>"><?= $h($phone) ?></a></div>
    <div class="meta"><?= $h($fmtName[$fmt] ?? 'формат не выбран') ?> · <?= $h($perName[$period] ?? 'дата не выбрана') ?>
      <?= (int)$total ? ' · ~' . number_format((int)$total, 0, '', ' ') . ' ₽' : '' ?>
      <?= $from !== '' ? ' · ' . $h($from) : '' ?></div>
  </div>
<?php endforeach; ?>
</div></body></html>
