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
