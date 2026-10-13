// ميزانية القسم on a phone (cards): one teacher, two subjects in one class.
// The case that the cards used to refuse:
//   حسين: 11ع1 جيولوجيا / 11ع2 جيولوجيا + التربية البيئية / 11ع5 جيولوجيا
//   يوسف: 11ع3 و11ع4 جيولوجيا + التربية البيئية / 11ع5 التربية البيئية
// Runs the real page in Chromium against a fake Firestore (mock-firebase.js).
//   node tests/e2e/budgets-phone/run.cjs
// Needs Playwright (PLAYWRIGHT_MODULE) and Chromium (CHROMIUM_PATH).
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.join(__dirname, '../../..'), HERE = __dirname;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u === '/host.html' ? path.join(HERE, 'host.html') : u === '/shared/firebase.js' ? path.join(HERE, 'mock-firebase.js') : path.join(ROOT, u);
  fs.readFile(f, (e, b) => {
    if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b);
  });
});
(async () => {
  await new Promise((ok) => srv.listen(0, ok));
  const br = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const pg = await br.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.goto(`http://localhost:${srv.address().port}/host.html`);
    await pg.waitForFunction(() => window.__ready);
    const card = (n) => pg.locator('#host .card').filter({ has: pg.locator('.tname', { hasText: n }) });
    const cell = (n, c) => card(n).locator(`button.cell[title^="${c}"]`);
    const isOn = (n, c) => cell(n, c).evaluate((b) => b.classList.contains('on'));
    const both = async (n, c) => {
      await cell(n, c).click();                     // the first free subject
      await cell(n, c).click();                     // the class's subjects
      await card(n).locator('.subjEdit .sub', { hasText: 'التربية البيئية' }).click();
      await card(n).locator('.subjEdit button', { hasText: 'تم' }).click();
    };
    await cell('حسين', '11 / 1 ع').click();
    await both('حسين', '11 / 2 ع');
    await cell('حسين', '11 / 5 ع').click();
    await both('يوسف', '11 / 3 ع');
    await both('يوسف', '11 / 4 ع');
    await cell('يوسف', '11 / 5 ع').click();          // الجيولوجيا is حسين's → التربية البيئية
    assert.equal(await pg.locator('#host button.cell.dup').count(), 0);

    await pg.locator('#host button', { hasText: /^حفظ$/ }).first().click();
    await pg.waitForFunction(() => window.__saved.length);
    const saved = await pg.evaluate(() => window.__saved[0].data.teachers);
    const by = Object.fromEntries(saved.map((t) => [t.name, t]));
    const G = 'الجيولوجيا', B = 'التربية البيئية';
    assert.deepEqual(by['حسين القطيفي'].cells, { '11 / 1 ع': 2, '11 / 2 ع': 3, '11 / 5 ع': 2 });
    assert.deepEqual(by['حسين القطيفي'].split, { '11 / 2 ع': { [G]: 2, [B]: 1 } });
    assert.equal(by['حسين القطيفي'].subj['11 / 5 ع'], G);
    assert.deepEqual(by['يوسف القلاف'].cells, { '11 / 3 ع': 3, '11 / 4 ع': 3, '11 / 5 ع': 1 });
    assert.deepEqual(by['يوسف القلاف'].split, { '11 / 3 ع': { [G]: 2, [B]: 1 }, '11 / 4 ع': { [G]: 2, [B]: 1 } });
    assert.equal(by['يوسف القلاف'].subj['11 / 5 ع'], B);

    // The same subject in the same class is still refused.
    await cell('يوسف', '11 / 2 ع').click();
    assert.equal(await isOn('يوسف', '11 / 2 ع'), false);
    // «إزالة الشعبة» drops a class of two subjects.
    await cell('حسين', '11 / 2 ع').click();
    await card('حسين').locator('.subjEdit button', { hasText: 'إزالة الشعبة' }).click();
    assert.equal(await isOn('حسين', '11 / 2 ع'), false);
    assert.deepEqual(errors, []);
    console.log('ok — budgets on a phone: one teacher, two subjects in one class');
  } finally { await br.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
