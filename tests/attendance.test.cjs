// Run with: node --experimental-vm-modules --test tests/attendance.test.cjs
// Exercises the real browser module's public API and rendered controls. Only
// browser primitives and Firebase I/O are replaced; scheduling/time helpers run
// unchanged. No browser installation, credentials, or network is required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DATE = '2026-09-14';
const CLASS = '12 / 2 ع';
const LEGACY_ID = `${DATE}_6_12_-_2_`;
const SAFE_ID = `${DATE}_6_12_2_ع`;
const BELLS = [
  ['07:55', '08:40'], ['08:45', '09:30'], ['09:35', '10:20'],
  ['10:35', '11:20'], ['11:25', '12:10'], ['12:20', '13:05'],
  ['13:10', '13:55'],
].map(([start, end]) => ({ start, end }));

class TestTimestamp {
  constructor(value) { this.milliseconds = new Date(value).getTime(); }
  toDate() { return new Date(this.milliseconds); }
  toMillis() { return this.milliseconds; }
  static fromDate(value) { return new TestTimestamp(value); }
}

// A small DOM supporting the module's existing markup, selectors, and events.
// Parse the actual markup rather than duplicating its controls in test fixtures.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const on = force ?? !this.classList.contains(name);
        this.classList[on ? 'add' : 'remove'](name);
        return on;
      },
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'hidden' || name === 'disabled' || name === 'selected') this[name] = true;
  }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children.find(child => child.tagName !== '#TEXT') || null; }
  get childElementCount() { return this.children.filter(child => child.tagName !== '#TEXT').length; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.children = [];
    this.text = '';
    const stack = [this];
    const tokens = String(value).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
    for (const token of tokens) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith('<')) {
        const text = new Element('#text');
        text.textContent = token;
        stack.at(-1).appendChild(text);
        continue;
      }
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const child = new Element(tag);
      const attrs = token.slice(tag.length + 1, -1);
      for (const match of attrs.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        child.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
      }
      stack.at(-1).appendChild(child);
      if (!token.endsWith('/>') && !['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(child);
    }
  }
  get value() {
    if (this.tagName === 'SELECT' && this.explicitValue === undefined) {
      return (this.children.find(child => child.selected) || this.children[0])?.value || '';
    }
    return this.explicitValue ?? '';
  }
  set value(value) { this.explicitValue = String(value); }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const result = [];
    for (const group of selector.split(',')) {
      const parts = group.trim().split(/\s+/);
      const walk = (node) => {
        for (const child of node.children) {
          if (child.matches(parts.at(-1))) {
            let ancestor = child.parentNode;
            let index = parts.length - 2;
            while (index >= 0 && ancestor) {
              if (ancestor.matches(parts[index])) index--;
              ancestor = ancestor.parentNode;
            }
            if (index < 0) result.push(child);
          }
          walk(child);
        }
      };
      walk(this);
    }
    return [...new Set(result)];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(listener);
  }
  async click() {
    if (this.disabled) return;
    const event = { target: this, stopPropagation() {}, preventDefault() {} };
    if (this.onclick) await this.onclick(event);
    for (const listener of this.listeners.get('click') || []) await listener(event);
  }
  focus() {}
  blur() {}
}

function makeDocument() {
  const document = new Element('document');
  document.documentElement = document.appendChild(new Element('html'));
  document.head = document.documentElement.appendChild(new Element('head'));
  document.body = document.documentElement.appendChild(new Element('body'));
  document.createElement = tag => new Element(tag);
  document.createTextNode = value => { const node = new Element('#text'); node.textContent = value; return node; };
  document.getElementById = id => document.querySelector(`#${id}`);
  return document;
}

