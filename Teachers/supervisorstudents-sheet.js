/* ========= الطلاب sheet logic (svs*) =========
   Ported from /supervisors/supervisorstudents.html — that page is never
   navigated to or edited, this is that page's own script running as a
   second, separately-scoped module loaded by beta/userbeta.html (kept in
   its own file/module instead of folded into that page's own main script,
   specifically so its ~150 top-level identifiers — db, show, closeSheet,
   toast-alikes, etc — can't collide with that page's own). It only makes
   sense loaded from userbeta.html: it operates on #supervisorStudentsSheet's
   markup (see that file), and relies on module execution order to run
   after that page's own main script has already called
   initializeApp/initializeFirestore, so getApp()/getFirestore(app)/
   getAuth(app) here resolve to the exact same app/db/auth that page
   already set up — no second Firebase instance, no persistence-lock
   contention, no auth desync (that's what the earlier iframe version of
   this sheet got wrong). Deep-linking via the URL (?student=/#/student/...)
   is disabled below since it would clobber the outer #supervisorStudentsSheet
   sheet's own #supervisorstudents history entry; opening a student is
   still one click away either way. */
  import {
    firebaseConfig, initializeApp, getApp, getApps, getAuth, onAuthStateChanged, getFirestore,
    collection, getDocs, query, where, orderBy, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
  } from "/shared/firebase.js";
  import { getTeacherProfile, hasGuardAccess } from "/shared/auth-guard.js";
  import { fetchStudentAttendanceData, makeAttTile, makeMorningLateTile } from "/shared/attendance-tiles.js";
  import { renderWarningState, renderExcusedWarningState } from "/shared/warning-system.js";
  import { fetchClassList, groupByGrade } from "/shared/class-registry.js";

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);

/* ========= UI refs ========= */
const sLoading = document.getElementById('stateLoading');
const sNotLog = document.getElementById('stateNotLogged');
const sDenied = document.getElementById('stateDenied');
const sClasses = document.getElementById('stateClasses');
const classesFloatingBack = document.getElementById('classesFloatingBack');
const list10 = document.getElementById('list10');
const list11 = document.getElementById('list11');
const list12 = document.getElementById('list12');
const classSheet = document.getElementById('classSheet');
const closeClass = document.getElementById('closeClass');
const classTitle = document.getElementById('classTitle');
const classNameStrong = document.getElementById('classNameStrong');
const refreshStudents = document.getElementById('refreshStudents');
const openAddStudent = document.getElementById('openAddStudent');
const addStudentForm = document.getElementById('addStudentForm');
const stName = document.getElementById('stName');
const stCivil = document.getElementById('stCivil');
const createStudentBtn = document.getElementById('createStudentBtn');
const asOk = document.getElementById('asOk');
const asErr = document.getElementById('asErr');
const studentsList = document.getElementById('studentsList');
const studentSheet = document.getElementById('studentSheet');
const closeStudent = document.getElementById('closeStudent');
const studentTitle = document.getElementById('studentTitle');
// Collapsible header refs
const studentHeaderCard = document.getElementById('studentHeaderCard');
const studentHeaderName = document.getElementById('studentHeaderName');
const studentHeaderClass = document.getElementById('studentHeaderClass');
const studentCollapseBody= document.getElementById('studentCollapseBody');
// Hidden edit refs
const edSName = document.getElementById('edSName');
const edSCivil = document.getElementById('edSCivil');
const saveStudent = document.getElementById('saveStudent');
const deleteStudent = document.getElementById('deleteStudent');
const edOk = document.getElementById('edOk');
const edErr = document.getElementById('edErr');
// Analytics
const totPresent = document.getElementById('totPresent');
const totAbsent = document.getElementById('totAbsent');
const totLate = document.getElementById('totLate');
const absencesList = document.getElementById('absencesList');
const latesList = document.getElementById('latesList');
const absentCountPill = document.getElementById('absentCountPill');
const lateCountPill = document.getElementById('lateCountPill');
// Tabs
const tabCommit = document.getElementById('tabCommit');
const tabEnroll = document.getElementById('tabEnroll');
const tabReport = document.getElementById('tabReport');
const tabNote = document.getElementById('tabNote');
const panelCommit = document.getElementById('panelCommit');
const panelEnroll = document.getElementById('panelEnroll');
const panelReport = document.getElementById('panelReport');
const panelNote = document.getElementById('panelNote');
// Commitments refs
const addCommitBtn = document.getElementById('addCommitBtn');
const commitQuick = document.getElementById('commitQuick');
const commitTitle = document.getElementById('commitTitle');
const commitReason= document.getElementById('commitReason');
const commitDue = document.getElementById('commitDue');
const commitAudience = document.getElementById('commitAudience');
const commitSave = document.getElementById('commitSave');
const commitCancel = document.getElementById('commitCancel');
const commitList = document.getElementById('commitList');
const commitEmpty = document.getElementById('commitEmpty');
// Enrollments refs
const addEnrollBtn = document.getElementById('addEnrollBtn');
const enrollQuick = document.getElementById('enrollQuick');
const enrollTitle = document.getElementById('enrollTitle');
const enrollReason = document.getElementById('enrollReason');
const enrollLength = document.getElementById('enrollLength');
const enrollFrom = document.getElementById('enrollFrom');
const enrollTo = document.getElementById('enrollTo');
const enrollSave = document.getElementById('enrollSave');
const enrollCancel = document.getElementById('enrollCancel');
const enrollList = document.getElementById('enrollList');
const enrollEmpty = document.getElementById('enrollEmpty');
// Reports refs
const addReportBtn = document.getElementById('addReportBtn');
const reportQuick = document.getElementById('reportQuick');
const reportType = document.getElementById('reportType');
const reportTitle = document.getElementById('reportTitle');
const reportReason = document.getElementById('reportReason');
const reportDate = document.getElementById('reportDate');
const reportSave = document.getElementById('reportSave');
const reportCancel = document.getElementById('reportCancel');
const reportList = document.getElementById('reportList');
const reportEmpty = document.getElementById('reportEmpty');
// Notes refs
const addNoteBtn = document.getElementById('addNoteBtn');
const noteQuick = document.getElementById('noteQuick');
const noteBody = document.getElementById('noteBody');
const noteType = document.getElementById('noteType');
const notePinned = document.getElementById('notePinned');
const noteSave = document.getElementById('noteSave');
const noteCancel = document.getElementById('noteCancel');
const noteList = document.getElementById('noteList');
const noteEmpty = document.getElementById('noteEmpty');
// Detail sheet
const attDetailSheet = document.getElementById('attDetailSheet');
const closeAttDetail = document.getElementById('closeAttDetail');
const editAttBtn = document.getElementById('editAttBtn');
const attDetailTitle = document.getElementById('attDetailTitle');
const attDetailBody = document.getElementById('attDetailBody');
const dBadge = document.getElementById('dBadge');
const dDate = document.getElementById('dDate');
const dLesson = document.getElementById('dLesson');
const dClass = document.getElementById('dClass');
const dTeacher = document.getElementById('dTeacher');
const dCreatedAt = document.getElementById('dCreatedAt');
const dUpdatedAt = document.getElementById('dUpdatedAt');
// Edit status form
const statusEditForm = document.getElementById('statusEditForm');
const statusOptions = document.querySelectorAll('.status-option');
const saveStatusBtn = document.getElementById('saveStatusBtn');
const cancelStatusBtn = document.getElementById('cancelStatusBtn');
const recordDetailSheet = document.getElementById('recordDetailSheet');
const closeRecordDetail = document.getElementById('closeRecordDetail');
const recordDetailTitle = document.getElementById('recordDetailTitle');
const recordDetailBody = document.getElementById('recordDetailBody');
const paperPreviewPage = document.getElementById('paperPreviewPage');
const paperPreviewBody = document.getElementById('paperPreviewBody');
const paperDocType = document.getElementById('paperDocType');
const paperStudentLine = document.getElementById('paperStudentLine');
const paperClassLine = document.getElementById('paperClassLine');
const paperReasonLine = document.getElementById('paperReasonLine');
const paperDateLine = document.getElementById('paperDateLine');
const paperCreatorLine = document.getElementById('paperCreatorLine');
const saveRecordPdf = document.getElementById('saveRecordPdf');

