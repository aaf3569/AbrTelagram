const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const pagePath of ['Teachers/teacherschedule.html', 'beta/userbeta.html']) {
const page = fs.readFileSync(path.join(__dirname, '..', pagePath), 'utf8');
const pageTest = (name, run) => test(`${pagePath}: ${name}`, run);
pageTest('teacher schedule module parses', () => {
  const scripts = [...page.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for (const [, source] of scripts) new vm.SourceTextModule(source);
});
async function identity() {
  const source = fs.readFileSync(path.join(__dirname, '../shared/schedule-teacher-identity.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

pageTest('old schedule IDs resolve only to an unambiguous teacher profile', async () => {
  const { teacherScheduleUids } = await identity();
  assert.deepEqual(teacherScheduleUids('haider', [{ id: 'haider', uid: 'old-haider' }]), ['haider', 'old-haider']);
  assert.deepEqual(teacherScheduleUids('haider', [
    { id: 'haider', uid: 'other-teacher' }, { id: 'other-teacher' }
  ]), ['haider']);
  assert.deepEqual(teacherScheduleUids('haider', [
    { id: 'haider', uid: 'shared-old-id' }, { id: 'other', uid: 'shared-old-id' }
  ]), ['haider']);
});

pageTest('teacher query includes Monday fifth lesson with text weekday and legacy UID', async () => {
  const rows = [
    { teacherUid: 'old-haider', dayIndex: '1', lesson: '5', classKey: '12 / 1 د' },
    { teacherUid: 'haider', dayIndex: 2, lesson: 1 },
    { teacherUid: 'someone-else', dayIndex: 1, lesson: 5 },
    { teacherUid: 'haider', dayIndex: null, lesson: 2 },
    { teacherUid: 'haider', dayIndex: 6, lesson: 2 }
  ];
  const context = vm.createContext({
    db: {}, getScheduleUids: async () => ['haider', 'old-haider'],
    collection: () => 'schedules', where: (field, op, value) => ({ field, op, value }),
    query: (collection, ...filters) => filters,
    getDocs: async filters => ({ docs: rows.filter(row => filters.every(f => row[f.field] === f.value)).map(row => ({ data: () => row })) })
  });
  const start = page.indexOf('    async function fetchWeekDocsForTeacher(');
  const end = page.indexOf('    async function fetchWeekDocsForClass(', start);
  vm.runInContext(page.slice(start, end), context);
  const result = await context.fetchWeekDocsForTeacher('haider');
  assert.equal(result.length, 2);
  assert.ok(result.some(doc => doc.data().classKey === '12 / 1 د'));
});

pageTest('all 18 assignments reach the weekly grid, including legacy UID and text weekday rows', async () => {
  const rows = Array.from({ length: 18 }, (_, index) => ({
    teacherUid: index === 16 ? 'old-haider' : 'haider',
    dayIndex: index === 17 ? '2' : Math.floor(index / 7),
    lesson: index % 7 + 1,
    classKey: '12 / 1 د'
  }));
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
  const context = vm.createContext({
    console, db: {}, weekDates: dates, FIXED_LESSON_COUNT: 7,
    cache: { weekKey: dates[0], teacherWeek: new Map(), overridesByTeacher: new Map(), customDayDocs: new Map() },
    getScheduleUids: async () => ['haider', 'old-haider'],
    collection: () => 'schedules', where: (field, op, value) => ({ field, op, value }),
    query: (collection, ...filters) => filters,
    getDocs: async filters => ({ docs: rows.filter(row => filters.every(f => f.op === 'in'
      ? f.value.includes(row[f.field]) : row[f.field] === f.value)).map(row => ({ data: () => row })) }),
    loadOverridesForTeacherInDates: async () => {},
    fetchCustomScheduleDocsForDayIndex: async () => [],
    getOverriddenClassKeys: () => new Set(), isClassOverriddenForToday: () => false
  });
  const queryStart = page.indexOf('    async function fetchWeekDocsForTeacher(');
  vm.runInContext(page.slice(queryStart, page.indexOf('    async function fetchWeekDocsForClass(', queryStart)), context);
  const mapStart = page.indexOf('    async function getWeekMapForTeacher(');
  vm.runInContext(page.slice(mapStart, page.indexOf('    async function waitForImageReady(', mapStart)), context);
  const map = await context.getWeekMapForTeacher('haider');
  assert.equal([...map.values()].reduce((total, day) => total + day.size, 0), 18);
  assert.equal(map.get(dates[2]).get(3), '12 / 1 د');
  assert.equal(map.get(dates[2]).get(4), '12 / 1 د');
});

pageTest('reported wrong-class covers preserve all 18 lessons in weekly and daily views', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../shared/schedule-priority.js'), 'utf8');
  const priority = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
  const classes = [
    ['12 / 1 د', [[0,3],[1,5],[2,2],[3,4],[3,6],[4,3]]],
    ['12 / 4 ع', [[0,5],[1,3],[2,6],[2,7],[3,5],[4,5]]],
    ['12 / 5 ع', [[0,6],[1,2],[1,6],[2,3],[3,2],[4,2]]]
  ];
  const rows = classes.flatMap(([classKey, slots]) => slots.map(([dayIndex, lesson]) => ({ classKey, dayIndex, lesson })));
  const mondayCover = { _kind: 'original', classKey: '12 / 4 ع', _id: 'monday-cover' };
  const thursdayCover = { _kind: 'original', classKey: '12 / 1 د', _id: 'thursday-cover' };
  const cache = { weekKey: dates[0], teacherWeek: new Map(), overridesByTeacher: new Map(), customDayDocs: new Map() };
  const context = vm.createContext({
    console,
    weekDates: dates, FIXED_LESSON_COUNT: 7, cache,
    fetchWeekDocsForTeacher: async () => rows.map(row => ({ data: () => row })),
    loadOverridesForTeacherInDates: async () => cache.overridesByTeacher.set('haider', new Map([
      [dates[1], new Map([[5, mondayCover]])], [dates[4], new Map([[2, thursdayCover]])]
    ])),
    fetchCustomScheduleDocsForDayIndex: async () => [],
    getOverriddenClassKeys: priority.getOverriddenClassKeys,
    classKeyFromRow: priority.classKeyFromRow, normalizeClassKey: priority.normalizeClassKey,
    mergeCustomIntoLessonMap: priority.mergeCustomIntoLessonMap,
    isClassOverriddenForToday: () => false,
    dayIndexForISO: date => dates.indexOf(date), getScheduleUids: async () => ['haider']
  });
  for (const [startText, endText] of [
    ['    async function getWeekMapForTeacher(', '    async function waitForImageReady('],
    ['    async function buildTodayMapWithOverrides(', '    function isClassOverriddenForToday(']
  ]) {
    const start = page.indexOf(startText);
    vm.runInContext(page.slice(start, page.indexOf(endText, start)), context);
  }
  const week = await context.getWeekMapForTeacher('haider');
  assert.equal([...week.values()].reduce((count, day) => count + [...day.values()].filter(value => value !== '—').length, 0), 18);
  assert.equal(week.get(dates[1]).get(5), '12 / 1 د');
  assert.equal(week.get(dates[4]).get(2), '12 / 5 ع');
  assert.equal((await context.buildTodayMapWithOverrides('haider', dates[1])).get('5').classKey, '12 / 1 د');
  assert.equal((await context.buildTodayMapWithOverrides('haider', dates[4])).get('2').classKey, '12 / 5 ع');

  // Legitimate covers still apply, including differently spaced class labels.
  mondayCover.classKey = '12/1 د';
  thursdayCover.classKey = '12/5 ع';
  const coveredWeek = await context.getWeekMapForTeacher('haider');
  assert.equal(coveredWeek.get(dates[1]).get(5), '—');
  assert.equal(coveredWeek.get(dates[4]).get(2), '—');
  assert.equal((await context.buildTodayMapWithOverrides('haider', dates[1])).get('5')._coveredAway, true);

  // An override without a class must not erase an unrelated standing lesson.
  mondayCover.classKey = '';
  assert.equal((await context.getWeekMapForTeacher('haider')).get(dates[1]).get(5), '12 / 1 د');
  assert.equal((await context.buildTodayMapWithOverrides('haider', dates[1])).get('5').classKey, '12 / 1 د');
});

pageTest('weekly map renders Monday fifth lesson and refreshes admin changes', async () => {
  let classKey = '12 / 1 د';
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
  const context = vm.createContext({
    console, weekDates: dates, FIXED_LESSON_COUNT: 7,
    cache: { weekKey: dates[0], teacherWeek: new Map(), overridesByTeacher: new Map(), customDayDocs: new Map() },
    fetchWeekDocsForTeacher: async () => [{ data: () => ({ dayIndex: '1', lesson: '5', classKey }) }],
    loadOverridesForTeacherInDates: async () => {},
    fetchCustomScheduleDocsForDayIndex: async () => [],
    getOverriddenClassKeys: () => new Set(), isClassOverriddenForToday: () => false,
    getScheduleUids: async () => ['haider']
  });
  const start = page.indexOf('    async function getWeekMapForTeacher(');
  const end = page.indexOf('    async function waitForImageReady(', start);
  vm.runInContext(page.slice(start, end), context);
  assert.equal((await context.getWeekMapForTeacher('haider')).get(dates[1]).get(5), classKey);
  classKey = '12 / 2 د';
  assert.equal((await context.getWeekMapForTeacher('haider')).get(dates[1]).get(5), classKey);
});

pageTest('custom replacement still suppresses the main lesson and resolves a legacy teacher ID', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../shared/schedule-priority.js'), 'utf8');
  const priority = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
  const custom = { classKey: '12 / 1 د', lessonCount: 5, lessons: [{}, {}, {}, {}, { teacherUid: 'other' }] };
  const context = vm.createContext({
    console, weekDates: dates, FIXED_LESSON_COUNT: 7,
    cache: { weekKey: dates[0], teacherWeek: new Map(), overridesByTeacher: new Map(), customDayDocs: new Map() },
    fetchWeekDocsForTeacher: async () => [{ data: () => ({ dayIndex: 1, lesson: 5, classKey: custom.classKey }) }],
    loadOverridesForTeacherInDates: async () => {},
    fetchCustomScheduleDocsForDayIndex: async day => day === 1 ? [custom] : [],
    getOverriddenClassKeys: priority.getOverriddenClassKeys,
    classKeyFromRow: priority.classKeyFromRow,
    isClassOverriddenForToday: (row, keys) => priority.isClassOverriddenToday(priority.classKeyFromRow(row), keys),
    getScheduleUids: async () => ['haider', 'old-haider']
  });
  const start = page.indexOf('    async function getWeekMapForTeacher(');
  const end = page.indexOf('    async function waitForImageReady(', start);
  vm.runInContext(page.slice(start, end), context);
  assert.equal((await context.getWeekMapForTeacher('haider')).get(dates[1]).get(5), undefined);
  custom.lessons[4].teacherUid = 'old-haider';
  assert.equal((await context.getWeekMapForTeacher('haider')).get(dates[1]).get(5), custom.classKey);
});

}