function sessionData(overrides = {}) {
  return {
    classKey: CLASS, date: DATE, lesson: 6, teacherUid: 'teacher-a',
    createdAt: new TestTimestamp(`${DATE}T10:02:57.003Z`),
    updatedAt: new TestTimestamp(`${DATE}T10:02:57.003Z`),
    sessionStartTs: new TestTimestamp(`${DATE}T09:20:00.000Z`),
    sessionCutoffTs: new TestTimestamp(`${DATE}T10:09:00.000Z`),
    ...overrides,
  };
}

async function fixture({ now = '13:03', bells = BELLS, sessionId = LEGACY_ID,
  session = sessionData(), schedules, custom = [], failLessonTimes = false,
  failedReads = [], heldReads = [] } = {}) {
  let clockMs = new Date(`${DATE}T${now}:00+03:00`).getTime();
  const documents = new Map([
    ['settings/lessonTimes', { times: bells }],
    ['teachers/teacher-a', { name: 'المعلم الأول' }],
    ['teachers/teacher-b', { name: 'المعلم الآخر' }],
  ]);
  const records = new Map();
  for (let index = 1; index <= 23; index++) {
    const uid = `student-${index}`;
    const status = index === 1 ? 'absent' : index === 2 ? 'late' : 'present';
    documents.set(`students/${uid}`, { class: CLASS, name: `طالب ${index}`, studentNumber: index });
    records.set(uid, status);
    if (session) {
      documents.set(`attendanceSessions/${sessionId}/attendanceRecords/${uid}`, { status, updatedBy: session.teacherUid });
      documents.set(`students/${uid}/attendance/${sessionId}`, {
        status, sessionId, createdBy: session.teacherUid, class: CLASS, date: DATE, lessonIndex: 6,
      });
    }
  }
  if (session) documents.set(`attendanceSessions/${sessionId}`, session);
  (schedules ?? [{ teacherUid: 'teacher-a', classKey: CLASS, lesson: '6', dayIndex: 1 }])
    .forEach((row, index) => documents.set(`schedules/row-${index}`, row));
  custom.forEach((row, index) => documents.set(`customDaySchedules/row-${index}`, row));

  const reads = [];
  const writes = [];
  const saved = [];
  const errors = [];
  const pendingReads = [];
  const document = makeDocument();
  const ref = (_db, ...segments) => ({ path: segments.join('/'), filters: [] });
  const snapshot = (key) => ({ id: key.split('/').at(-1), ref: { path: key }, exists: () => documents.has(key), data: () => documents.get(key) });
  const firebase = {
    doc: ref, collection: ref,
    where: (field, operator, value) => ({ field, operator, value }),
    query: (reference, ...filters) => ({ ...reference, filters }),
    getDoc: async (reference) => {
      reads.push(reference.path);
      if (failLessonTimes && reference.path === 'settings/lessonTimes') throw new Error('lesson times unavailable');
      if (failedReads.includes(reference.path)) throw new Error(`read unavailable: ${reference.path}`);
      return snapshot(reference.path);
    },
    getDocs: async (reference) => {
      reads.push(reference.path);
      if (failedReads.includes(reference.path)) throw new Error(`read unavailable: ${reference.path}`);
      if (heldReads.includes(reference.path)) {
        await new Promise(resolve => pendingReads.push({ path: reference.path, resolve }));
      }
      const prefix = `${reference.path}/`;
      const docs = [...documents.keys()].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .filter(key => (reference.filters || []).every(({ field, operator, value }) => {
          assert.equal(operator, '==', 'unexpected Firebase query operator');
          return documents.get(key)?.[field] === value;
        })).map(snapshot);
      return { docs, empty: docs.length === 0, size: docs.length, forEach: callback => docs.forEach(callback) };
    },
    serverTimestamp: () => new TestTimestamp(clockMs),
    Timestamp: TestTimestamp,
    writeBatch: () => {
      const pending = [];
      return {
        set: (reference, data, options) => pending.push({ path: reference.path, data, options }),
        commit: async () => {
          for (const write of pending) {
            writes.push(write);
            documents.set(write.path, write.options?.merge ? { ...documents.get(write.path), ...write.data } : write.data);
          }
        },
      };
    },
    setDoc: async () => { throw new Error('unexpected unbatched attendance write'); },
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockMs])); }
    static now() { return clockMs; }
  }
  const context = vm.createContext({
    document, HTMLElement: Element, Date: FixedDate, Intl, setTimeout, clearTimeout,
    window: { scrollY: 0, scrollTo() {} },
    console: { log() {}, warn() {}, group() {}, groupEnd() {}, table() {}, error: (...args) => errors.push(args) },
  });
  const firebaseModule = new vm.SyntheticModule(Object.keys(firebase), function () {
    for (const [name, value] of Object.entries(firebase)) this.setExport(name, value);
  }, { context });
  const modules = new Map([['/shared/firebase.js', firebaseModule]]);
  async function load(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    const source = await fs.readFile(path.join(ROOT, identifier), 'utf8');
    const module = new vm.SourceTextModule(source, { context, identifier });
    modules.set(identifier, module);
    await module.link(load);
    return module;
  }
  const attendance = await load('/shared/attendance.js');
  await attendance.evaluate();
  const sheet = attendance.namespace.mountAttendanceSheet({
    db: {}, auth: { currentUser: { uid: 'teacher-a' } }, onSaved: payload => saved.push(payload),
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    sheet, documents, reads, writes, saved, errors, records, settle, pendingReads,
    el: id => document.getElementById(id),
    async start() { await sheet.start(); await settle(); },
    advanceTo(time) { clockMs = new Date(`${DATE}T${time}:00+03:00`).getTime(); },
    async save() {
      await document.getElementById('attSubmitBtn').click();
      assert.ok(document.getElementById('attConfirmModal').classList.contains('open'), 'save confirmation opens');
      await document.getElementById('attConfirmSave').click();
      await settle();
    },
  };
}

