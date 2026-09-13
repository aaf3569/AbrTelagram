// The school's real department/subject taxonomy — 16 departments, 25
// subjects — ported from the school's Google Sheet scheduling system
// (its config_Constants.js: CONSTANTS.DEPARTMENTS, CONSTANTS.SUBJECTS,
// SUBJECT_TO_ALLOWED_DEPARTMENTS), which is the authority this was checked
// against. That sheet has been tuned against this exact school's real
// staff and curriculum for 60+ sessions; treat it as the source of truth
// whenever this file and it could conflict.
//
// Until this file existed, six pages (Teachers/teacherschedule.html,
// admins/teachers.html, admins/adminpage.html, depHead/department.html,
// depHead/dptschedual.html, depHead/schedual.html) each hand-copied their
// own version of this taxonomy, plus firestore.rules and index.js kept
// independent copies for authorization. All of them had drifted from the
// real structure and from each other:
//   - "الجيولوجيا والأحياء" and "التاريخ والجغرافيا" had their two words
//     in the wrong order versus the department's real name — a cosmetic
//     typo that also means a plain string comparison against the sheet's
//     real names silently never matches.
//   - Philosophy + Psychology were grouped as their own two-subject
//     department ("علم النفس والفلسفة"); the real department is
//     "العلوم الفلسفية" and it has a third subject, الدستور, entirely
//     missing from every copy on this site.
//   - "الاقتصاد" (Economics) appeared as a subject/department in two
//     files. It isn't a real department or subject at this school at all
//     — dropped here rather than carried forward.
//   - الدستور، الاجتماعيات، الإحصاء، التربية البيئية، and
//     اللغة الفرنسية (اختيار حرّ) didn't exist anywhere on this site.
//
// Two mappings below look similar but answer different questions, and
// mixing them up is the one mistake to avoid when touching this file:
//   - SUBJECT_TO_DEPARTMENT answers "whose department is this subject
//     normally taught under" — one department per subject. This is what
//     decides a *person's own* department (resolveDepartmentName) and
//     everywhere authorization depends on that (firestore.rules,
//     index.js). Never widen this to more than one department per
//     subject — it would let someone edit data outside their real
//     department.
//   - SUBJECT_TO_ALLOWED_DEPARTMENTS answers "whose teachers may be
//     assigned to *teach* this subject" — several subjects allow two
//     departments, because الجغرافيا والتاريخ and العلوم الفلسفية sit
//     under one shared academic supervision at this school (a Geography
//     teacher can be scheduled to cover a Philosophy lesson, and vice
//     versa). This is what scheduling/cover-teacher pickers should widen
//     against — never authorization.

export const DEPARTMENTS = Object.freeze({
  ARABIC:              'اللغة العربية',
  ISLAMIC:             'التربية الإسلامية',
  ENGLISH:             'اللغة الإنجليزية',
  MATH:                'الرياضيات',
  PHYSICS_CHEMISTRY:   'الفيزياء والكيمياء',
  BIOLOGY_GEOLOGY:     'الأحياء والجيولوجيا',
  GEOGRAPHY_HISTORY:   'الجغرافيا والتاريخ',
  PHILOSOPHY_SCIENCES: 'العلوم الفلسفية',
  COMPUTER:            'الحاسوب',
  PE:                  'التربية البدنية',
  ART:                 'التربية الفنية',
  MUSIC:               'التربية الموسيقية',
  FRENCH:              'اللغة الفرنسية',
  LIBRARY:             'المكتبات',
  PRACTICAL_STUDIES:   'الدراسات العملية',
  COMMERCE:            'التجاري',
});

export const DEPARTMENT_LIST = Object.freeze(Object.values(DEPARTMENTS));

