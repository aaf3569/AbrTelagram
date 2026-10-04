const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The script is a classic browser script; run it without a DOM and use the
// helpers it exposes on the global object.
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/arabic-text-fix.js'), 'utf8'), sandbox);
const { normalizeArabicText, hasArabicTajawalCantDraw } = sandbox;

test('Persian yeh and kaf become the Arabic letters Tajawal can draw', () => {
  assert.equal(normalizeArabicText('حسین'), 'حسين');
  assert.equal(normalizeArabicText('علی'), 'علي');
  assert.equal(normalizeArabicText('کاظم'), 'كاظم');
  assert.equal(normalizeArabicText('فاطمہ'), 'فاطمه');
  assert.equal(normalizeArabicText('ھادي'), 'هادي');
});

test('Persian digits become Arabic-Indic digits', () => {
  assert.equal(normalizeArabicText('۱۲۴'), '١٢٤');
});

test('presentation-form letters (PDF copy/paste) become normal letters', () => {
  // ﺣﺴﻴﻦ in presentation forms
  assert.equal(normalizeArabicText('ﺣﺴﻴﻦ'), 'حسين');
  // lam-alef ligature
  assert.equal(normalizeArabicText('ﻻ'), 'لا');
});

test('zero-width characters inside Arabic words are removed, emoji ZWJ kept', () => {
  assert.equal(normalizeArabicText('حس‌ين'), 'حسين');
  assert.equal(normalizeArabicText('محمد‍'), 'محمد');
  assert.equal(normalizeArabicText('﻿أحمد'), 'أحمد');
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  assert.equal(normalizeArabicText(family), family);
});

test('ordinary Arabic and Latin text is returned untouched', () => {
  for (const s of ['حسين علي الكندري', 'عبدالله', 'Grade 12 - ١٢', '', 'إبراهيم ؤ ئ ة ى']) {
    assert.equal(normalizeArabicText(s), s);
    assert.equal(hasArabicTajawalCantDraw(normalizeArabicText(s)), false);
  }
  assert.equal(normalizeArabicText(null), null);
});

test('letters with no Arabic equivalent are flagged for the fallback font', () => {
  assert.equal(hasArabicTajawalCantDraw('چاسم'), true); // چ
  assert.equal(hasArabicTajawalCantDraw('گل'), true); // گ
  assert.equal(hasArabicTajawalCantDraw(normalizeArabicText('حسین')), false);
});