function assertOpen(harness, { edit = false, lesson = 6 } = {}) {
  assert.ok(harness.el('attendanceSheet').classList.contains('open'), 'attendance sheet remains open');
  assert.equal(harness.el('attBlockedModal').classList.contains('open'), false, 'no already-taken interruption');
  assert.equal(harness.el('attErrorModal').classList.contains('open'), false, 'no load error');
  assert.equal(harness.el('attSubmitBtn').disabled, false, 'attendance can be saved');
  assert.equal(harness.el('attendanceList').querySelectorAll('.att-card').length, 23);
  assert.equal(harness.el('attLessonSelect').value, String(lesson));
  if (edit) assert.match(harness.el('attSheetTitle').textContent, /تعديل/);
  assert.deepEqual(harness.errors, []);
}

function customSchedule(start, end) {
  return {
    enabled: true, dayIndex: 1, classKey: CLASS, lessonCount: 6,
    lessons: [...Array.from({ length: 5 }, () => ({})), { teacherUid: 'teacher-a' }],
    times: [...BELLS.slice(0, 5), { start, end }],
  };
}

for (const sessionId of [LEGACY_ID, SAFE_ID]) {
  test(`start reopens own recorded lesson with all saved statuses (${sessionId})`, async () => {
    const harness = await fixture({ sessionId });
    await harness.start();
    assertOpen(harness, { edit: true });
    assert.equal(harness.el('attCountPresent').textContent, 'حضور: 21');
    assert.equal(harness.el('attCountLate').textContent, 'تأخير: 1');
    assert.equal(harness.el('attCountAbsent').textContent, 'غياب: 1');
    const cards = harness.el('attendanceList').querySelectorAll('.att-card');
    assert.ok(cards[0].querySelector('.seg .absent').classList.contains('active'));
    assert.ok(cards[1].querySelector('.seg .late').classList.contains('active'));
    assert.equal(harness.writes.length, 0, 'opening an existing lesson never writes or creates a duplicate');
  });
}

