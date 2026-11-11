#!/usr/bin/env node
// Собирает calculator/kp.pdf из marketing/kp/kp.html (Chromium через Playwright).
// Запуск из корня репозитория: node marketing/kp/build-kp.js [--png]
'use strict';
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const src = path.resolve(__dirname, 'kp.html');
  const out = path.resolve(__dirname, '../../calculator/kp.pdf');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + src, { waitUntil: 'networkidle' });
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  if (process.argv.includes('--png')) {
    // превью страниц для проверки глазами
    await page.setViewportSize({ width: 794, height: 1123 });
    const pages = await page.$$('section.page');
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.resolve(process.argv[process.argv.indexOf('--png') + 1] || '.', `kp-${i + 1}.png`) });
    }
  }
  await browser.close();
  console.log('PDF:', out);
})();
