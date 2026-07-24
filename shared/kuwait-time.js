const TIME_ZONE = "Asia/Kuwait";
export const DAY_AR_BY_INDEX = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"];

export function parseTimeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function kuwaitTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const mo = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${mo}-${d}`;
}

export function getCurrentKuwaitMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === "hour").value, 10) || 0;
  const m = parseInt(parts.find(p => p.type === "minute").value, 10) || 0;
  return h * 60 + m;
}

export function kuwaitDateTimeToDate(dateISO, hhmm) {
  return new Date(`${dateISO}T${hhmm}:00+03:00`);
}

export function addMinutesToDate(d, minutes) {
  const x = new Date(d.getTime());
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

export function getKuwaitWeekday() {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: TIME_ZONE }).format(new Date());
}

export function getKuwaitDayIndexSunThu() {
  const wd = getKuwaitWeekday();
  if (wd === "Sunday") return 0;
  if (wd === "Monday") return 1;
  if (wd === "Tuesday") return 2;
  if (wd === "Wednesday") return 3;
  if (wd === "Thursday") return 4;
  return -1;
}

export function getKuwaitDayNameSunThu() {
  const idx = getKuwaitDayIndexSunThu();
  return idx >= 0 ? DAY_AR_BY_INDEX[idx] : null;
}
