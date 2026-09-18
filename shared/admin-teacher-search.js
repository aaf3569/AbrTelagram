import { collection, getDocs } from './firebase.js';
import { resolveDepartmentName } from './departments.js';
import { normalizeTeacherSearch, teacherLessonReport } from './teacher-lesson-report.js';

export function initAdminTeacherSearch(db) {
  const byId = id => document.getElementById(id);
  const dialog = byId('teacherSearchDialog');
  const search = byId('teacherSearchInput');
  const department = byId('teacherSearchDepartment');
  const teachers = byId('teacherSearchTeachers');
  const results = byId('teacherSearchResults');
  const status = byId('teacherSearchStatus');
  const refresh = byId('teacherSearchRefresh');
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  const periods = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
  let profiles = [], schedules = [], selectedUid = '', generation = 0;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function renderReport() {
    results.replaceChildren();
    const teacher = profiles.find(profile => profile.id === selectedUid);
    if (!teacher) {
      results.append(element('p', 'اختر معلّمًا لعرض حصصه.', 'muted'));
      return;
    }
    const lessons = teacherLessonReport(selectedUid, profiles, schedules);
    results.append(element('h3', teacher.name), element('p', `إجمالي الحصص الأسبوعية: ${lessons.length}`, 'teacher-search-total'));
    if (!lessons.length) {
      results.append(element('p', 'لا توجد حصص محفوظة لهذا المعلّم في الجدول الأساسي.', 'muted'));
      return;
    }
    const counts = element('div', undefined, 'teacher-search-counts');
    days.forEach((day, index) => counts.append(element('span', `${day}: ${lessons.filter(row => row.dayIndex === index).length}`, 'csv-chip')));
    results.append(counts);
    const conflicts = lessons.filter((row, index) => lessons.some((other, otherIndex) => otherIndex !== index && other.dayIndex === row.dayIndex && other.lesson === row.lesson));
    if (conflicts.length) results.append(element('p', 'تنبيه: توجد حصص في أكثر من فصل في الوقت نفسه.', 'warn'));
    const scroll = element('div', undefined, 'teacher-search-table');
    const table = element('table');
    const head = element('thead');
    const header = element('tr');
    ['اليوم', 'الحصة', 'الفصل', 'المادة'].forEach(label => {
      const cell = element('th', label); cell.scope = 'col'; header.append(cell);
    });
    head.append(header); table.append(head);
    const body = element('tbody');
    lessons.forEach(row => {
      const tr = element('tr');
      [days[row.dayIndex], periods[row.lesson - 1] || String(row.lesson), row.classKey, row.subject || '—']
        .forEach(value => tr.append(element('td', value)));
      body.append(tr);
    });
    table.append(body); scroll.append(table); results.append(scroll);
  }

  function filterTeachers() {
    const words = normalizeTeacherSearch(search.value).split(' ').filter(Boolean);
    const matches = profiles.filter(profile => (!department.value || profile.department === department.value)
      && words.every(word => normalizeTeacherSearch(profile.name).includes(word)));
    teachers.replaceChildren(new Option('اختر المعلّم…', ''));
    matches.forEach(profile => teachers.add(new Option(profile.name, profile.id)));
    if (!matches.some(profile => profile.id === selectedUid)) selectedUid = '';
    if (!selectedUid && matches.length === 1) selectedUid = matches[0].id;
    teachers.value = selectedUid;
    teachers.disabled = matches.length === 0;
    status.textContent = matches.length ? `عدد المعلّمين: ${matches.length}` : 'لا يوجد معلّمون مطابقون للبحث.';
    renderReport();
  }

  async function load() {
    const request = ++generation;
    const previousDepartment = department.value;
    search.disabled = department.disabled = teachers.disabled = refresh.disabled = true;
    status.textContent = 'جارٍ تحميل المعلّمين والحصص…';
    results.replaceChildren();
    try {
      const [teacherSnapshot, scheduleSnapshot] = await Promise.all([
        getDocs(collection(db, 'teachers')), getDocs(collection(db, 'schedules'))
      ]);
      if (request !== generation || !dialog.open) return;
      profiles = teacherSnapshot.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: doc.id,
          name: data.name || data.fullName || data.teacherName || data.displayName || data.email || doc.id,
          department: resolveDepartmentName(data.department || data.subject || '') || 'غير محدد' };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      schedules = scheduleSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      department.replaceChildren(new Option('جميع الأقسام', ''));
      [...new Set(profiles.map(profile => profile.department))].sort((a, b) => a.localeCompare(b, 'ar'))
        .forEach(name => department.add(new Option(name, name)));
      department.value = [...department.options].some(option => option.value === previousDepartment) ? previousDepartment : '';
      search.disabled = department.disabled = false;
      filterTeachers();
    } catch (error) {
      if (request !== generation || !dialog.open) return;
      console.error('[admin-teacher-search]', error);
      status.textContent = 'تعذّر تحميل البيانات. اضغط تحديث للمحاولة مرة أخرى.';
    } finally {
      if (request === generation) refresh.disabled = false;
    }
  }
  byId('teacherSearchBtn').addEventListener('click', () => {
    dialog.showModal();
    load();
  });
  byId('teacherSearchClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; });
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  search.addEventListener('input', filterTeachers);
  department.addEventListener('change', filterTeachers);
  teachers.addEventListener('change', () => { selectedUid = teachers.value; renderReport(); });
  refresh.addEventListener('click', load);
}
