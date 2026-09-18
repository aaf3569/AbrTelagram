const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../Teachers/teacherschedule.html'), 'utf8');
test('teacher schedule module parses', () => {
  const scripts = [...page.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for (const [, source] of scripts) new vm.SourceTextModule(source);
});
async function identity() {
  const source = fs.readFileSync(path.join(__dirname, '../shared/schedule-teacher-identity.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('old schedule IDs resolve only to an unambiguous teacher profile', async () => {
  const { teacherScheduleUids } = await identity();
  assert.deepEqual(teacherScheduleUids('haider', [{ id: 'haider', uid: 'old-haider' }]), ['haider', 'old-haider']);
  assert.deepEqual(teacherScheduleUids('haider', [
    { id: 'haider', uid: 'other-teacher' }, { id: 'other-teacher' }
  ]), ['haider']);
  assert.deepEqual(teacherScheduleUids('haider', [
    { id: 'haider', uid: 'shared-old-id' }, { id: 'other', uid: 'shared-old-id' }
  ]), ['haider']);
});

test('teacher query includes Monday fifth lesson with text weekday and legacy UID', async () => {
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

test('weekly map renders Monday fifth lesson and refreshes admin changes', async () => {
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

test('custom replacement still suppresses the main lesson and resolves a legacy teacher ID', async () => {
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
