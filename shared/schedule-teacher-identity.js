// Only accept an old profile UID when it belongs unambiguously to one
// profile and is not the document ID of another teacher. Never match names.
export function teacherScheduleUids(uid, profiles) {
  const ids = new Set(profiles.map(profile => profile.id));
  const owners = new Map();
  for (const profile of profiles) {
    const alias = String(profile.uid || '').trim();
    if (!alias || ids.has(alias)) continue;
    if (!owners.has(alias)) owners.set(alias, new Set());
    owners.get(alias).add(profile.id);
  }
  return [uid, ...[...owners].filter(([, owners]) => owners.size === 1 && owners.has(uid)).map(([alias]) => alias)];
}
