const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../beta/userbeta.html'), 'utf8');
const start = html.indexOf("document.getElementById('actAttendance').addEventListener");
const end = html.indexOf("document.getElementById('actCover').addEventListener", start);
const source = html.slice(start, end);

function setup(overrides = {}) {
  const calls = [];
  const meta = { date: '2026-09-19', lesson: 1, classKey: '12 / 2' };
  const button = { disabled: false };
  let handler;
  vm.runInNewContext(source, {
    document: { getElementById: () => ({ addEventListener: (_, fn) => { handler = fn; } }) },
    meta, kuwaitTodayISO: () => meta.date,
    normalizeClassKey: value => value.replace(/\s/g, ''),
    dsAttendance: {
      getCurrentLessonClass: async () => ({ ok: true, ...meta }),
      start: async () => calls.push('open'),
      ...overrides,
    },
    closeModal: () => calls.push('close'),
    toast: () => calls.push('toast'),
    console: { error() {} },
    location: { set href(_) { throw new Error('Attendance must not navigate'); } },
  });
  return { calls, meta, button, click: () => handler({ currentTarget: button }) };
}

test('schedule attendance opens in place after closing lesson actions', async () => {
  const ui = setup();
  await ui.click();
  assert.deepEqual(ui.calls, ['close', 'open']);
  assert.equal(ui.button.disabled, false);
});

test('a different active lesson cannot open attendance for the selected cell', async () => {
  const ui = setup({ getCurrentLessonClass: async () => ({ ok: true, date: '2026-09-19', lesson: 2, classKey: '12 / 2' }) });
  await ui.click();
  assert.deepEqual(ui.calls, ['toast']);
  assert.equal(ui.button.disabled, false);
});

test('failed eligibility reads show feedback and allow retry', async () => {
  const ui = setup({ getCurrentLessonClass: async () => { throw new Error('offline'); } });
  await ui.click();
  assert.deepEqual(ui.calls, ['toast']);
  assert.equal(ui.button.disabled, false);
});

test('repeated clicks during eligibility lookup open only one sheet', async () => {
  let resolve;
  const ui = setup({ getCurrentLessonClass: () => new Promise(done => { resolve = done; }) });
  const pending = ui.click();
  await ui.click();
  resolve({ ok: true, ...ui.meta });
  await pending;
  assert.deepEqual(ui.calls, ['close', 'open']);
});
