const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadPriority() {
  const source = fs.readFileSync(path.join(__dirname, '../shared/schedule-priority.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const slot = (label) => ({ start: '08:00', end: '08:45', ...(label ? { label } : {}) });

test('unnamed custom slots are numbered by position', async () => {
  const p = await loadPriority();
  const times = [slot(), slot(), slot()];
  assert.equal(p.customLessonLabel(times, 0), 'الحصة الأولى');
  assert.equal(p.customLessonLabel(times, 2), 'الحصة الثالثة');
  assert.equal(p.customLessonShortLabel(times, 2), 'الثالثة');
});

test('a custom-named slot keeps its name and does not renumber the lessons after it', async () => {
  const p = await loadPriority();
  const times = [slot(), slot(), slot(), slot('حصة مستقطعة'), slot(), slot()];
  assert.equal(p.customLessonLabel(times, 3), 'حصة مستقطعة');
  assert.equal(p.customLessonShortLabel(times, 3), 'حصة مستقطعة');
  assert.equal(p.customLessonLabel(times, 4), 'الحصة الرابعة');
  assert.equal(p.customLessonLabel(times, 5), 'الحصة الخامسة');
  // A blank label is a numbered slot.
  assert.equal(p.customLessonLabel([slot('  '), slot()], 1), 'الحصة الثانية');
});

test('numbers past the seventh lesson still read as ordinals', async () => {
  const p = await loadPriority();
  const times = Array.from({ length: 12 }, () => slot());
  assert.equal(p.customLessonLabel(times, 7), 'الحصة الثامنة');
  assert.equal(p.customLessonLabel(times, 11), 'الحصة الثانية عشرة');
});

test('merged custom lessons carry their name, and a larger limit reaches past lesson 7', async () => {
  const p = await loadPriority();
  const times = [...Array.from({ length: 3 }, () => slot()), slot('حصة مستقطعة'), ...Array.from({ length: 4 }, () => slot())];
  const lessons = times.map(() => ({ teacherUid: 't1', subject: 'رياضيات' }));
  const row = { classKey: '10 / 1', lessonCount: 8, lessons, times };

  const capped = new Map();
  p.mergeCustomIntoLessonMap(capped, 't1', [row]);
  assert.equal(capped.size, 7);

  const all = new Map();
  p.mergeCustomIntoLessonMap(all, 't1', [row], { fixedLessonCount: 12 });
  assert.equal(all.size, 8);
  assert.equal(all.get('4').lessonLabel, 'حصة مستقطعة');
  assert.equal(all.get('8').lessonLabel, 'الحصة السابعة');
});
