const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../admins/absence.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function section(start, end) { return script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start))); }

test('absence page module parses', () => { new vm.SourceTextModule(script); });

test('school-year range spans the confirmed September and January boundaries', () => {
  const context = vm.createContext({ kuwaitTodayISO: () => '2027-01-01' });
  vm.runInContext(section('    function toISODateStr', '    // Classes'), context);
  const range = vm.runInContext("rangeForFilter('thisYear')", context);
  assert.equal(range.startISO, '2026-09-14');
  assert.equal(range.endISO, '2027-01-13');
});

test('school overview reads are shared with grade and class views; refresh invalidates them', async () => {
  let rosterReads = 0, attendanceReads = 0;
  const context = vm.createContext({
    fetchStudentsForScope: async () => { rosterReads++; return [{ id: 'a', name: 'A', class: '10-1' }, { id: 'b', name: 'B', class: '11-1' }]; },
    fetchAttendanceRowsForScope: async () => { attendanceReads++; return [{ class: '10-1' }, { class: '11-1' }]; },
    classesForScope: scope => scope.type === 'all' ? ['10-1', '11-1'] : ['10-1'],
    arabicSort: (a, b) => a.localeCompare(b),
  });
  vm.runInContext(section('    const dataCache', '    // A student marked absent'), context);
  const school = vm.runInContext("fetchAttendanceForScope({type:'all'}, '2026-09-14', '2026-09-14')", context);
  const grade = vm.runInContext("fetchAttendanceForScope({type:'grade',grade:10}, '2026-09-14', '2026-09-14')", context);
  await school;
  const result = await grade;
  assert.equal(result.students.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(rosterReads, 1);
  assert.equal(attendanceReads, 1);
  vm.runInContext('dataCache.clear()', context);
  await vm.runInContext("fetchAttendanceForScope({type:'all'}, '2026-09-14', '2026-09-14')", context);
  assert.equal(rosterReads, 2);
  assert.equal(attendanceReads, 2);
});

test('failed cached reads can be retried and pooled failures are not hidden', async () => {
  const context = vm.createContext({});
  vm.runInContext(section('    const dataCache', '    async function fetchAttendanceForScope'), context);
  await assert.rejects(vm.runInContext("cachedRead('test', () => Promise.reject(new Error('offline')))", context), /offline/);
  assert.equal(await vm.runInContext("cachedRead('test', () => 42)", context), 42);
  vm.runInContext(section('    async function promisePool', '    // Calendar-date'), context);
  await assert.rejects(vm.runInContext("promisePool([1,2], () => Promise.reject(new Error('denied')))", context), /denied/);
});
