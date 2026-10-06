// Browsertest: klikt door de belangrijkste schermen op telefoonformaat.
// Draait alleen als er een Chromium is (E2E=1), bijv. in GitHub Actions of in de Playwright-container
// (dan met E2E_BASE=http://… naar een server met een lege database).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

const enabled = process.env.E2E === '1';
let srv;
let browser;
let page;
let pinId;
const errors = [];

test.before(async () => {
  if (!enabled) return;
  const { chromium } = require('playwright-core');
  // E2E_BASE: tegen een server die al draait (met een lege database), anders zelf een starten.
  srv = process.env.E2E_BASE ? { base: process.env.E2E_BASE, stop: async () => {} } : await startServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  // Account, groep en een bestemming klaarzetten via de API.
  const c = client(srv.base);
  await c.req('POST', '/api/auth/register', { name: 'Tester', password: 'geheim1234' });
  c.team = (await c.req('POST', '/api/teams', { name: 'Testgroep' })).data.id;
  const map = (await c.req('GET', '/api/content')).data.sections.find((s) => s.kind === 'map');
  pinId = (await c.req('POST', `/api/sections/${map.id}/items`, { title: 'Catania, Sicilië', lat: 37.5079, lng: 15.083 })).data.id;
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.stop();
});

const opts = { skip: !enabled && 'zet E2E=1 om de browsertest te draaien' };

test('inloggen en de kaart', opts, async () => {
  await page.goto(srv.base);
  await page.click('[data-auth-mode=login]');
  await page.fill('input[name=name]', 'Tester');
  await page.fill('input[type=password]', 'geheim1234');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.leaflet-container', { timeout: 10000 });
  assert.ok(await page.locator('.tab-map').count());
});

test('pin openen en een reis laten ontstaan', opts, async () => {
  await page.goto(`${srv.base}/#pin-${pinId}`);
  await page.waitForSelector('#pinDialog[open]', { timeout: 10000 });
  await page.locator('details[data-step=stay] summary').click();
  await page.click('[data-new-kind=stay]');
  await page.fill('#itemForm [name=title]', 'Testappartement');
  await page.fill('#itemForm [name=price]', '€ 500');
  await page.click('#itemForm button[type=submit]');
  await page.waitForSelector('.chosen strong', { timeout: 10000 });
  assert.equal(await page.textContent('.chosen strong'), 'Testappartement');
});

test('reizen: toevoegen-knoppen en huurauto-paneel', opts, async () => {
  await page.goto(`${srv.base}/#reizen`);
  await page.waitForSelector('.card.trip', { timeout: 10000 });
  assert.match(await page.textContent('.card.trip'), /Testappartement/);
  await page.click('[data-trip-add=car]');
  await page.waitForSelector('#tripAddDialog[open] .car-search');
  await page.click('#tripAddDialog [data-close]');
});

test('ideeën laden met filters ingeklapt', opts, async () => {
  await page.goto(`${srv.base}/#ideeen`);
  await page.waitForSelector('.pkg', { timeout: 15000 });
  assert.ok(await page.locator('#ideaFilters').isHidden());
  await page.click('.idea-filter-btn');
  assert.ok(await page.locator('#ideaFilters').isVisible());
  await page.click('[data-cat=casino]');
  await page.waitForSelector('.pkg-casino');
});

test('chat: bericht sturen', opts, async () => {
  await page.goto(`${srv.base}/#chat`);
  await page.waitForSelector('#chatInput', { timeout: 10000 });
  await page.fill('#chatInput', 'Hallo groep');
  // Op de telefoon is Enter een nieuwe regel; versturen gaat met de knop.
  await page.click('#chatForm button[type=submit]');
  await page.waitForFunction(() => document.body.textContent.includes('Hallo groep'), null, { timeout: 10000 });
});

test('geen JavaScript-fouten', opts, () => {
  assert.deepEqual(errors, []);
});
