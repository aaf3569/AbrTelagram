const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function highlightAt(times, breaks, minutes) {
  const source = await fs.readFile(path.join(__dirname, '../shared/day-schedule-highlight.js'), 'utf8');
  const { getDayScheduleHighlight } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return getDayScheduleHighlight(times, breaks, minutes);
}

const bells = [
  { start: '07:55', end: '08:40' },
  { start: '08:45', end: '09:30' },
  { start: '09:45', end: '10:30' },
  { start: '10:35', end: '11:20' },
];

test('ordinary gaps select the upcoming lesson at the previous lesson end', async () => {
  assert.deepEqual(await highlightAt(bells, {}, 7 * 60 + 54), null);
  assert.deepEqual(await highlightAt(bells, {}, 8 * 60 + 39), { type: 'lesson', lessonIndex: 1 });
  assert.deepEqual(await highlightAt(bells, {}, 8 * 60 + 40), { type: 'lesson', lessonIndex: 2 });
  assert.deepEqual(await highlightAt(bells, {}, 8 * 60 + 45), { type: 'lesson', lessonIndex: 2 });
  assert.deepEqual(await highlightAt(bells, {}, 11 * 60 + 20), null);
});

test('configured breaks take priority over the upcoming lesson until its bell starts', async () => {
  const breaks = { firstAfter: 2, secondAfter: 3 };
  assert.deepEqual(await highlightAt(bells, breaks, 9 * 60 + 30), { type: 'break', afterLesson: 2 });
  assert.deepEqual(await highlightAt(bells, breaks, 9 * 60 + 44), { type: 'break', afterLesson: 2 });
  assert.deepEqual(await highlightAt(bells, breaks, 9 * 60 + 45), { type: 'lesson', lessonIndex: 3 });
  assert.deepEqual(await highlightAt(bells, breaks, 10 * 60 + 30), { type: 'break', afterLesson: 3 });
  assert.deepEqual(await highlightAt(bells, breaks, 10 * 60 + 35), { type: 'lesson', lessonIndex: 4 });
});

test('the same rule follows custom bell times', async () => {
  const custom = [
    { start: '12:00', end: '12:40' },
    { start: '12:50', end: '13:30' },
  ];
  assert.deepEqual(await highlightAt(custom, {}, 12 * 60 + 45), { type: 'lesson', lessonIndex: 2 });
  assert.deepEqual(await highlightAt(custom, { firstAfter: 1 }, 12 * 60 + 45), { type: 'break', afterLesson: 1 });
});
