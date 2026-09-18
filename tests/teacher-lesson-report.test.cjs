const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
async function loadReport() {
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file });
    cache.set(file, module);
    await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
    return module;
  }
  const module = await load(path.join(root, 'shared/teacher-lesson-report.js'));
  await module.evaluate();
  return module.namespace;
}
const profiles = [{ id: 'haider', uid: 'old-haider' }, { id: 'other' }];
const monday = { classKey: '12 / 1 د', dayIndex: '1', lesson: '5', teacherUid: 'old-haider', subject: 'الرياضيات' };

test('report counts lessons across classes and retains simultaneous assignments for conflict display', async () => {
  const { teacherLessonReport } = await loadReport();
  const result = teacherLessonReport('haider', profiles, [monday,
    { ...monday, classKey: '10 / 2', teacherUid: 'haider' },
    { ...monday, dayIndex: 0, lesson: 2 },
    { ...monday, dayIndex: 3, teacherUid: 'other' }]);
  assert.equal(result.length, 3);
  assert.equal(result[0].dayIndex, 0);
  assert.equal(result.filter(row => row.dayIndex === 1 && row.lesson === 5).length, 2);
});

test('newer reassigned and cleared slots remove old teacher assignments regardless of query order', async () => {
  const { teacherLessonReport } = await loadReport();
  for (const teacherUid of ['other', '']) {
    const newer = { ...monday, teacherUid, updatedAt: { toMillis: () => 20 } };
    const older = { ...monday, updatedAt: { toMillis: () => 10 } };
    assert.equal(teacherLessonReport('haider', profiles, [newer, older]).length, 0);
    assert.equal(teacherLessonReport('haider', profiles, [older, newer]).length, 0);
  }
});

test('duplicates count once; invalid weekdays, periods, and deleted rows are excluded', async () => {
  const { teacherLessonReport } = await loadReport();
  const result = teacherLessonReport('haider', profiles, [monday, { ...monday, classKey: '12/1 د' },
    { ...monday, dayIndex: null }, { ...monday, dayIndex: 6 }, { ...monday, lesson: 0 },
    { ...monday, lesson: 3, deletedAt: true }]);
  assert.equal(result.length, 1);
  assert.equal(teacherLessonReport('nobody', profiles, [monday]).length, 0);
});

test('Arabic teacher search ignores diacritics, tatweel, alef variants, and extra spaces', async () => {
  const { normalizeTeacherSearch } = await loadReport();
  assert.equal(normalizeTeacherSearch('  حَيدر   أحـمد حمزة الهزيم '), 'حيدر احمد حمزة الهزيم');
});

test('admin page and popup module parse; every popup element reference exists', () => {
  const html = fs.readFileSync(path.join(root, 'admins/adminschedule.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'shared/admin-teacher-search.js'), 'utf8');
  new vm.SourceTextModule(source);
  for (const [, script] of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) new vm.SourceTextModule(script);
  for (const [, id] of source.matchAll(/byId\('([^']+)'\)/g)) assert.ok(html.includes(`id="${id}"`), id);
});