// NEW: Special case UI references
const stSpecialCase = document.getElementById('stSpecialCase');
const edSSpecialCase = document.getElementById('edSSpecialCase');
const filterSpecialCases = document.getElementById('filterSpecialCases');

// Statistics UI references
const statsPeriod = document.getElementById('statsPeriod');
const customDateRange = document.getElementById('customDateRange');
const statsFrom = document.getElementById('statsFrom');
const statsTo = document.getElementById('statsTo');
const statsTotalPresent = document.getElementById('statsTotalPresent');
const statsTotalAbsent = document.getElementById('statsTotalAbsent');
const statsTotalLate = document.getElementById('statsTotalLate');
const statsInsight = document.getElementById('statsInsight');
const statsDailySummary = document.getElementById('statsDailySummary');
const warningAbsenceCount = document.getElementById('warningAbsenceCount');
const warningLevelBadge = document.getElementById('warningLevelBadge');
const warningProgressFill = document.getElementById('warningProgressFill');
const warningNextHint = document.getElementById('warningNextHint');
const warningExcusedCount = document.getElementById('warningExcusedCount');
const warningLevelBadgeExcused = document.getElementById('warningLevelBadgeExcused');
const warningProgressFillExcused = document.getElementById('warningProgressFillExcused');
const warningNextHintExcused = document.getElementById('warningNextHintExcused');
const quickFormBackdrop = document.getElementById('quickFormBackdrop');

/* ========= Global variables ========= */
let currentUserRole = '';
let currentUserIsSupervisor = false;
let showOnlySpecialCases = false;
let selectedClass = null;
let currentStudent = { id:null, data:null };
let currentStudentAttendance = [];
let currentAttendanceRecord = null;
let currentDetailDocType = '';
let currentDetailRows = [];
let currentDetailCreatedByUid = '';
let isDownloadingPaperPdf = false;
let classStatistics = {
  totalPresent: 0,
  totalAbsent: 0,
  totalLate: 0,
  weeklyData: [],
  monthlyData: [],
  attendanceByDay: {},
  attendanceByStudent: {}
};
const STUDENT_ROUTE_PARAM = 'student';
const CLASS_ROUTE_PARAM = 'class';

/* ========= Helpers ========= */
function syncClassesBackVisibility(){
  const mainVisible = sClasses.classList.contains('active');
  const hasOpenSheet =
    classSheet.classList.contains('open') ||
    studentSheet.classList.contains('open') ||
    attDetailSheet.classList.contains('open') ||
    recordDetailSheet.classList.contains('open');
  classesFloatingBack?.classList.toggle('show', mainVisible && !hasOpenSheet);
}