test('reopened legacy attendance saves in place and preserves attribution, timestamps, and student mirrors', async () => {
  const original = sessionData();
  const harness = await fixture({ session: original });
  await harness.start();
  assertOpen(harness, { edit: true });
  const first = harness.el('attendanceList').querySelector('.att-card');
  await first.querySelector('.seg .present').click();
  await harness.save();
  const stored = harness.documents.get(`attendanceSessions/${LEGACY_ID}`);
  assert.equal(stored.teacherUid, original.teacherUid);
  assert.equal(stored.createdAt.toMillis(), original.createdAt.toMillis());
  assert.equal(stored.sessionStartTs.toMillis(), original.sessionStartTs.toMillis());
  assert.equal(stored.sessionCutoffTs.toMillis(), original.sessionCutoffTs.toMillis());
  assert.equal(stored.updatedBy, 'teacher-a');
  assert.equal(stored.counts.present, 22);
  assert.equal(stored.counts.late, 1);
  assert.equal(stored.counts.absent, 0);
  assert.equal(harness.documents.has(`attendanceSessions/${SAFE_ID}`), false);
  for (const [uid, initialStatus] of harness.records) {
    const expected = uid === 'student-1' ? 'present' : initialStatus;
    assert.equal(harness.documents.get(`attendanceSessions/${LEGACY_ID}/attendanceRecords/${uid}`).status, expected);
    const mirror = harness.documents.get(`students/${uid}/attendance/${LEGACY_ID}`);
    assert.equal(mirror.status, expected);
    assert.equal(mirror.createdBy, 'teacher-a');
    assert.equal(mirror.sessionId, LEGACY_ID);
  }
  assert.equal(harness.saved.length, 1);
  assert.equal(harness.saved[0].mode, 'edit');
  assert.ok(harness.el('attSuccessModal').classList.contains('open'));
  assert.deepEqual(harness.errors, []);
});

test('moving lesson 6 bells later does not reopen an earlier expired legacy session or offer editing', async () => {
  const bells = BELLS.map((bell, index) => index === 5 ? { start: '14:20', end: '16:05' }
    : index === 6 ? { start: '16:10', end: '18:55' } : bell);
  const original = sessionData();
  const harness = await fixture({ now: '14:30', bells, session: original });
  await harness.start();
  assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
  assert.ok(harness.el('attBlockedModal').classList.contains('open'));
  assert.equal(harness.el('attBlockedEdit').hidden, true, 'expired saved cutoff cannot advertise editing');
  assert.doesNotMatch(harness.el('attBlockedBody').textContent, /يمكنك تعديل/);
  assert.equal(harness.sheet.canEditSession(original), false);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.documents.get(`attendanceSessions/${LEGACY_ID}`), original);
});

test('another teacher\'s attendance stays blocked and identifies who recorded it', async () => {
  const original = sessionData({ teacherUid: 'teacher-b' });
  const harness = await fixture({ session: original });
  await harness.start();
  assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
  assert.ok(harness.el('attBlockedModal').classList.contains('open'));
  assert.match(harness.el('attBlockedBody').textContent, /المعلم الآخر/);
  assert.equal(harness.el('attBlockedEdit').hidden, true);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.documents.get(`attendanceSessions/${LEGACY_ID}`), original);
});

test('legacy ID collision with the sibling Arabic track allows a distinct new session', async () => {
  const sibling = sessionData({ classKey: '12 / 2 د', teacherUid: 'teacher-b' });
  const harness = await fixture({ session: sibling });
  await harness.start();
  assertOpen(harness);
  assert.equal(harness.writes.length, 0);
  await harness.save();
  assert.equal(harness.documents.get(`attendanceSessions/${LEGACY_ID}`), sibling);
  assert.equal(harness.documents.get(`attendanceSessions/${SAFE_ID}`).classKey, CLASS);
  assert.equal(harness.documents.get(`attendanceSessions/${SAFE_ID}`).teacherUid, 'teacher-a');
  assert.equal(harness.saved[0].mode, 'self');
});

