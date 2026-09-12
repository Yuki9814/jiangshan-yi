'use strict';
// Run with Node 22 and Playwright 1.55; screenshots are written to ignored work/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json' };
const server = http.createServer((request, response) => {
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); }
  catch { response.writeHead(400); response.end(); return; }
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  if (file === root) file = path.join(root, 'index.html');
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); response.end(content);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  const errors = [], failures = []; let checks = 0;
  const ok = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
  const attach = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    page.on('dialog', dialog => dialog.accept());
  };
  const ready = async page => { await page.goto(url); await page.waitForFunction(() => !!window.jiangshanReady); await page.evaluate(() => window.jiangshanReady); };
  const month = async page => Number(await page.locator('#date-label').getAttribute('data-month'));
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(); attach(page); await ready(page);
    ok('identity and nonblank map', (await page.title()).includes('江山弈') && await page.locator('#world-map .region').count() === 93);
    for (let i = 0; i < 12; i++) await page.locator('#step-button').click();
    ok('single-month controls advance exactly twelve months', await month(page) === 12);
    await page.locator('#experience-button').click(); await page.locator('[data-save-action="save"]').click();
    await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('已保存第 12 月'));
    const downloadEvent = page.waitForEvent('download'); await page.locator('[data-save-action="export"]').click();
    const download = await downloadEvent; const save = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    ok('export contains snapshot and ordered commands', save.state.month === 12 && Array.isArray(save.state.commandLog));
    await page.locator('#save-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"invalid"}') });
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('导入失败'));
    ok('invalid import preserves current month', await month(page) === 12);
    await ready(page); ok('reload restores and stays paused', await month(page) === 12 && (await page.locator('#run-status').innerText()) === '已暂停');
    await page.screenshot({ path: path.join(root, 'work/review-desktop.png') });
    await page.locator('#setup-button').click(); await page.locator('[data-preset="triangle"]').click();
    await page.locator('#council-option').check(); await page.locator('#council-player').selectOption('caocao');
    await page.locator('#setup-seed').fill('council-browser'); await page.locator('#setup-start').click();
    ok('new council match starts at month zero', await month(page) === 0);
    await page.locator('#experience-button').click();
    for (let i = 0; i < 3; i++) await page.locator('[data-order-kind="farm"]').click();
    ok('quarterly order limit is visible and enforced', (await page.locator('#orders-remaining').innerText()) === '0 / 3' && await page.locator('[data-order-kind="farm"]').isDisabled());
    await page.screenshot({ path: path.join(root, 'work/review-council.png') });
    await page.locator('[data-close-save]').click();
    for (let i = 0; i < 3; i++) await page.locator('#step-button').click();
    await page.locator('#experience-button').click(); ok('new quarter restores orders', (await page.locator('#orders-remaining').innerText()) === '3 / 3');
    await page.locator('[data-close-save]').click();
    await page.locator('#truce-toggle').click(); await page.locator('#world-chapter').click(); await page.locator('#play-button').click();
    await page.locator('#truce-toggle').click(); ok('world truce offers world resumption', (await page.locator('#truce-toggle').innerText()).includes('域外'));
    await page.locator('#truce-toggle').click(); await page.locator('#play-button').click();
    ok('resume does not silently restart civil war', (await page.locator('#chapter-status').innerText()).includes('副本'));
    for (let i = 0; i < 24; i++) await page.locator('#step-button').click();
    await page.locator('#events-tab').click();
    let total = Number(await page.locator('#event-count').innerText());
    for (let i = 0; total <= 80 && i < 40; i++) { await page.locator('#step-button').click(); total = Number(await page.locator('#event-count').innerText()); }
    ok('history exceeds first page', total > 80);
    ok('history starts with eighty visible events', await page.locator('#event-list [data-event]').count() === 80);
    await page.locator('#event-more').click(); ok('older history remains reachable', await page.locator('#event-list [data-event]').count() === Math.min(160, total));
    await page.locator('#event-search').fill('屯田');
    ok('event search changes results', await page.locator('#event-list [data-event]').count() > 0 && (await page.locator('#event-list').innerText()).includes('屯田'));
    const box = await page.locator('#world-map').boundingBox(); const before = await page.locator('#world-map').getAttribute('viewBox');
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5); await page.mouse.wheel(0, -100); await page.waitForTimeout(100);
    ok('wheel zoom responds', before !== await page.locator('#world-map').getAttribute('viewBox'));
    await context.close();
    for (const width of [390, 320]) {
      const mobile = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      const p = await mobile.newPage(); attach(p); await ready(p);
      ok(`no page overflow at ${width}px`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const play = await p.locator('#play-button').boundingBox(); ok(`play control visible at ${width}px`, play && play.y >= 0 && play.y + play.height <= 844 && play.height >= 40);
      await p.locator('#experience-button').click(); ok(`mobile save controls reachable at ${width}px`, await p.locator('[data-save-action="save"]').isVisible());
      await p.screenshot({ path: path.join(root, `work/review-mobile-${width}.png`) });
      await p.locator('[data-close-save]').click(); await p.locator('#step-button').click(); ok(`mobile month step works at ${width}px`, await month(p) === 1);
      await mobile.close();
    }
    assert.deepEqual(errors, [], 'browser console/runtime errors'); assert.deepEqual(failures, [], 'missing local resources');
    console.log(JSON.stringify({ ok: true, checks, errors, missingResources: failures, browser: 'Chromium', viewports: ['1440x900', '390x844', '320x844'] }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