// subject name -> its one home department (mirrors CONSTANTS.SUBJECTS).
export const SUBJECT_TO_DEPARTMENT = Object.freeze({
  'اللغة العربية':               DEPARTMENTS.ARABIC,
  'التربية الإسلامية':           DEPARTMENTS.ISLAMIC,
  'اللغة الإنجليزية':            DEPARTMENTS.ENGLISH,
  'الرياضيات':                   DEPARTMENTS.MATH,
  'الفيزياء':                    DEPARTMENTS.PHYSICS_CHEMISTRY,
  'الكيمياء':                    DEPARTMENTS.PHYSICS_CHEMISTRY,
  'الأحياء':                     DEPARTMENTS.BIOLOGY_GEOLOGY,
  'الجيولوجيا':                  DEPARTMENTS.BIOLOGY_GEOLOGY,
  'الجغرافيا':                   DEPARTMENTS.GEOGRAPHY_HISTORY,
  'التاريخ':                     DEPARTMENTS.GEOGRAPHY_HISTORY,
  'الفلسفة':                     DEPARTMENTS.PHILOSOPHY_SCIENCES,
  'علم النفس':                   DEPARTMENTS.PHILOSOPHY_SCIENCES,
  'الدستور':                     DEPARTMENTS.PHILOSOPHY_SCIENCES,
  'الحاسوب':                     DEPARTMENTS.COMPUTER,
  'التربية البدنية':             DEPARTMENTS.PE,
  'التربية الفنية':              DEPARTMENTS.ART,
  'التربية الموسيقية':           DEPARTMENTS.MUSIC,
  'اللغة الفرنسية':              DEPARTMENTS.FRENCH,
  'المكتبات':                    DEPARTMENTS.LIBRARY,
  'الدراسات العملية':            DEPARTMENTS.PRACTICAL_STUDIES,
  'التجاري':                     DEPARTMENTS.COMMERCE,
  'الاجتماعيات':                 DEPARTMENTS.GEOGRAPHY_HISTORY,
  'التربية البيئية':             DEPARTMENTS.BIOLOGY_GEOLOGY,
  'الإحصاء':                     DEPARTMENTS.MATH,
  'اللغة الفرنسية (اختيار حرّ)': DEPARTMENTS.FRENCH,
});

export const SUBJECT_LIST = Object.freeze(Object.keys(SUBJECT_TO_DEPARTMENT));

// subject name -> every department whose teachers may be assigned to
// teach it. Only six subjects list two departments — the rest list the
// same single department as SUBJECT_TO_DEPARTMENT.
export const SUBJECT_TO_ALLOWED_DEPARTMENTS = Object.freeze({
  'التربية الإسلامية':           [DEPARTMENTS.ISLAMIC],
  'اللغة العربية':               [DEPARTMENTS.ARABIC],
  'اللغة الإنجليزية':            [DEPARTMENTS.ENGLISH],
  'اللغة الفرنسية':              [DEPARTMENTS.FRENCH],
  'الرياضيات':                   [DEPARTMENTS.MATH],
  'الكيمياء':                    [DEPARTMENTS.PHYSICS_CHEMISTRY],
  'الفيزياء':                    [DEPARTMENTS.PHYSICS_CHEMISTRY],
  'الأحياء':                     [DEPARTMENTS.BIOLOGY_GEOLOGY],
  'الجيولوجيا':                  [DEPARTMENTS.BIOLOGY_GEOLOGY],
  'التاريخ':                     [DEPARTMENTS.GEOGRAPHY_HISTORY, DEPARTMENTS.PHILOSOPHY_SCIENCES],
  'الجغرافيا':                   [DEPARTMENTS.GEOGRAPHY_HISTORY, DEPARTMENTS.PHILOSOPHY_SCIENCES],
  'الاجتماعيات':                 [DEPARTMENTS.GEOGRAPHY_HISTORY, DEPARTMENTS.PHILOSOPHY_SCIENCES],
  'الفلسفة':                     [DEPARTMENTS.PHILOSOPHY_SCIENCES, DEPARTMENTS.GEOGRAPHY_HISTORY],
  'علم النفس':                   [DEPARTMENTS.PHILOSOPHY_SCIENCES, DEPARTMENTS.GEOGRAPHY_HISTORY],
  'الدستور':                     [DEPARTMENTS.GEOGRAPHY_HISTORY, DEPARTMENTS.PHILOSOPHY_SCIENCES],
  'الحاسوب':                     [DEPARTMENTS.COMPUTER],
  'التربية البدنية':             [DEPARTMENTS.PE],
  'التربية الموسيقية':           [DEPARTMENTS.MUSIC],
  'التربية الفنية':              [DEPARTMENTS.ART],
  'التجاري':                     [DEPARTMENTS.COMMERCE],
  'المكتبات':                    [DEPARTMENTS.LIBRARY],
  'الدراسات العملية':            [DEPARTMENTS.PRACTICAL_STUDIES],
  'التربية البيئية':             [DEPARTMENTS.BIOLOGY_GEOLOGY],
  'الإحصاء':                     [DEPARTMENTS.MATH],
  'اللغة الفرنسية (اختيار حرّ)': [DEPARTMENTS.FRENCH],
});