for (const mismatch of [{ date: '2026-09-13' }, { lesson: 5 }]) {
  test(`a document whose stored session identity differs does not block lesson 6: ${JSON.stringify(mismatch)}`, async () => {
    const harness = await fixture({ session: sessionData(mismatch) });
    await harness.start();
    assertOpen(harness);
    assert.doesNotMatch(harness.el('attSheetTitle').textContent, /تعديل/);
    assert.equal(harness.writes.length, 0);
  });
}

for (const [start, end] of [['11:00', '11:45'], ['14:00', '14:45']]) {
  test(`custom lesson outside its own ${start}–${end} window cannot fall through to global lesson 6`, async () => {
    const harness = await fixture({ now: '12:30', session: null, custom: [customSchedule(start, end)] });
    await harness.start();
    assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
    assert.ok(harness.el('attBlockedModal').classList.contains('open'));
    assert.equal(harness.writes.length, 0);
    const current = await harness.sheet.getCurrentLessonClass(false);
    assert.equal(current.ok, false, 'attendance log resolves the same custom schedule window');
  });
}

test('active custom lesson outside global bells reopens its own saved attendance', async () => {
  const harness = await fixture({
    now: '14:30', custom: [customSchedule('14:00', '14:45')],
    session: sessionData({
      sessionStartTs: new TestTimestamp(`${DATE}T11:00:00Z`),
      sessionCutoffTs: new TestTimestamp(`${DATE}T11:49:00Z`),
    }),
  });
  await harness.start();
  assertOpen(harness, { edit: true });
  assert.equal(harness.el('attCountAbsent').textContent, 'غياب: 1');
  assert.equal(harness.writes.length, 0);
  const current = await harness.sheet.getCurrentLessonClass(false);
  assert.equal(current.ok, true);
  assert.equal(current.classKey, CLASS);
  assert.equal(current.lesson, 6);
});

test('edit confirmation cannot save after the recorded cutoff expires', async () => {
  const harness = await fixture();
  await harness.start();
  assertOpen(harness, { edit: true });
  await harness.el('attSubmitBtn').click();
  assert.ok(harness.el('attConfirmModal').classList.contains('open'));
  harness.advanceTo('13:10');
  await harness.el('attConfirmSave').click();
  assert.equal(harness.writes.length, 0);
  assert.ok(harness.el('attErrorModal').classList.contains('open'));
  assert.match(harness.el('attErrorBody').textContent, /انتهت مهلة/);
});

test('failed bell-time read never guesses a lesson from defaults', async () => {
  const harness = await fixture({ session: null, failLessonTimes: true });
  await harness.start();
  assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
  assert.ok(harness.el('attBlockedModal').classList.contains('open'));
  assert.match(harness.el('attBlockedBody').textContent, /أوقات الحصص/);
  assert.equal(harness.writes.length, 0);
});

for (const failedPath of [`attendanceSessions/${SAFE_ID}`, `attendanceSessions/${LEGACY_ID}/attendanceRecords`]) {
  test(`failed attendance read closes the sheet without creating or replacing records: ${failedPath}`, async () => {
    const original = sessionData();
    const harness = await fixture({ session: original, failedReads: [failedPath] });
    await harness.start();
    assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
    assert.ok(harness.el('attErrorModal').classList.contains('open'));
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.documents.get(`attendanceSessions/${LEGACY_ID}`), original);
    assert.equal(harness.documents.has(`attendanceSessions/${SAFE_ID}`), false);
    assert.equal(harness.el('attSubmitBtn').disabled, true);
  });
}

test('custom replacement with differently spaced class label suppresses the main teacher\'s lesson', async () => {
  const custom = customSchedule('12:20', '13:05');
  custom.classKey = '12/2 ع';
  custom.lessons[5].teacherUid = 'teacher-b';
  const harness = await fixture({ session: null, custom: [custom] });
  await harness.start();
  assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
  assert.ok(harness.el('attBlockedModal').classList.contains('open'));
  assert.equal(harness.writes.length, 0);
});

