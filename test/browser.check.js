'use strict';
// Headless browser walkthrough using the system Chrome. Not part of the shipped
// test suite (needs puppeteer-core + Chrome). Run manually: node test/browser.check.js
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:3111';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const step = (m) => console.log('  ▸', m);

  // HOME
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.create-card');
  step('home renders');

  // fill form: title + a couple of dates
  await page.type('.in.big', 'Puppeteer Long Run');
  // pick first two non-past days in calendar
  await page.evaluate(() => {
    const days = [...document.querySelectorAll('.cal-day:not(.past)')].slice(0, 3);
    days.forEach(d => d.click());
  });
  step('selected dates');
  await page.click('.btn.btn-lg');
  await page.waitForFunction(() => location.pathname.startsWith('/e/'), { timeout: 5000 });
  await page.waitForSelector('.ev-header');
  const eid = await page.evaluate(() => location.pathname.split('/').pop());
  step('event created: ' + eid);

  // JOIN
  await page.type('#join-name', 'Casey');
  await page.click('.join-form .btn');
  await page.waitForSelector('.grid-col .avail-grid.mode-edit', { timeout: 5000 });
  step('joined + edit grid visible');

  // PAINT availability: drag across a few cells
  const cells = await page.$$('.mode-edit .ag-cell');
  if (cells.length >= 4) {
    const b1 = await cells[0].boundingBox();
    const b2 = await cells[3].boundingBox();
    await page.mouse.move(b1.x + 4, b1.y + 4);
    await page.mouse.down();
    await page.mouse.move(b2.x + 4, b2.y + 4, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForFunction(() => document.querySelectorAll('.mode-heat .ag-cell.has').length > 0, { timeout: 5000 });
  step('painted availability → heatmap updated');

  // TABS: locations, routes, pace, chat
  for (const label of ['📍 Locations', '🗺️ Routes', '🏃 Pace', '💬 Chat']) {
    await page.evaluate((lbl) => {
      const t = [...document.querySelectorAll('.tab')].find(b => b.textContent.includes(lbl.split(' ')[1]));
      t && t.click();
    }, label);
    await new Promise(r => setTimeout(r, 250));
  }
  step('cycled all panels');

  // add a strava route
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find(b => b.textContent.includes('Routes'));
    t && t.click();
  });
  await page.waitForSelector('.routes .add-form');
  await page.type('.routes .add-form .in', 'River Loop');
  await page.evaluate(() => {
    const urlInput = document.querySelectorAll('.routes .add-form .in')[1];
    urlInput.value = 'https://www.strava.com/routes/1234567';
  });
  await page.click('.routes .add-form .btn');
  await page.waitForFunction(() => document.querySelector('.route-card'), { timeout: 5000 });
  step('added a route');

  // set pace
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.tab')].find(b => b.textContent.includes('Pace'));
    t && t.click();
  });
  await page.waitForSelector('.pace-lab .pace-input');
  await page.type('.pace-lab .pace-input', '5:30');
  await page.click('.pace-lab .btn-sm');
  await new Promise(r => setTimeout(r, 400));
  step('set pace');

  await new Promise(r => setTimeout(r, 500));
  await browser.close();

  if (errors.length) {
    console.error('\n❌ Browser errors detected:');
    errors.forEach(e => console.error('   -', e));
    process.exit(1);
  }
  console.log('\n✅ Browser walkthrough clean — no JS errors');
})().catch(e => { console.error('❌ walkthrough failed:', e.message); process.exit(1); });
