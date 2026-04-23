/* =========================================================
   Focus Protocol — storage.js
   CRUD localStorage. Seul point d'accès à fp.* depuis l'app.
   ========================================================= */

const NS = 'fp';
export const SCHEMA_VERSION = 1;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(`${NS}.${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${NS}.${key}`, JSON.stringify(value));
  } catch (e) {
    console.error('[storage] write failed', key, e);
  }
}

export function getSchemaVersion() {
  return read('schemaVersion', null);
}

export function ensureSchema() {
  const current = getSchemaVersion();
  if (current === null) {
    write('schemaVersion', SCHEMA_VERSION);
    return SCHEMA_VERSION;
  }
  return current;
}

function emitDaysChanged() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('fp:days-changed'));
  }
}

export function todayISO(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/* =====================================================
   Settings
   ===================================================== */
const DEFAULT_SETTINGS = {
  startDate: null,
  apiKey: null,
  anchor: '',
  mentalState: '',
  briefStyle: 'entrepreneur',
  notifEnabled: false,
  morningTime: '07:00',
  eveningTime: '21:00',
  diagnosticProfile: null,
};

export function getSettings() {
  const s = read('settings', null);
  if (!s) {
    const init = { ...DEFAULT_SETTINGS, startDate: todayISO() };
    write('settings', init);
    return init;
  }
  return { ...DEFAULT_SETTINGS, ...s };
}

export function updateSettings(patch) {
  const s = getSettings();
  const next = { ...s, ...patch };
  write('settings', next);
  return next;
}

/* =====================================================
   Days (one record per YYYY-MM-DD)
   ===================================================== */
const DEFAULT_DAY = () => ({
  priorities: [
    { type: null, title: '', smallestAction: '', smallestActionApproved: null, done: false, doneAt: null },
    { type: null, title: '', smallestAction: '', smallestActionApproved: null, done: false, doneAt: null },
    { type: null, title: '', smallestAction: '', smallestActionApproved: null, done: false, doneAt: null },
  ],
  taskSwitches: [],
  zeigarnikNote: { text: '', quality: null, aiSuggestion: null },
  blocks: [],
  srhiScores: {},
  eveningReview: null,
});

export function getDay(dateISO = todayISO()) {
  const all = read('days', {});
  if (!all[dateISO]) {
    all[dateISO] = DEFAULT_DAY();
    write('days', all);
  }
  return all[dateISO];
}

export function updateDay(dateISO, patch) {
  const all = read('days', {});
  if (!all[dateISO]) all[dateISO] = DEFAULT_DAY();
  all[dateISO] = { ...all[dateISO], ...patch };
  write('days', all);
  emitDaysChanged();
  return all[dateISO];
}

export function replaceAllDays(nextDays) {
  write('days', nextDays || {});
  emitDaysChanged();
}

export function updatePriority(dateISO, index, patch) {
  const day = getDay(dateISO);
  day.priorities[index] = { ...day.priorities[index], ...patch };
  updateDay(dateISO, { priorities: day.priorities });
  return day.priorities[index];
}

export function addTaskSwitch(dateISO = todayISO()) {
  const day = getDay(dateISO);
  day.taskSwitches.push(Date.now());
  updateDay(dateISO, { taskSwitches: day.taskSwitches });
  return day.taskSwitches.length;
}

export function setZeigarnikNote(dateISO, text) {
  const day = getDay(dateISO);
  day.zeigarnikNote = { ...day.zeigarnikNote, text: text.trim() };
  updateDay(dateISO, { zeigarnikNote: day.zeigarnikNote });
  return day.zeigarnikNote;
}

export function setSRHI(dateISO, habit, scores) {
  const day = getDay(dateISO);
  day.srhiScores = { ...day.srhiScores, [habit]: scores };
  updateDay(dateISO, { srhiScores: day.srhiScores });
  return day.srhiScores;
}

export function getInboxDismissed(dateISO = todayISO()) {
  return getDay(dateISO).inboxDismissed || [];
}

export function dismissInboxItem(id, dateISO = todayISO()) {
  const day = getDay(dateISO);
  const current = day.inboxDismissed || [];
  if (current.includes(id)) return current;
  const next = [...current, id];
  updateDay(dateISO, { inboxDismissed: next });
  return next;
}

export function clearInboxDismissed(dateISO = todayISO()) {
  updateDay(dateISO, { inboxDismissed: [] });
}

export function srhiAverage(scores) {
  if (!scores || !scores.length) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / scores.length) * 10) / 10;
}

export function getDaysRange(fromISO, toISO) {
  const all = read('days', {});
  return Object.entries(all)
    .filter(([k]) => k >= fromISO && k <= toISO)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function getAllDays() {
  return read('days', {});
}

export function latestSRHI(habit) {
  const all = getAllDays();
  const entries = Object.entries(all).sort(([a], [b]) => b.localeCompare(a));
  for (const [, day] of entries) {
    if (day.srhiScores?.[habit]?.length === 7) return day.srhiScores[habit];
  }
  return null;
}

/* =====================================================
   Ritual
   ===================================================== */
export function getRitualLog() {
  return read('ritual.log', []);
}

export function incrementRitual(dateISO = todayISO()) {
  const log = getRitualLog();
  const existing = log.find(e => e.date === dateISO);
  if (existing) existing.count += 1;
  else log.push({ date: dateISO, count: 1 });
  write('ritual.log', log);
  return log;
}

export function getRitualCount(dateISO = todayISO()) {
  const entry = getRitualLog().find(e => e.date === dateISO);
  return entry ? entry.count : 0;
}

/* =====================================================
   Program
   ===================================================== */
const DEFAULT_PROGRAM = () => ({
  currentPhase: 1,
  phaseStartDate: todayISO(),
  activeHabits: ['3tasks'],
  automaticityHistory: {},
  weeklyDiagnostics: [],
});

export function getProgram() {
  const p = read('program', null);
  if (!p) {
    const init = DEFAULT_PROGRAM();
    write('program', init);
    return init;
  }
  return p;
}

export function updateProgram(patch) {
  const p = getProgram();
  const next = { ...p, ...patch };
  write('program', next);
  return next;
}

/* =====================================================
   Export / Import (pour S6 mais utile dès maintenant)
   ===================================================== */
export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    settings: getSettings(),
    days: read('days', {}),
    ritual: { log: getRitualLog() },
    program: getProgram(),
  };
}

export function importAll(payload) {
  if (!payload || payload.version !== 1) throw new Error('Format invalide');
  if (payload.schemaVersion && payload.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Schéma inconnu (v${payload.schemaVersion}) — mets à jour l'app.`);
  }
  if (payload.settings) write('settings', payload.settings);
  if (payload.days) write('days', payload.days);
  if (payload.ritual?.log) write('ritual.log', payload.ritual.log);
  if (payload.program) write('program', payload.program);
  write('schemaVersion', SCHEMA_VERSION);
}

export function resetAll() {
  ['settings', 'days', 'ritual.log', 'program', 'schemaVersion'].forEach(k => localStorage.removeItem(`${NS}.${k}`));
}