test('a recorded custom lesson in grace does not hide an untaken normal lesson in progress', async () => {
  const otherClass = '11 / 1';
  const custom = {
    enabled: true, dayIndex: 1, classKey: otherClass, lessonCount: 1,
    lessons: [{ teacherUid: 'teacher-a' }], times: [{ start: '12:10', end: '12:27' }],
  };
  const earlier = sessionData({
    classKey: otherClass, lesson: 1,
    sessionStartTs: new TestTimestamp(`${DATE}T09:10:00Z`),
    sessionCutoffTs: new TestTimestamp(`${DATE}T09:31:00Z`),
  });
  const harness = await fixture({
    now: '12:30', custom: [custom], session: earlier, sessionId: `${DATE}_1_11_1`,
  });
  await harness.start();
  assertOpen(harness);
  assert.doesNotMatch(harness.el('attSheetTitle').textContent, /تعديل/);
  assert.equal(harness.writes.length, 0);
  await harness.save();
  assert.equal(harness.saved[0].mode, 'self');
  assert.equal(harness.saved[0].classKey, CLASS);
  assert.equal(harness.documents.get(`attendanceSessions/${DATE}_1_11_1`), earlier);
});

test('saved statuses must finish loading before the reopened sheet enables saving', async () => {
  const harness = await fixture({ heldReads: [`attendanceSessions/${LEGACY_ID}/attendanceRecords`] });
  const opening = harness.sheet.start();
  await harness.settle();
  assert.ok(harness.pendingReads.length > 0, 'saved attendance is still loading');
  assert.ok(harness.el('attendanceSheet').classList.contains('open'), 'loading feedback is already visible');
  assert.equal(harness.el('attSubmitBtn').disabled, true);
  await harness.el('attSubmitBtn').click();
  assert.equal(harness.el('attConfirmModal').classList.contains('open'), false);
  // History and editable statuses may load together. Resolve their responses
  // independently to catch controls becoming usable after only a partial load.
  while (harness.pendingReads.length) {
    harness.pendingReads.shift().resolve();
    await harness.settle();
    if (harness.pendingReads.length) assert.equal(harness.el('attSubmitBtn').disabled, true);
  }
  await opening;
  assertOpen(harness, { edit: true });
  assert.equal(harness.el('attCountAbsent').textContent, 'غياب: 1');
  assert.equal(harness.el('attCountLate').textContent, 'تأخير: 1');
  assert.equal(harness.writes.length, 0);
});

test('an inactive custom lesson for a different class cannot displace the same normal lesson number', async () => {
  const custom = customSchedule('14:00', '14:45');
  custom.classKey = '11 / 1';
  const harness = await fixture({ now: '12:30', session: null, custom: [custom] });
  await harness.start();
  assertOpen(harness);
  const current = await harness.sheet.getCurrentLessonClass(false);
  assert.equal(current.classKey, CLASS);
  assert.equal(current.lesson, 6);
  assert.equal(harness.writes.length, 0);
});

for (const mismatch of [{ classKey: '12 / 2 د' }, { date: '2026-09-13' }, { lesson: 5 }]) {
  test(`an inconsistent existing safe ID cannot be overwritten: ${JSON.stringify(mismatch)}`, async () => {
    const original = sessionData(mismatch);
    const harness = await fixture({ sessionId: SAFE_ID, session: original });
    await harness.start();
    assert.equal(harness.el('attendanceSheet').classList.contains('open'), false);
    assert.ok(harness.el('attErrorModal').classList.contains('open'));
    assert.equal(harness.el('attSubmitBtn').disabled, true);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.documents.get(`attendanceSessions/${SAFE_ID}`), original);
  });
}