// The official "تخصص داخلي" (internal specialization) pool for each
// department — what a new hire's specialization picker offers, and each
// teacher can hold up to two picks from their department's own pool (a
// primary and a second specialization). Corrected directly against the
// school's own account of its department structure — a previous pass
// here had widened الجغرافيا والتاريخ and العلوم الفلسفية to share one
// identical six-subject list, on the theory that these two departments'
// real specialization pools were fully interchangeable. They aren't: the
// two departments have their own separate leaders and their own distinct
// (overlapping, not identical) pools.
//
//   الجغرافيا والتاريخ   → الجغرافيا، الاجتماعيات
//   العلوم الفلسفية      → الدستور، علم النفس، الفلسفة، الاجتماعيات
//   الرياضيات            → الرياضيات، الإحصاء
//   الأحياء والجيولوجيا  → الأحياء، الجيولوجيا، التربية البيئية
//   الفيزياء والكيمياء   → الفيزياء، الكيمياء
//
// الاجتماعيات is the one subject genuinely shared by both pools — that
// part of the earlier overlap finding still holds. الرياضيات is now
// "merged" (2 specializations) too, which it never was before.
//
// ⚠️ This list is deliberately narrower than SUBJECT_TO_DEPARTMENT and
// SUBJECT_TO_ALLOWED_DEPARTMENTS above, which still cover all 25 real
// subjects — including التاريخ, which real teachers do carry as their
// subject under الجغرافيا والتاريخ even though it isn't one of that
// department's two official specialization picks. Those two maps decide
// authorization and scheduling eligibility for every subject a teacher
// might actually have on record; this one only decides what the
// add/edit-teacher form offers as a choice going forward. Narrowing this
// list must never mean narrowing those.
const DEPARTMENT_SPECIALIZATIONS = Object.freeze({
  [DEPARTMENTS.PHYSICS_CHEMISTRY]:   ['الفيزياء', 'الكيمياء'],
  [DEPARTMENTS.BIOLOGY_GEOLOGY]:     ['الأحياء', 'الجيولوجيا', 'التربية البيئية'],
  [DEPARTMENTS.GEOGRAPHY_HISTORY]:   ['الجغرافيا', 'التاريخ', 'الاجتماعيات', 'الدستور'],
  [DEPARTMENTS.PHILOSOPHY_SCIENCES]: ['الدستور', 'علم النفس', 'الفلسفة', 'الاجتماعيات'],
  [DEPARTMENTS.MATH]:                ['الرياضيات', 'الإحصاء'],
});

/**
 * Canonical department for a raw department-or-subject string as entered
 * on a teacher record. An already-canonical department name passes
 * through unchanged; a subject name resolves to its one home department
 * (SUBJECT_TO_DEPARTMENT); anything else (including '') passes through
 * as-is rather than being coerced to something it isn't.
 *
 * This is the *authorization* mapping — one department per input, never
 * widened. firestore.rules' canonicalDepartment() and index.js's
 * canonicalDepartment() must keep resolving every input the same way this
 * does; if you widen this, re-check both.
 */
export function resolveDepartmentName(rawValue) {
  const value = (rawValue || '').toString().trim();
  if (!value) return '';
  if (DEPARTMENT_LIST.includes(value)) return value;
  return SUBJECT_TO_DEPARTMENT[value] || value;
}

/** True for a department built around more than one specialization. */
export function isMergedDepartment(department) {
  const list = DEPARTMENT_SPECIALIZATIONS[resolveDepartmentName(department)];
  return Array.isArray(list) && list.length > 1;
}

/** The specialization choices for a merged department, or []. */
export function getMergedSubjectsForDepartment(department) {
  return (DEPARTMENT_SPECIALIZATIONS[resolveDepartmentName(department)] || []).slice();
}

export function getMergedDepartmentSpecializationMessage(department) {
  const subjects = getMergedSubjectsForDepartment(department);
  if (subjects.length < 2) return 'اختر التخصص.';
  return 'اختر التخصص: ' + subjects.join(' أو ') + '.';
}

/**
 * Every subject whose eligible teachers include this department —
 * derived from SUBJECT_TO_ALLOWED_DEPARTMENTS, so الجغرافيا والتاريخ and
 * العلوم الفلسفية each widen to the full shared set (التاريخ، الجغرافيا،
 * الاجتماعيات، الفلسفة، علم النفس، الدستور) automatically, with no
 * separate list to keep in sync.
 *
 * This is the *scheduling* mapping — use it for "which teachers can cover
 * this subject", never for authorization (use resolveDepartmentName for
 * that instead).
 */
export function getDepartmentSubjectFilters(department) {
  const dept = resolveDepartmentName(department);
  if (!dept) return [];
  const subjects = SUBJECT_LIST.filter((s) => SUBJECT_TO_ALLOWED_DEPARTMENTS[s].includes(dept));
  return subjects.length ? subjects : [dept];
}
