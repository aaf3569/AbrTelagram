const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function loadAttendanceTiles(records) {
  const source = await fs.readFile(path.join(__dirname, '../shared/attendance-tiles.js'), 'utf8');
  const context = vm.createContext({ console });
  const module = new vm.SourceTextModule(source, { context });
  const firebase = new vm.SyntheticModule(['collection', 'getDocs', 'query', 'where'], function () {
    this.setExport('collection', (...parts) => parts);
    this.setExport('query', (collectionPath) => collectionPath);
    this.setExport('where', () => null);
    this.setExport('getDocs', async (collectionPath) => ({
      forEach(callback) {
        if (collectionPath[1] === 'students') records.forEach((record, index) => callback({ id: String(index), data: () => record }));
      },
    }));
  }, { context });
  await module.link(() => firebase);
  await module.evaluate();
  return module.namespace;
}

test('warning counts use unique absence dates and never count a mixed day twice', async () => {
  const tiles = await loadAttendanceTiles([
    { date: '2026-09-14', lessonIndex: 1, status: 'absent' },
    { date: '2026-09-14', lessonIndex: 2, status: 'absent' },
    { date: '2026-09-14', lessonIndex: 3, status: 'absent', hasReason: true },
    { date: '2026-09-13', lessonIndex: 1, status: 'absent', hasReason: true },
    { date: '2026-09-13', lessonIndex: 2, status: 'absent', hasReason: true },
    { date: '2026-09-12', lessonIndex: 1, status: 'late' },
  ]);
  const data = await tiles.fetchStudentAttendanceData({}, 'student-1');
  assert.equal(data.absenceDays.length, 2);
  assert.equal(data.absent, 1);
  assert.equal(data.excused, 1);
  assert.equal(data.absenceDays[0].records.length, 3);
  assert.equal(data.absenceDays[0].excused, false);
  assert.equal(data.absenceDays[1].excused, true);
  assert.equal(data.late, 1);
});

test('correcting the final absent lesson removes its date from warnings', async () => {
  const tiles = await loadAttendanceTiles([
    { date: '2026-09-14', lessonIndex: 1, status: 'present' },
    { date: '2026-09-14', lessonIndex: 2, status: 'late' },
  ]);
  const data = await tiles.fetchStudentAttendanceData({}, 'student-1');
  assert.equal(data.absenceDays.length, 0);
  assert.equal(data.absent, 0);
  assert.equal(data.excused, 0);
});

test('attendance counts days, not lessons, and never a day that is already an absence day', async () => {
  const tiles = await loadAttendanceTiles([
    { date: '2026-09-14', lessonIndex: 1, status: 'present' },
    { date: '2026-09-14', lessonIndex: 2, status: 'present' },
    { date: '2026-09-14', lessonIndex: 3, status: 'late' },
    { date: '2026-09-15', lessonIndex: 1, status: 'late' },
    { date: '2026-09-16', lessonIndex: 1, status: 'present' },
    { date: '2026-09-16', lessonIndex: 2, status: 'absent' },
    { date: '2026-09-17', lessonIndex: 1, status: 'absent' },
  ]);
  const data = await tiles.fetchStudentAttendanceData({}, 'student-1');
  assert.equal(data.present, 3);
  assert.equal(data.presentDays, 2);
  assert.equal(data.absent, 2);
});

test('every 5 lates make one absence day, oldest lates first', async () => {
  const lates = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`, lessonIndex: 1, status: 'late',
  }));
  const tiles = await loadAttendanceTiles(lates);
  const data = await tiles.fetchStudentAttendanceData({}, 'student-1');
  assert.equal(tiles.LATES_PER_ABSENCE_DAY, 5);
  assert.equal(data.late, 12);
  assert.equal(data.lateAbsenceDays.length, 2);
  // Newest group first; each holds exactly five lates.
  assert.equal(data.lateAbsenceDays[0].number, 2);
  assert.deepEqual([...data.lateAbsenceDays[0].lates.map((r) => r.date)], ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  assert.deepEqual([...data.lateAbsenceDays[1].lates.map((r) => r.date)], ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  // Lates never touch the real absence-day counts.
  assert.equal(data.absent, 0);
});

test('four lates are not yet an absence day', async () => {
  const tiles = await loadAttendanceTiles(Array.from({ length: 4 }, (_, i) => ({ date: `2026-09-0${i + 1}`, lessonIndex: 1, status: 'late' })));
  const data = await tiles.fetchStudentAttendanceData({}, 'student-1');
  assert.equal(data.lateAbsenceDays.length, 0);
});