const show = (el)=> { [sLoading, sNotLog, sDenied, sClasses].forEach(x=>x.classList.remove('active')); el.classList.add('active'); syncClassesBackVisibility(); };
const openSheet = (el)=> { el.classList.add('open'); el.setAttribute('aria-hidden','false'); syncClassesBackVisibility(); };
const closeSheet = (el)=> {
  el.classList.remove('open');
  // Closing a sheet is nearly always a click on a button inside it, so that
  // button still holds focus here. aria-hidden on an ancestor of the focused
  // element is invalid and Chrome refuses it, so release focus first.
  if (el && el.contains(document.activeElement)) document.activeElement.blur();
  el.setAttribute('aria-hidden','true');
  syncClassesBackVisibility();
};
const toArabicDigits = (str) => (str||"").toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const arabicSort = (a,b) => (a||"").toString().localeCompare((b||"").toString(), 'ar', {sensitivity:'base'});
const fmtDate = (d)=> new Intl.DateTimeFormat('ar-KW', { dateStyle:'medium', timeZone:'Asia/Kuwait' }).format(d);
const fmtDT = (d)=> new Intl.DateTimeFormat('ar-KW', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Kuwait' }).format(d);
function tsToDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); if(v.seconds) return new Date(v.seconds*1000); return null; }
const slugifyClass = (s)=> (s||'').replace(/\s+/g,'').replace(/\//g,'-');

// Runs `worker` over `items` with at most `limit` requests in flight at
// once, and returns the results in input order. Firestore reads are
// latency-bound, not CPU-bound, so awaiting them one at a time makes a page
// wait for the sum of every round trip instead of roughly the slowest one.
// Errors propagate, so a caller's try/catch behaves the same as it did when
// the reads were sequential.
async function mapWithLimit(items, worker, limit = 12){
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// Performance optimization: Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getRouteStudentId(){ return null; }
function getRouteClassName(){ return null; }
function buildStudentUrl(studentId, className){
  const next = new URL(window.location.href);
  next.searchParams.delete(STUDENT_ROUTE_PARAM);
  if(className) next.searchParams.set(CLASS_ROUTE_PARAM, className);
  else next.searchParams.delete(CLASS_ROUTE_PARAM);
  next.hash = studentId ? `/student/${encodeURIComponent(studentId)}` : '';
  return `${next.pathname}${next.search}${next.hash}`;
}
function setStudentRoute(){ /* no-op: would clobber the outer sheet history entry */ }
function clearStudentRoute(){ /* no-op */ }
async function applyStudentRoute(){
  const routeStudentId = getRouteStudentId();
  const routeClassName = getRouteClassName();
  if(!routeStudentId){
    closeSheet(studentSheet);
    return;
  }
  if(routeClassName){
    selectedClass = routeClassName;
  }
  await openStudentEditor(routeStudentId, { syncRoute:false });
}

/* ========= Auth + role ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ show(sNotLog); return; }
  try{
    const data = await getTeacherProfile(db, user.uid);
    if(!data){
      show(sDenied);
      return;
    }
    const access = hasGuardAccess(data, {
      allowedRoles: ['admin'],
      allowSupervisor: true,
      permissionPath: 'permissions.allowSupervisorStudents'
    });
    currentUserRole = access.role;
    currentUserIsSupervisor = access.isSupervisor;

    // Allow only admins and supervisors
    if (!access.allowed) {
      show(sDenied);
      return;
    }
    
    // Apply role-based restrictions
    if((currentUserIsSupervisor || access.permissionGranted) && currentUserRole !== 'admin') {
      // Hide only restricted admin actions for supervisor
      openAddStudent.style.display = 'none';
      createStudentBtn.style.display = 'none';
      saveStudent.style.display = 'none';
      deleteStudent.style.display = 'none';
      editAttBtn.style.display = 'none';
      saveStatusBtn.style.display = 'none';
    }
    
    show(sClasses);
    const grouped = groupByGrade(await fetchClassList(db));
    GROUP_10 = grouped['10']; GROUP_11 = grouped['11']; GROUP_12 = grouped['12'];
    renderGroups();
    await applyStudentRoute();
  }catch(e){ console.error(e); show(sDenied); }
});

/* ========= Class options (grouped) ========= */
// Populated from settings/classes inside onAuthStateChanged above, right
// before the one-time renderGroups() call moved there too (previously ran
// unconditionally at parse time against a hardcoded array).
let GROUP_10 = [], GROUP_11 = [], GROUP_12 = [];

function makeClassButton(val){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'subject class-option';
  btn.innerHTML = `<span>${toArabicDigits(val)}</span>`;
  btn.addEventListener('click', ()=> openClass(val));
  return btn;
}

function renderGroups(){
  list10.innerHTML=''; list11.innerHTML=''; list12.innerHTML='';
  GROUP_10.forEach(v => list10.appendChild(makeClassButton(v)));
  GROUP_11.forEach(v => list11.appendChild(makeClassButton(v)));
  GROUP_12.forEach(v => list12.appendChild(makeClassButton(v)));
  // accordion toggles
  document.querySelectorAll('.group > .subject').forEach(head=>{
    head.addEventListener('click', (e)=>{ const g = e.currentTarget.parentElement; g.classList.toggle('open'); });
  });
}

/* ========= Class page ========= */
function openClass(className){
  selectedClass = className;
  classTitle.textContent = toArabicDigits(className);
  classNameStrong.textContent = toArabicDigits(className);
  addStudentForm.style.display = 'none';
  asOk.style.display='none'; asErr.style.display='none';
  openSheet(classSheet);
  loadStudents(className);
  loadClassStatistics(className); // Load statistics when opening a class
}

closeClass.addEventListener('click', ()=> closeSheet(classSheet));
document.addEventListener('keydown', (e)=>{
  if(e.key!=='Escape') return;
  closeAllQuickForms();
  closeSheet(recordDetailSheet);
  closeSheet(attDetailSheet);
  if(studentSheet.classList.contains('open') || getRouteStudentId()){
    closeStudentView();
    return;
  }
  closeSheet(classSheet);
});

openAddStudent.addEventListener('click', ()=>{
  addStudentForm.style.display = addStudentForm.style.display==='none' ? 'block' : 'none';
  asOk.style.display='none'; asErr.style.display='none';
  if(addStudentForm.style.display==='block'){ stName.focus(); }
});

refreshStudents.addEventListener('click', ()=>{ 
  if(selectedClass) {
    loadStudents(selectedClass);
    loadClassStatistics(selectedClass);
  }
});

// MODIFIED: loadStudents function with filtering and special case icon
async function loadStudents(className){
  studentsList.innerHTML='<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل بيانات الطلاب...</div></div>';
  try{
    const qy = query(collection(db,'students'), where('class','==', className));
    const snap = await getDocs(qy);
    const arr = [];
    snap.forEach(d=> arr.push({ id:d.id, ...d.data() }) );
    
    // Apply filter if active
    const filteredArr = showOnlySpecialCases 
      ? arr.filter(st => st.specialCase === true)
      : arr;
    
    filteredArr.sort((a,b)=>{
      const aParsed = Number(a.studentNumber);
      const bParsed = Number(b.studentNumber);
      const aNum = Number.isFinite(aParsed) ? aParsed : 99999;
      const bNum = Number.isFinite(bParsed) ? bParsed : 99999;
      if (aNum !== bNum) return aNum - bNum;
      return arabicSort(a.name, b.name);
    });
    
    if(filteredArr.length===0){
      const empty=document.createElement('div');
      empty.className='item';
      empty.textContent = showOnlySpecialCases 
        ? 'لا توجد حالات خاصة.' 
        : 'لا يوجد طلاب بعد.';
      studentsList.innerHTML = '';
      studentsList.appendChild(empty);
      return;
    }
    
    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();
    filteredArr.forEach((st, idx)=>{
      const el=document.createElement('div');
      el.className='item will-change';
      el.setAttribute('data-id', st.id);
      const parsedNumber = Number(st.studentNumber);
      const studentNumber = Number.isFinite(parsedNumber) ? parsedNumber : (idx + 1);
      
      // NEW: Add special case icon if needed
      const specialCaseIcon = st.specialCase 
        ? `<img src="https://framerusercontent.com/images/1WGQfyxwD42xkLmxrJ71sDcY.png?width=266&height=267" class="special-case-icon" alt="حالة خاصة">`
        : '';
      
      el.innerHTML = `
        <div>
          <div>${specialCaseIcon} ${st.name || '—'} <span class="item-number">${toArabicDigits(studentNumber)}</span></div>
          <div class="sub">${st.civilid ? ('رقم المستخدم: '+ toArabicDigits(st.civilid)) : ''}</div>
        </div>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      `;
      el.addEventListener('click', ()=> openStudentEditor(st.id, { syncRoute:true }));
      fragment.appendChild(el);
    });
    studentsList.innerHTML = '';
    studentsList.appendChild(fragment);
  }catch(e){
    console.error('[loadStudents]', e);
    const err=document.createElement('div');
    err.className='item';
    err.textContent='تعذّر تحميل القائمة.';
    studentsList.innerHTML = '';
    studentsList.appendChild(err);
  }
}

// NEW: Toggle filter function
filterSpecialCases.addEventListener('click', ()=>{
  showOnlySpecialCases = !showOnlySpecialCases;
  filterSpecialCases.textContent = showOnlySpecialCases 
    ? 'عرض كل الطلاب' 
    : 'عرض الحالات الخاصة فقط';
  
  filterSpecialCases.classList.toggle('filter-active', showOnlySpecialCases);
  
  if(selectedClass) loadStudents(selectedClass);
});

// MODIFIED: Add student function with specialCase field - only for admin
createStudentBtn.addEventListener('click', async ()=>{
  if(currentUserIsSupervisor) return;
  
  asOk.style.display='none';
  asErr.style.display='none';
  try{
    const name = (stName.value||'').trim();
    const civilid = (stCivil.value||'').trim();
    const cls = selectedClass;
    const specialCase = stSpecialCase.checked; // NEW: Get checkbox state
    
    if(!cls) throw new Error('لم يتم تحديد فصل.');
    if(!name) throw new Error('أدخل اسم الطالب.');
    
    const ref = doc(collection(db,'students'));
    await setDoc(ref, { 
      uid: ref.id, 
      name, 
      civilid, 
      class: cls, 
      specialCase, // NEW: Store specialCase field
      createdAt: serverTimestamp() 
    }, { merge:true });
    
    asOk.textContent='تم إضافة الطالب.';
    asOk.style.display='block';
    stName.value='';
    stCivil.value='';
    stSpecialCase.checked = false; // NEW: Reset checkbox
    
    await loadStudents(cls);
  }catch(e){
    asErr.textContent = e?.message || 'تعذّر الإضافة.';
    asErr.style.display='block';
  }
});

/* ========= Student editor ========= */
const teacherNameCache = new Map();

// MODIFIED: openStudentEditor function to load specialCase value
async function openStudentEditor(id, { syncRoute=true } = {}){
  edOk.style.display='none';
  edErr.style.display='none';
  try{
    const ref = doc(db,'students', id);
    const s = await getDoc(ref);
    if(!s.exists()){ alert('السجل غير موجود.'); return; }
    const d = s.data();
    currentStudent = { id, data:d };
    
    // Header content
    studentTitle.textContent = `بيانات: ${d.name || id}`;
    studentHeaderName.textContent = d.name || '—';
    studentHeaderClass.textContent = d.class ? `الفصل: ${toArabicDigits(d.class)}` : '—';
    
    // Fill collapsed inputs - only for admin
    if(!currentUserIsSupervisor) {
      edSName.value = d.name || '';
      edSCivil.value = d.civilid || '';
      edSSpecialCase.checked = d.specialCase || false; // NEW: Set checkbox state
    }
    
    openSheet(studentSheet);
    if(syncRoute){
      setStudentRoute(id, selectedClass || d.class || null);
    }
    await loadStudentAttendance(id);
    
    // Load tabs for both admin and supervisor
    await Promise.all([
      loadCommitments(id),
      loadEnrollments(id),
      loadReports(id),
      loadNotes(id)
    ]);
  }catch(e){
    console.error('[openStudentEditor]', e);
    alert('تعذّر فتح صفحة الطالب.');
  }
}

// Toggle collapse
studentHeaderCard.addEventListener('click', ()=>{ 
  // Only allow editing for admin
  if(!currentUserIsSupervisor) {
    studentCollapseBody.classList.toggle('open'); 
  }
});

function closeStudentView(){
  closeAllQuickForms();
  closeSheet(recordDetailSheet);
  if(getRouteStudentId()){
    clearStudentRoute();
  }
  closeSheet(studentSheet);
  if(selectedClass){
    openSheet(classSheet);
    loadStudents(selectedClass);
  }
}
closeStudent.addEventListener('click', closeStudentView);

// MODIFIED: saveStudent function to update specialCase field - only for admin
saveStudent.addEventListener('click', async ()=>{
  if(currentUserIsSupervisor) return;
  
  edOk.style.display='none';
  edErr.style.display='none';
  try{
    const { id } = currentStudent;
    if(!id) throw new Error('لم يتم اختيار طالب.');
    const name = (edSName.value||'').trim();
    const civilid = (edSCivil.value||'').trim();
    const specialCase = edSSpecialCase.checked; // NEW: Get checkbox state
    
    if(!name) throw new Error('أدخل الاسم.');
    
    await updateDoc(doc(db,'students', id), { 
      name, 
      civilid, 
      specialCase, // NEW: Update specialCase field
      updatedAt: serverTimestamp() 
    });
    
    studentHeaderName.textContent = name;
    edOk.textContent = 'تم حفظ التعديلات.';
    edOk.style.display='block';
    setTimeout(()=>{ edOk.style.display='none'; }, 900);
    
    if(selectedClass) await loadStudents(selectedClass);
  }catch(e){
    edErr.textContent = e?.message || 'تعذّر الحفظ.';
    edErr.style.display='block';
  }
});

// MODIFIED: deleteStudent function - only for admin
deleteStudent.addEventListener('click', async ()=>{
  if(currentUserIsSupervisor) return;
  
  edOk.style.display='none';
  edErr.style.display='none';
  try{
    const { id } = currentStudent;
    if(!id) return;
    if(!confirm('حذف سجل الطالب؟')) return;
    await deleteDoc(doc(db,'students', id));
    edOk.textContent='تم الحذف.';
    edOk.style.display='block';
    setTimeout(()=>{ edOk.style.display='none'; closeSheet(studentSheet); }, 700);
    if(selectedClass) await loadStudents(selectedClass);
  }catch(e){
    edErr.textContent = e?.message || 'تعذّر الحذف.';
    edErr.style.display='block';
  }
});

/* ========= Attendance analytics for a student ========= */
async function loadStudentAttendance(studentId){
  absencesList.innerHTML = '<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل بيانات الحضور...</div></div>';
  latesList.innerHTML = '';
  totPresent.textContent = '—'; totAbsent.textContent = '—'; totLate.textContent = '—';
  absentCountPill.textContent = 'أيام غياب: ٠'; lateCountPill.textContent = 'تأخير: 0';
  warningAbsenceCount.textContent = '0';
  warningLevelBadge.textContent = 'لا يوجد';
  warningLevelBadge.className = 'warning-level-badge warning-level-0';
  warningProgressFill.style.width = '0%';
  warningProgressFill.className = 'warning-progress-fill';
  warningNextHint.textContent = '—';
  warningExcusedCount.textContent = '0';
  warningLevelBadgeExcused.textContent = 'لا يوجد';
  warningLevelBadgeExcused.className = 'warning-level-badge warning-excused-level-0';
  warningProgressFillExcused.style.width = '0%';
  warningProgressFillExcused.className = 'warning-progress-fill';
  warningNextHintExcused.textContent = '—';
  try{
    const { rows, allAbsences, absenceDays, combinedLates, present, late, absent, excused } = await fetchStudentAttendanceData(db, studentId);
    currentStudentAttendance = rows;

    totPresent.textContent = toArabicDigits(present);
    totLate.textContent = toArabicDigits(late);
    totAbsent.textContent = toArabicDigits(absent);
    absentCountPill.textContent = `أيام غياب: ${toArabicDigits(absenceDays.length)}`;
    lateCountPill.textContent = `تأخير: ${toArabicDigits(late)}`;

    renderWarningState(absent, {
      countEl: warningAbsenceCount,
      badgeEl: warningLevelBadge,
      progressFillEl: warningProgressFill,
      hintEl: warningNextHint,
    });

    renderExcusedWarningState(excused, {
      countEl: warningExcusedCount,
      badgeEl: warningLevelBadgeExcused,
      progressFillEl: warningProgressFillExcused,
      hintEl: warningNextHintExcused,
    });

    const absencesFragment = document.createDocumentFragment();
    const latesFragment = document.createDocumentFragment();
    allAbsences.forEach(r=> absencesFragment.appendChild(makeAttTile(r, openAttDetail)));
    // Lesson lates and morning lates share one list, newest first (already merged by fetchStudentAttendanceData).
    combinedLates.forEach(r=> latesFragment.appendChild(r.source==='morningLate' ? makeMorningLateTile(r, openAttDetail) : makeAttTile(r, openAttDetail)));
    absencesList.innerHTML = '';
    latesList.innerHTML = '';
    absencesList.appendChild(absencesFragment);
    latesList.appendChild(latesFragment);

    if(allAbsences.length===0){
      const empty=document.createElement('div'); empty.className='muted'; empty.textContent='لا توجد حالات غياب.'; absencesList.appendChild(empty);
    }
    if(combinedLates.length===0){
      const empty=document.createElement('div'); empty.className='muted'; empty.textContent='لا توجد حالات تأخير.'; latesList.appendChild(empty);
    }
  }catch(e){
    console.error('[loadStudentAttendance]', e);
    const err=document.createElement('div'); err.className='error'; err.textContent='تعذّر تحميل بيانات الحضور.'; absencesList.innerHTML = ''; absencesList.appendChild(err);
  }
}

// makeAttTile/makeMorningLateTile now come from shared/attendance-tiles.js.
async function openAttDetail(r){
  currentAttendanceRecord = r; // Store the current record for editing
  const isMorningLate = r.source === 'morningLate';

  attDetailTitle.textContent = isMorningLate ? 'تفاصيل تأخير الطابور' : (r.status==='late' ? 'تفاصيل التأخير' : 'تفاصيل الغياب');
  dBadge.className = 'badge ' + (isMorningLate || r.status==='late' ? 'b-late' : 'b-absent');
  dBadge.textContent = isMorningLate ? 'تأخير صباح' : (r.status==='late' ? 'تأخير' : 'غياب');
  dDate.textContent = toArabicDigits(r.date || '—');
  dLesson.textContent = isMorningLate
    ? ('تأخير عن طابور الصباح' + (r.time ? ' — ' + toArabicDigits(r.time) : ''))
    : (r.lessonLabel || ('حصة '+ (r.lessonIndex || '—')));
  dClass.textContent = isMorningLate ? (r.classKey || '—') : (r.class || '—');

  dTeacher.textContent = '—';
  if (isMorningLate) {
    // Morning-late docs already carry the submitter's name — no lookup needed.
    dTeacher.textContent = r.createdByName || '—';
  } else {
    const uid = r.updatedBy || r.createdBy;
    if(uid){
      if(teacherNameCache.has(uid)){
        dTeacher.textContent = teacherNameCache.get(uid);
      }else{
        try{ const t = await getDoc(doc(db,'teachers', uid)); const name = t.exists() ? (t.data().name || uid) : uid; teacherNameCache.set(uid, name); dTeacher.textContent = name; }
        catch{ dTeacher.textContent = uid; }
      }
    }
  }

  const cAt = tsToDate(r.createdAt); const uAt = tsToDate(r.updatedAt);
  dCreatedAt.textContent = cAt ? fmtDT(cAt) : '—';
  dUpdatedAt.textContent = isMorningLate ? (cAt ? fmtDT(cAt) : '—') : (uAt ? fmtDT(uAt) : (cAt ? fmtDT(cAt) : '—'));

  // Reset edit form - only for admin, and morning-late records are never
  // editable here regardless (they're not lesson attendance).
  statusEditForm.classList.remove('active');
  if(!currentUserIsSupervisor && !isMorningLate) {
    statusOptions.forEach(opt => opt.classList.remove('selected'));
    statusOptions.forEach(opt => { if(opt.dataset.status === r.status) { opt.classList.add('selected'); } });
  }

  openSheet(attDetailSheet);
}

closeAttDetail.addEventListener('click', ()=> { closeSheet(attDetailSheet); statusEditForm.classList.remove('active'); });

// Edit attendance status functionality - only for admin, and never for
// morning-late records (not lesson attendance, nothing here to edit).
editAttBtn.addEventListener('click', () => {
  if(!currentUserIsSupervisor && currentAttendanceRecord?.source !== 'morningLate') {
    statusEditForm.classList.toggle('active');
  }
});

statusOptions.forEach(option => {
  option.addEventListener('click', () => {
    if(!currentUserIsSupervisor) {
      statusOptions.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
    }
  });
});

cancelStatusBtn.addEventListener('click', () => {
  statusEditForm.classList.remove('active');
  // Reset selection to current status
  statusOptions.forEach(opt => opt.classList.remove('selected'));
  statusOptions.forEach(opt => { if(opt.dataset.status === currentAttendanceRecord.status) { opt.classList.add('selected'); } });
});

saveStatusBtn.addEventListener('click', async () => {
  if (currentUserIsSupervisor) return;
  if (!currentAttendanceRecord || !currentStudent.id) return;
  const selectedOption = document.querySelector('.status-option.selected');
  if (!selectedOption) { alert('يرجى اختيار حالة جديدة'); return; }
  const newStatus = selectedOption.dataset.status;
  if (newStatus === currentAttendanceRecord.status) { statusEditForm.classList.remove('active'); return; }
  
  try {
    // Update the record in Firestore
    await updateDoc(doc(db, 'students', currentStudent.id, 'attendance', currentAttendanceRecord.id),
    { status: newStatus, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() });
    
    // Update UI
    dBadge.className = 'badge ' + (newStatus==='late' ? 'b-late': newStatus==='absent' ? 'b-absent' : 'b-present');
    dBadge.textContent = newStatus==='late' ? 'تأخير' : newStatus==='absent' ? 'غياب' : 'حضور';
    const uAt = new Date(); dUpdatedAt.textContent = fmtDT(uAt);
    
    // Refresh the student's attendance data
    await loadStudentAttendance(currentStudent.id);
    statusEditForm.classList.remove('active');
    
    // Show success message
    const successMsg = document.createElement('div'); successMsg.className = 'ok'; successMsg.textContent = 'تم تحديث حالة الحضور بنجاح'; successMsg.style.display = 'block';
    attDetailBody.appendChild(successMsg); setTimeout(() => { successMsg.style.display = 'none'; }, 3000);
  } catch (error) {
    console.error('Error updating attendance status:', error); alert('تعذر تحديث حالة الحضور. يرجى المحاولة مرة أخرى.');
  }
});

/* ========= Statistics functionality ========= */
statsPeriod.addEventListener('change', function() {
  if(this.value === 'custom') {
    customDateRange.style.display = 'flex';
  } else {
    customDateRange.style.display = 'none';
    if(selectedClass) loadClassStatistics(selectedClass);
  }
});

statsFrom.addEventListener('change', updateCustomStats);
statsTo.addEventListener('change', updateCustomStats);

function updateCustomStats() {
  if(statsFrom.value && statsTo.value && selectedClass) {
    loadClassStatistics(selectedClass, statsFrom.value, statsTo.value);
  }
}

async function loadClassStatistics(className, fromDate = null, toDate = null) {
  try {
    // Get all students in the class
    const qy = query(collection(db,'students'), where('class','==', className));
    const snap = await getDocs(qy);
    const students = [];
    snap.forEach(d=> students.push({ id:d.id, ...d.data() }) );
    
    // Reset statistics
    classStatistics = {
      totalPresent: 0,
      totalAbsent: 0,
      totalLate: 0,
      weeklyData: [],
      monthlyData: [],
      attendanceByDay: {},
      attendanceByStudent: {}
    };
    
    // Get attendance data for all students.
    //
    // These reads are independent of each other, so fetching them one at a
    // time made the wait the *sum* of every round trip — a class of thirty
    // meant thirty sequential trips to Firestore before any statistic could
    // be shown. Issued together, the wait is the slowest single trip
    // instead. Concurrency is capped so a very large class doesn't open
    // hundreds of sockets at once. The accumulation loop below is unchanged
    // and still runs in student order.
    const attendanceSnaps = await mapWithLimit(
      students,
      (student) => getDocs(collection(db,'students', student.id, 'attendance'))
    );

    for(let si = 0; si < students.length; si++) {
      const student = students[si];
      const attendanceSnap = attendanceSnaps[si];
      if(!attendanceSnap) continue;
      const studentAttendance = [];
      attendanceSnap.forEach(d=> studentAttendance.push({ id:d.id, ...d.data() }) );
      
      // Filter by date range if provided
      let filteredAttendance = studentAttendance;
      if(fromDate && toDate) {
        filteredAttendance = studentAttendance.filter(record => 
          record.date >= fromDate && record.date <= toDate
        );
      }
      
      // Count attendance by status
      const present = filteredAttendance.filter(r=> r.status==='present').length;
      const late = filteredAttendance.filter(r=> r.status==='late').length;
      const absent = filteredAttendance.filter(r=> r.status==='absent').length;
      
      classStatistics.totalPresent += present;
      classStatistics.totalLate += late;
      classStatistics.totalAbsent += absent;
      
      // Group by day for weekly chart
      filteredAttendance.forEach(record => {
        if(!classStatistics.attendanceByDay[record.date]) {
          classStatistics.attendanceByDay[record.date] = { present: 0, absent: 0, late: 0 };
        }
        classStatistics.attendanceByDay[record.date][record.status]++;
      });
      
      // Store student data
      classStatistics.attendanceByStudent[student.id] = {
        name: student.name,
        present,
        absent,
        late
      };
    }
    
    // Update UI with statistics
    updateStatisticsUI();
  } catch(e) {
    console.error('[loadClassStatistics]', e);
  }
}

function updateStatisticsUI() {
  statsTotalPresent.textContent = toArabicDigits(classStatistics.totalPresent);
  statsTotalAbsent.textContent = toArabicDigits(classStatistics.totalAbsent);
  statsTotalLate.textContent = toArabicDigits(classStatistics.totalLate);

  const total = classStatistics.totalPresent + classStatistics.totalAbsent + classStatistics.totalLate;
  const attendanceRate = total > 0 ? ((classStatistics.totalPresent / total) * 100).toFixed(1) : '0.0';
  const absentRate = total > 0 ? ((classStatistics.totalAbsent / total) * 100).toFixed(1) : '0.0';
  const lateRate = total > 0 ? ((classStatistics.totalLate / total) * 100).toFixed(1) : '0.0';
  statsInsight.textContent =
    `من أصل ${toArabicDigits(total)} سجل حضور، نسبة الحضور ${toArabicDigits(attendanceRate)}%، ` +
    `الغياب ${toArabicDigits(absentRate)}%، والتأخير ${toArabicDigits(lateRate)}%.`;

  const days = Object.keys(classStatistics.attendanceByDay).sort().slice(-7).reverse();
  statsDailySummary.innerHTML = '';
  if(days.length === 0){
    statsDailySummary.innerHTML = '<div class="muted">لا توجد بيانات للعرض في هذه الفترة.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  days.forEach(day => {
    const dayData = classStatistics.attendanceByDay[day] || {};
    const present = dayData.present || 0;
    const absent = dayData.absent || 0;
    const late = dayData.late || 0;
    const item = document.createElement('div');
    item.className = 'stats-daily-item';
    item.innerHTML = `
      <div><strong>${toArabicDigits(day)}</strong><div class="meta">ملخص اليوم</div></div>
      <div class="meta">حضور: ${toArabicDigits(present)} | غياب: ${toArabicDigits(absent)} | تأخير: ${toArabicDigits(late)}</div>
    `;
    fragment.appendChild(item);
  });
  statsDailySummary.appendChild(fragment);
}

/* ========= Tabs ========= */
function activateTab(btn, panel){
  [tabCommit,tabEnroll,tabReport,tabNote].forEach(b=> b.classList.remove('active'));
  [panelCommit,panelEnroll,panelReport,panelNote].forEach(p=> p.classList.remove('active'));
  btn.classList.add('active'); panel.classList.add('active');
}
tabCommit.addEventListener('click', ()=> activateTab(tabCommit, panelCommit));
tabEnroll.addEventListener('click', ()=> activateTab(tabEnroll, panelEnroll));
tabReport.addEventListener('click', ()=> activateTab(tabReport, panelReport));
tabNote.addEventListener('click', ()=> activateTab(tabNote, panelNote));

/* ========= Helpers ========= */
const getMe = ()=> (auth.currentUser? auth.currentUser.uid : 'system');
function tag(text){ return `<span class="tag">${text}</span>`; }
function badgeForStatus(status){
  switch((status||'').toLowerCase()){
    case 'signed': return `<span class="k-badge k-ok">مُوقّع</span>`;
    case 'acknowledged': return `<span class="k-badge k-ok">مُقَرّ</span>`;
    case 'sent': return `<span class="k-badge k-warn">مُرسَل</span>`;
    case 'revoked': return `<span class="k-badge k-danger">ملغى</span>`;
    default: return `<span class="k-badge">مسودة</span>`;
  }
}

function renderRecordDetailRows(rows){
  recordDetailBody.innerHTML = '';
  const fragment = document.createDocumentFragment();
  rows.forEach(({label, value})=>{
    const item = document.createElement('div');
    item.className = 'record-detail-item';
    item.innerHTML = `
      <div class="record-detail-label">${label}</div>
      <div class="record-detail-value">${value || '—'}</div>
    `;
    fragment.appendChild(item);
  });
  recordDetailBody.appendChild(fragment);
}

function withCreatorDetailRow(rows, creatorName){
  const list = Array.isArray(rows) ? [...rows] : [];
  list.push({ label:'تم الإعداد بواسطة', value:creatorName || '—' });
  return list;
}

function openRecordDetail(title, rows, { createdByUid = '' } = {}){
  currentDetailDocType = title;
  currentDetailCreatedByUid = createdByUid || '';
  currentDetailRows = rows;
  recordDetailTitle.textContent = title;
  renderRecordDetailRows(withCreatorDetailRow(rows, '...'));
  openSheet(recordDetailSheet);
  const requestUid = currentDetailCreatedByUid;
  getTeacherNameByUid(requestUid).then((name)=>{
    if(requestUid !== currentDetailCreatedByUid) return;
    renderRecordDetailRows(withCreatorDetailRow(currentDetailRows, name));
  });
}

async function getTeacherNameByUid(uid){
  const key = (uid || '').toString().trim();
  if(!key || key === 'system') return 'النظام';
  if(teacherNameCache.has(key)) return teacherNameCache.get(key);
  try{
    const s = await getDoc(doc(db,'teachers', key));
    const name = s.exists() ? (s.data()?.name || key) : key;
    teacherNameCache.set(key, name);
    return name;
  }catch{
    return key;
  }
}

closeRecordDetail.addEventListener('click', ()=> closeSheet(recordDetailSheet));

function safeFileName(value){
  return (value || 'سجل')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderPaperPreviewRows(rows){
  paperPreviewBody.innerHTML = '';
  const normalized = (rows || []).map(r => ({ label:(r.label || '').trim(), value:(r.value || '—').toString().trim() }));
  const titleRow = normalized.find(r => r.label === 'العنوان');
  const bodyRow = normalized.find(r => r.label === 'السبب' || r.label === 'النص');
  const dateRow = normalized.find(r => r.label === 'التاريخ');
  const filteredRows = normalized.filter(r => !['العنوان','السبب','النص','التاريخ','الحالة','الفئة المستهدفة','الفصل'].includes(r.label));

  paperReasonLine.textContent = bodyRow?.value && bodyRow.value !== '—'
    ? `السبب: ${bodyRow.value}`
    : 'السبب: —';
  paperDateLine.textContent = dateRow?.value && dateRow.value !== '—'
    ? `التاريخ: ${dateRow.value}`
    : `التاريخ: ${fmtDate(new Date())}`;

  // Use the actual record title as the main document title
  paperDocType.textContent = (titleRow && titleRow.value && titleRow.value !== '—')
    ? titleRow.value
    : (currentDetailDocType || 'سجل');

  filteredRows.forEach(({label, value})=>{
    const line = document.createElement('div');
    line.className = 'paper-line';
    line.innerHTML = `<strong>${label}:</strong> ${value || '—'}`;
    paperPreviewBody.appendChild(line);
  });
}

saveRecordPdf.addEventListener('click', async ()=>{
  try{
    if(isDownloadingPaperPdf) return;
    isDownloadingPaperPdf = true;
    if(!window.html2canvas || !window.jspdf?.jsPDF){
      alert('تعذّر تحميل أدوات إنشاء PDF حالياً.');
      isDownloadingPaperPdf = false;
      return;
    }
    const docPrefixMap = {
      'تفاصيل التعهد': 'تعهد',
      'تفاصيل القيد': 'فصول',
      'تفاصيل التقرير': 'تقرير',
      'تفاصيل الملاحظة': 'ملاحظة'
    };
    const prefix = docPrefixMap[currentDetailDocType] || 'سجل';
    const studentName = currentStudent?.data?.name || 'طالب';
    const fileName = safeFileName(`${prefix}-${studentName}.pdf`);

    const creatorName = await getTeacherNameByUid(currentDetailCreatedByUid);
    paperStudentLine.textContent = currentStudent?.data?.name ? `الطالب: ${currentStudent.data.name}` : 'الطالب: —';
    paperClassLine.textContent = currentStudent?.data?.class ? `الصف: ${toArabicDigits(currentStudent.data.class)}` : 'الصف: —';
    paperCreatorLine.textContent = `تم الإعداد بواسطة: ${creatorName || '—'}`;
    renderPaperPreviewRows(currentDetailRows || []);

    const captureNode = paperPreviewPage.cloneNode(true);
    captureNode.style.width = '920px';
    captureNode.style.maxWidth = '920px';
    captureNode.style.minHeight = '1420px';
    captureNode.style.margin = '0';
    captureNode.style.position = 'fixed';
    captureNode.style.left = '-10000px';
    captureNode.style.top = '0';
    captureNode.style.zIndex = '-1';
    captureNode.style.background = '#fff';
    document.body.appendChild(captureNode);

    const images = Array.from(captureNode.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }));

    const canvas = await window.html2canvas(captureNode, {
      backgroundColor: '#ffffff',
      scale: 3.4,
      useCORS: true,
      imageTimeout: 0
    });
    captureNode.remove();

    const imgData = canvas.toDataURL('image/png', 1.0);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:'p', unit:'mm', format:'a4', compress:true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const imgW = canvas.width;
    const imgH = canvas.height;
    const scale = Math.min(maxW / imgW, maxH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const drawX = (pageW - drawW) / 2;
    const drawY = (pageH - drawH) / 2;
    pdf.addImage(imgData, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');
    pdf.save(fileName);
  }catch(e){
    console.error('[saveRecordPdf]', e);
    alert('تعذّر حفظ الملف PDF.');
  }finally{
    isDownloadingPaperPdf = false;
  }
});

function bindCardOpen(wrap, onOpen){
  wrap.addEventListener('click', (e)=>{
    if(e.target.closest('.actions, button, select, input, textarea, a, label')) return;
    onOpen();
  });
}

const quickForms = [commitQuick, enrollQuick, reportQuick, noteQuick];
function isQuickFormOpen(){
  return quickForms.some(f => f.style.display !== 'none');
}
function openQuickForm(form){
  quickForms.forEach(f => {
    if (f !== form) {
      f.style.display = 'none';
      f.classList.remove('popup');
    }
  });
  form.style.display = 'flex';
  form.classList.add('popup');
  quickFormBackdrop.classList.add('open');
}
function closeQuickForm(form){
  form.style.display = 'none';
  form.classList.remove('popup');
  if(!isQuickFormOpen()){
    quickFormBackdrop.classList.remove('open');
  }
}
function closeAllQuickForms(){
  quickForms.forEach(f => {
    f.style.display = 'none';
    f.classList.remove('popup');
  });
  quickFormBackdrop.classList.remove('open');
}
quickFormBackdrop.addEventListener('click', closeAllQuickForms);

/* ========= Commitments CRUD ========= */
addCommitBtn.addEventListener('click', ()=>{ openQuickForm(commitQuick); document.getElementById('commitTitle').focus(); });
commitCancel.addEventListener('click', ()=> closeQuickForm(commitQuick));

async function loadCommitments(sid){
  commitList.innerHTML = '<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل التعهدات...</div></div>';
  commitEmpty.style.display = 'none';
  try{
    const qy = query(collection(db,'students', sid, 'commitments'), orderBy('createdAt','desc'));
    const snap = await getDocs(qy);
    if(snap.empty){ commitList.innerHTML = ''; commitEmpty.style.display = 'block'; return; }
    const fragment = document.createDocumentFragment();
    snap.forEach(d=>{ const c = d.data(); c.id = d.id; fragment.appendChild(renderCommitCard(sid, c)); });
    commitList.innerHTML = ''; commitList.appendChild(fragment);
  }catch(e){ console.error('[loadCommitments]', e); commitList.innerHTML = `<div class="error">تعذّر تحميل التعهدات.</div>`; }
}

function renderCommitCard(sid, c){
  const wrap = document.createElement('div'); wrap.className = 'card will-change';
  const dueText = c.dueDate ? ` • التاريخ: ${toArabicDigits(c.dueDate)}` : '';
  const aud = c.audience==='both'?'الطالب + ولي الأمر': (c.audience==='student'?'الطالب':'ولي الأمر');
  wrap.innerHTML = `
    <div class="record-card-main" style="flex:1; min-width:220px;">
      <div class="card-title">${c.title || '—'}</div>
      <div class="card-sub record-card-meta">${badgeForStatus(c.status)} ${dueText} • ${tag(aud)}</div>
      ${c.body ? `<div class="card-sub record-card-body">${c.body}</div>` : ''}
    </div>
    <div class="actions">
      <select class="input" data-act="status" style="min-width:140px;">
        <option value="draft" ${c.status==='draft'?'selected':''}>مسودة</option>
        <option value="sent" ${c.status==='sent'?'selected':''}>مُرسَل</option>
        <option value="acknowledged" ${c.status==='acknowledged'?'selected':''}>مُقَرّ</option>
        <option value="signed" ${c.status==='signed'?'selected':''}>مُوقّع</option>
        <option value="revoked" ${c.status==='revoked'?'selected':''}>ملغى</option>
      </select>
      <button class="btn ghost mini" data-act="save">حفظ</button>
      <button class="btn danger mini" data-act="del">حذف</button>
    </div>
  `;
  const sel = wrap.querySelector('select[data-act="status"]'); const save = wrap.querySelector('button[data-act="save"]'); const del = wrap.querySelector('button[data-act="del"]');
  save.addEventListener('click', async ()=>{
    try{ await updateDoc(doc(db,'students', sid, 'commitments', c.id), { status: sel.value, updatedBy: getMe(), updatedAt: serverTimestamp() });
      wrap.querySelector('.card-sub').innerHTML = `${badgeForStatus(sel.value)} ${dueText} • ${tag(aud)}`;
    }catch(e){ alert('تعذّر الحفظ'); }
  });
  del.addEventListener('click', async ()=>{
    if(!confirm('حذف التعهد؟')) return;
    try{ await deleteDoc(doc(db,'students', sid, 'commitments', c.id)); wrap.remove(); if(!commitList.children.length){ commitEmpty.style.display='block'; } }
    catch(e){ alert('تعذّر الحذف'); }
  });
  bindCardOpen(wrap, ()=> {
    openRecordDetail('تفاصيل التعهد', [
      { label:'العنوان', value:c.title || '—' },
      { label:'السبب', value:c.body || '—' },
      { label:'الحالة', value:c.status || 'draft' },
      { label:'الفئة المستهدفة', value:aud },
      { label:'التاريخ', value:c.dueDate ? toArabicDigits(c.dueDate) : '—' },
      { label:'الفصل', value:c.class ? toArabicDigits(c.class) : '—' }
    ], { createdByUid: c.createdBy || '' });
  });
  return wrap;
}

commitSave.addEventListener('click', async ()=>{
  if(!currentStudent.id) return;
  const title = (commitTitle.value||'').trim(); const reason = (commitReason.value||'').trim(); const due = (commitDue.value||'').trim(); const audience = commitAudience.value || 'guardian';
  if(!title){ alert('أدخل العنوان'); return; }
  try{
    const ref = doc(collection(db,'students', currentStudent.id, 'commitments'));
    await setDoc(ref, {
      title, body: reason || '', status: 'sent', audience, class: currentStudent.data?.class || selectedClass || '', dueDate: due || null,
      createdBy: getMe(), updatedBy: getMe(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    commitTitle.value=''; commitReason.value=''; commitDue.value=''; commitAudience.value='guardian'; closeQuickForm(commitQuick);
    await loadCommitments(currentStudent.id);
  }catch(e){ console.error(e); alert('تعذّر الحفظ'); }
});

/* ========= Enrollments CRUD ========= */
addEnrollBtn.addEventListener('click', ()=>{ openQuickForm(enrollQuick); document.getElementById('enrollTitle').focus(); });
enrollCancel.addEventListener('click', ()=> closeQuickForm(enrollQuick));

async function loadEnrollments(sid){
  enrollList.innerHTML = '<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل قيود الفصول...</div></div>';
  enrollEmpty.style.display = 'none';
  try{
    const snap = await getDocs(collection(db,'students', sid, 'enrollments'));
    const rows = []; snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
    rows.sort((a,b)=> (a.from||'') < (b.from||'') ? 1 : -1);
    if(rows.length===0){ enrollList.innerHTML = ''; enrollEmpty.style.display='block'; return; }
    const fragment = document.createDocumentFragment(); rows.forEach(r=> fragment.appendChild(renderEnrollCard(sid, r)));
    enrollList.innerHTML = ''; enrollList.appendChild(fragment);
  }catch(e){ console.error('[loadEnrollments]', e); enrollList.innerHTML = `<div class="error">تعذّر تحميل قيود الفصول.</div>`; }
}

function renderEnrollCard(sid, r){
  const wrap = document.createElement('div'); wrap.className = 'card will-change';
  const dates = (r.from? `من ${toArabicDigits(r.from)}`:'') + (r.to? ` حتى ${toArabicDigits(r.to)}`:'');
  wrap.innerHTML = `
    <div class="record-card-main" style="flex:1; min-width:220px;">
      <div class="card-title">${r.title || '—'}</div>
      <div class="card-sub">${dates}</div>
      ${r.lengthText ? `<div class="card-sub">المدة: ${r.lengthText}</div>`:''}
      ${r.reason ? `<div class="card-sub record-card-body">${r.reason}</div>`:''}
    </div>
    <div class="actions">
      <button class="btn danger mini" data-act="del">حذف</button>
    </div>
  `;
  wrap.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
    if(!confirm('حذف القيد؟')) return;
    try{ await deleteDoc(doc(db,'students', sid, 'enrollments', r.id)); wrap.remove(); if(!enrollList.children.length){ enrollEmpty.style.display='block'; } }
    catch(e){ alert('تعذّر الحذف'); }
  });
  bindCardOpen(wrap, ()=> {
    openRecordDetail('تفاصيل القيد', [
      { label:'العنوان', value:r.title || '—' },
      { label:'السبب', value:r.reason || '—' },
      { label:'المدة', value:r.lengthText || '—' },
      { label:'من', value:r.from ? toArabicDigits(r.from) : '—' },
      { label:'إلى', value:r.to ? toArabicDigits(r.to) : '—' },
      { label:'الفصل', value:r.class ? toArabicDigits(r.class) : '—' }
    ], { createdByUid: r.createdBy || '' });
  });
  return wrap;
}

enrollSave.addEventListener('click', async ()=>{
  if(!currentStudent.id) return;
  const title = (enrollTitle.value||'').trim(); const reason= (enrollReason.value||'').trim(); const lengthText = (enrollLength.value||'').trim(); const from = (enrollFrom.value||'').trim(); const to = (enrollTo.value||'').trim();
  if(!title){ alert('أدخل العنوان'); return; }
  try{
    const ref = doc(collection(db,'students', currentStudent.id, 'enrollments'));
    await setDoc(ref, {
      title, reason, lengthText, from: from||null, to: to||null, class: currentStudent.data?.class || selectedClass || '',
      createdBy: getMe(), updatedBy: getMe(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    enrollTitle.value=''; enrollReason.value=''; enrollLength.value=''; enrollFrom.value=''; enrollTo.value=''; closeQuickForm(enrollQuick);
    await loadEnrollments(currentStudent.id);
  }catch(e){ console.error(e); alert('تعذّر الحفظ'); }
});

/* ========= Reports CRUD ========= */
addReportBtn.addEventListener('click', ()=>{ openQuickForm(reportQuick); document.getElementById('reportTitle').focus(); });
reportCancel.addEventListener('click', ()=> closeQuickForm(reportQuick));

async function loadReports(sid){
  reportList.innerHTML = '<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل التقارير...</div></div>';
  reportEmpty.style.display = 'none';
  try{
    const qy = query(collection(db,'students', sid, 'reports'), orderBy('date','desc'));
    const snap = await getDocs(qy);
    if(snap.empty){ reportList.innerHTML = ''; reportEmpty.style.display='block'; return; }
    const fragment = document.createDocumentFragment(); snap.forEach(d=>{ const r = d.data(); r.id = d.id; fragment.appendChild(renderReportCard(sid, r)); });
    reportList.innerHTML = ''; reportList.appendChild(fragment);
  }catch(e){ console.error('[loadReports]', e); reportList.innerHTML = `<div class="error">تعذّر تحميل التقارير.</div>`; }
}

function renderReportCard(sid, r){
  const wrap = document.createElement('div'); wrap.className = 'card will-change';
  const typeLabelMap = { behavior:'سلوك', academic:'تحصيلي', incident:'واقعة', health:'صحي', custom:'custom' };
  const typeLabel = typeLabelMap[r.type] || r.type || '—';
  wrap.innerHTML = `
    <div class="record-card-main" style="flex:1; min-width:220px;">
      <div class="card-title">${r.title || '—'}</div>
      <div class="card-sub">${tag(typeLabelMap[r.type] || r.type || '—')} • ${toArabicDigits(r.date || '')}</div>
      ${r.reason ? `<div class="card-sub record-card-body">${r.reason}</div>`:''}
    </div>
    <div class="actions">
      <button class="btn danger mini" data-act="del">حذف</button>
    </div>
  `;
  wrap.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
    if(!confirm('حذف التقرير؟')) return;
    try{ await deleteDoc(doc(db,'students', sid, 'reports', r.id)); wrap.remove(); if(!reportList.children.length){ reportEmpty.style.display='block'; } }
    catch(e){ alert('تعذّر الحذف'); }
  });
  bindCardOpen(wrap, ()=> {
    openRecordDetail('تفاصيل التقرير', [
      { label:'العنوان', value:r.title || '—' },
      { label:'النوع', value:typeLabel },
      { label:'السبب', value:r.reason || '—' },
      { label:'التاريخ', value:r.date ? toArabicDigits(r.date) : '—' },
      { label:'الفصل', value:r.class ? toArabicDigits(r.class) : '—' }
    ], { createdByUid: r.createdBy || '' });
  });
  return wrap;
}

reportSave.addEventListener('click', async ()=>{
  if(!currentStudent.id) return;
  const type = reportType.value || 'behavior'; const title = (reportTitle.value||'').trim(); const reason= (reportReason.value||'').trim(); const date = (reportDate.value||'').trim();
  if(!title || !date){ alert('أكمل الحقول'); return; }
  try{
    const ref = doc(collection(db,'students', currentStudent.id, 'reports'));
    await setDoc(ref, {
      type, title, reason, date, class: currentStudent.data?.class || selectedClass || '',
      createdBy: getMe(), updatedBy: getMe(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    reportTitle.value=''; reportReason.value=''; reportDate.value=''; reportType.value='behavior'; closeQuickForm(reportQuick);
    await loadReports(currentStudent.id);
  }catch(e){ console.error(e); alert('تعذّر الحفظ'); }
});

/* ========= Notes CRUD ========= */
addNoteBtn.addEventListener('click', ()=>{ openQuickForm(noteQuick); document.getElementById('noteBody').focus(); });
noteCancel.addEventListener('click', ()=> closeQuickForm(noteQuick));

async function loadNotes(sid){
  noteList.innerHTML = '<div class="loading"><div class="spinner"></div><div class="muted">جاري تحميل الملاحظات...</div></div>';
  noteEmpty.style.display = 'none';
  try{
    const snap = await getDocs(collection(db,'students', sid, 'notes'));
    const rows = []; snap.forEach(d=> rows.push({ id:d.id, ...d.data() }));
    rows.sort((a,b)=>{ if(!!b.pinned - !!a.pinned !== 0) return (b.pinned?1:0)-(a.pinned?1:0); const at = tsToDate(a.createdAt)?.getTime() || 0; const bt = tsToDate(b.createdAt)?.getTime() || 0; return bt - at; });
    if(rows.length===0){ noteList.innerHTML = ''; noteEmpty.style.display='block'; return; }
    const fragment = document.createDocumentFragment(); rows.forEach(n=> fragment.appendChild(renderNoteCard(sid, n)));
    noteList.innerHTML = ''; noteList.appendChild(fragment);
  }catch(e){ console.error('[loadNotes]', e); noteList.innerHTML = `<div class="error">تعذّر تحميل الملاحظات.</div>`; }
}

function renderNoteCard(sid, n){
  const wrap = document.createElement('div'); wrap.className = 'card will-change';
  const tMap = { general:'عام', behavior:'سلوك', academic:'تحصيلي', health:'صحي', 'parent-call':'اتصال بولي الأمر', meeting:'اجتماع' };
  const pinBadge = n.pinned ? `<span class="k-badge k-warn">مثبّت</span>` : '';
  const when = tsToDate(n.createdAt) ? fmtDT(tsToDate(n.createdAt)) : '';
  const typeLabel = tMap[n.type] || n.type || '—';
  wrap.innerHTML = `
    <div class="record-card-main" style="flex:1; min-width:220px;">
      <div class="card-title">${n.body || '—'}</div>
      <div class="card-sub">${tag(tMap[n.type] || n.type || '—')} ${pinBadge} ${when? ` • ${when}`:''}</div>
    </div>
    <div class="actions">
      <button class="btn ghost mini" data-act="togglePin">${n.pinned?'إلغاء التثبيت':'تثبيت'}</button>
      <button class="btn danger mini" data-act="del">حذف</button>
    </div>
  `;
  const pinBtn = wrap.querySelector('button[data-act="togglePin"]'); const delBtn = wrap.querySelector('button[data-act="del"]');
  pinBtn.addEventListener('click', async ()=>{
    try{ await updateDoc(doc(db,'students', sid, 'notes', n.id), { pinned: !n.pinned, updatedBy:getMe(), updatedAt: serverTimestamp() });
      n.pinned = !n.pinned; pinBtn.textContent = n.pinned? 'إلغاء التثبيت' : 'تثبيت';
      const sub = wrap.querySelector('.card-sub'); const t = (tMap[n.type] || n.type || '—'); const pinBadge2 = n.pinned ? `<span class="k-badge k-warn">مثبّت</span>` : '';
      sub.innerHTML = `${tag(t)} ${pinBadge2} ${when? ` • ${when}`:''}`;
    }catch(e){ alert('تعذّر التحديث'); }
  });
  delBtn.addEventListener('click', async ()=>{
    if(!confirm('حذف الملاحظة؟')) return;
    try{ await deleteDoc(doc(db,'students', sid, 'notes', n.id)); wrap.remove(); if(!noteList.children.length){ noteEmpty.style.display='block'; } }
    catch(e){ alert('تعذّر الحذف'); }
  });
  bindCardOpen(wrap, ()=> {
    openRecordDetail('تفاصيل الملاحظة', [
      { label:'النص', value:n.body || '—' },
      { label:'النوع', value:typeLabel },
      { label:'مثبّت', value:n.pinned ? 'نعم' : 'لا' },
      { label:'الظهور', value:n.visibility || 'teachers' },
      { label:'الفصل', value:n.class ? toArabicDigits(n.class) : '—' }
    ], { createdByUid: n.createdBy || '' });
  });
  return wrap;
}

noteSave.addEventListener('click', async ()=>{
  if(!currentStudent.id) return;
  const body = (noteBody.value||'').trim(); const type = noteType.value || 'general'; const pinned = !!notePinned.checked;
  if(!body){ alert('أدخل نص الملاحظة'); return; }
  try{
    const ref = doc(collection(db,'students', currentStudent.id, 'notes'));
    await setDoc(ref, {
      body, type, pinned, visibility: 'teachers', class: currentStudent.data?.class || selectedClass || '',
      createdBy: getMe(), updatedBy: getMe(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    noteBody.value=''; notePinned.checked=false; noteType.value='general'; closeQuickForm(noteQuick);
    await loadNotes(currentStudent.id);
  }catch(e){ console.error(e); alert('تعذّر الحفظ'); }
});
