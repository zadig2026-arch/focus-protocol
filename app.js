/* =========================================================
   Focus Protocol — app.js (S2a)
   Router onglets + bindings état Aujourd'hui + rituel +1 basique
   ========================================================= */

import {
  todayISO,
  getSettings,
  updateSettings,
  getDay,
  updatePriority,
  addTaskSwitch,
  getRitualCount,
  incrementRitual,
  getRitualLog,
  setZeigarnikNote,
  setSRHI,
  srhiAverage,
  latestSRHI,
  exportAll,
  importAll,
  resetAll,
  getInboxDismissed,
  dismissInboxItem,
  clearInboxDismissed,
} from './storage.js';
import {
  hasApiKey,
  checkSmallestAction,
  evaluateZeigarnik,
  weeklyDiagnostic,
  getDebugPayload,
  invalidateContextCache,
  ApiError,
} from './api.js';

const TYPES = ['impact', 'urgence', 'facile'];
const TYPE_LABELS = { impact: 'IMPACT', urgence: 'URGENCE', facile: 'FACILITÉ' };

/* =====================================================
   Tab navigation
   ===================================================== */
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const screens = document.querySelectorAll('.screen');

  function activate(tabId) {
    screens.forEach(s => s.classList.toggle('active', s.dataset.tab === tabId));
    tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === tabId));
    if (history.replaceState) history.replaceState(null, '', `#${tabId}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  tabs.forEach(t => {
    t.addEventListener('click', e => {
      e.preventDefault();
      activate(t.dataset.tab);
    });
  });

  const initial = (location.hash || '#today').slice(1);
  const valid = Array.from(screens).some(s => s.dataset.tab === initial);
  activate(valid ? initial : 'today');
}

/* =====================================================
   Aujourd'hui — rendu des priorités depuis le state
   ===================================================== */
function renderPriorities() {
  const day = getDay();
  const cards = document.querySelectorAll('[data-priority]');

  cards.forEach((card, i) => {
    const p = day.priorities[i];

    const badge = card.querySelector('.badge');
    const titleDisplay = card.querySelector('.priority-title-display');
    const titleInput = card.querySelector('.priority-title');
    const smallestInput = card.querySelector('.smallest-input');
    const checkbox = card.querySelector('.check-done input');
    const rank = card.querySelector('.priority-rank');

    // Badge
    badge.className = 'badge';
    if (p.type) {
      badge.classList.add(`badge-${p.type}`);
      badge.textContent = TYPE_LABELS[p.type];
    } else {
      badge.classList.add('badge-empty');
      badge.textContent = 'TYPE';
    }

    // Title
    titleInput.value = p.title;
    titleDisplay.textContent = p.title || 'Nouvelle tâche';
    titleDisplay.classList.toggle('is-placeholder', !p.title);

    // Smallest action
    smallestInput.value = p.smallestAction;

    // Done state
    checkbox.checked = !!p.done;
    card.classList.toggle('priority-done', !!p.done);

    // Rank — shows number or check when done
    if (p.done) {
      rank.innerHTML = '<svg class="icon check-mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    } else {
      rank.textContent = String(i + 1);
    }
  });
}

function bindPriorityHandlers() {
  const cards = document.querySelectorAll('[data-priority]');

  cards.forEach((card, i) => {
    const badge = card.querySelector('.badge');
    const titleInput = card.querySelector('.priority-title');
    const smallestInput = card.querySelector('.smallest-input');
    const checkbox = card.querySelector('.check-done input');

    // Cycle type on badge tap (empêche l'ouverture/fermeture du details)
    badge.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const current = getDay().priorities[i].type;
      const idx = current ? TYPES.indexOf(current) : -1;
      const next = TYPES[(idx + 1) % TYPES.length];
      updatePriority(todayISO(), i, { type: next });
      renderPriorities();
      if (navigator.vibrate) navigator.vibrate(10);
    });

    // Title autosave on blur
    titleInput.addEventListener('blur', () => {
      const v = titleInput.value.trim();
      updatePriority(todayISO(), i, { title: v });
      const display = card.querySelector('.priority-title-display');
      display.textContent = v || 'Nouvelle tâche';
      display.classList.toggle('is-placeholder', !v);
    });
    titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    });

    // Smallest action autosave on blur
    smallestInput.addEventListener('blur', () => {
      const v = smallestInput.value.trim();
      updatePriority(todayISO(), i, { smallestAction: v, smallestActionApproved: null });
    });

    // Checkbox done
    checkbox.addEventListener('change', () => {
      const done = checkbox.checked;
      updatePriority(todayISO(), i, {
        done,
        doneAt: done ? new Date().toISOString() : null,
      });
      renderPriorities();
      if (done && navigator.vibrate) navigator.vibrate([15, 30, 15]);
    });
  });
}

/* =====================================================
   Task switch counter
   ===================================================== */
function renderSwitchCounter() {
  const day = getDay();
  const el = document.querySelector('[data-switch-count]');
  if (el) el.textContent = String(day.taskSwitches.length);
}

function bindSwitchCounter() {
  const btn = document.querySelector('[data-switch-add]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    addTaskSwitch();
    renderSwitchCounter();
    if (navigator.vibrate) navigator.vibrate(10);
  });
}

/* =====================================================
   Zeigarnik recall (shows yesterday's note if exists)
   ===================================================== */
function renderZeigarnikRecall() {
  const card = document.querySelector('[data-zeigarnik-recall]');
  if (!card) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterdayISO = todayISO(y);
  const yesterday = getDay(yesterdayISO);
  const note = yesterday?.zeigarnikNote?.text || '';
  if (!note) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  card.querySelector('.zeigarnik-text').textContent = `« ${note} »`;
}

/* =====================================================
   Ritual — count, streak, calendar, anchor inputs
   ===================================================== */
function renderRitualCount() {
  const el = document.querySelector('[data-ritual-count]');
  if (el) el.textContent = `+${getRitualCount()}`;
}

function computeStreaks(log) {
  if (!log || !log.length) return { current: 0, record: 0 };
  const usedDates = new Set(log.filter(e => e.count > 0).map(e => e.date));

  // Record: plus longue suite de jours consécutifs
  let record = 0;
  const sorted = [...usedDates].sort();
  let run = 0;
  let prevISO = null;
  for (const iso of sorted) {
    if (prevISO) {
      const prev = new Date(prevISO);
      const curr = new Date(iso);
      const diff = Math.round((curr - prev) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > record) record = run;
    prevISO = iso;
  }

  // Current streak : remonte depuis aujourd'hui (ou hier si rien aujourd'hui)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let walker = new Date(today);
  if (!usedDates.has(todayISO(walker))) {
    walker.setDate(walker.getDate() - 1);
  }
  let current = 0;
  while (usedDates.has(todayISO(walker))) {
    current += 1;
    walker.setDate(walker.getDate() - 1);
  }
  return { current, record };
}

function renderRitualStreak() {
  const { current, record } = computeStreaks(getRitualLog());
  const streakEl = document.querySelector('[data-ritual-streak]');
  const recordEl = document.querySelector('[data-ritual-record]');
  if (streakEl) streakEl.textContent = String(current);
  if (recordEl) recordEl.textContent = `${record} jour${record > 1 ? 's' : ''}`;
}

function renderRitualCalendar() {
  const grid = document.querySelector('[data-ritual-grid]');
  const monthEl = document.querySelector('[data-ritual-month]');
  if (!grid) return;
  grid.innerHTML = '';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayNum = now.getDate();

  if (monthEl) {
    const formatted = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    monthEl.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // Lundi = 0
  const lastDay = new Date(year, month + 1, 0).getDate();

  const counts = Object.fromEntries(getRitualLog().map(e => [e.date, e.count]));

  // Padding avant
  for (let i = 0; i < firstDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell cal-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cnt = counts[iso] || 0;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.title = `${iso} — ${cnt} utilisation${cnt > 1 ? 's' : ''}`;
    if (d > todayNum) {
      cell.classList.add('cal-future');
    } else {
      if (cnt >= 4) cell.classList.add('dot-3');
      else if (cnt >= 2) cell.classList.add('dot-2');
      else if (cnt >= 1) cell.classList.add('dot-1');
    }
    if (d === todayNum) cell.classList.add('dot-today');
    grid.appendChild(cell);
  }
}

function renderRitualInputs() {
  const s = getSettings();
  const anchorEl = document.querySelector('[data-ritual-anchor]');
  const mentalEl = document.querySelector('[data-ritual-mental]');
  if (anchorEl && anchorEl !== document.activeElement) anchorEl.value = s.anchor || '';
  if (mentalEl && mentalEl !== document.activeElement) mentalEl.value = s.mentalState || '';
}

function bindRitualInputs() {
  const anchorEl = document.querySelector('[data-ritual-anchor]');
  const mentalEl = document.querySelector('[data-ritual-mental]');
  anchorEl?.addEventListener('blur', () => updateSettings({ anchor: anchorEl.value.trim() }));
  mentalEl?.addEventListener('blur', () => updateSettings({ mentalState: mentalEl.value.trim() }));
}

function refreshRitual() {
  renderRitualCount();
  renderRitualStreak();
  renderRitualCalendar();
}

function bindRitual() {
  const btn = document.querySelector('[data-ritual-use]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    incrementRitual();
    refreshRitual();
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  });
}

/* =====================================================
   Header date + day counter + current phase
   ===================================================== */
function computeProgram() {
  const settings = getSettings();
  const start = new Date(settings.startDate);
  const now = new Date();
  const dayNum = Math.max(1, Math.floor((now - start) / 86400000) + 1);
  const totalDays = 84;
  const globalPct = Math.min(100, Math.round((dayNum / totalDays) * 100));

  let phase = 1;
  if (dayNum > 84) phase = 4;
  else if (dayNum > 56) phase = 3;
  else if (dayNum > 28) phase = 2;

  // days into current phase / phase length
  const phaseRanges = { 1: [1, 28], 2: [29, 56], 3: [57, 84], 4: [85, 150] };
  const [a, b] = phaseRanges[phase];
  const phaseLen = b - a + 1;
  const phaseDayIdx = Math.min(phaseLen, Math.max(1, dayNum - a + 1));
  const phasePct = Math.round((phaseDayIdx / phaseLen) * 100);

  return { dayNum, globalPct, phase, phasePct };
}

const PHASE_NAMES = { 1: 'Fondation', 2: 'Exécution', 3: 'Ancrage profond', 4: 'Consolidation' };

function renderHeader() {
  const { dayNum, phase } = computeProgram();
  const now = new Date();

  const dateEls = document.querySelectorAll('[data-today-date]');
  const formatted = now.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  dateEls.forEach(el => el.textContent = formatted);

  const dayEls = document.querySelectorAll('[data-day-counter]');
  dayEls.forEach(el => el.textContent = `Jour ${dayNum} / 84`);

  // Phase label in today header
  const phaseNameEl = document.querySelector('#today-phase-name') || document.querySelector('section[data-tab="today"] .phase-name');
  if (phaseNameEl) phaseNameEl.textContent = `Phase ${phase} — ${PHASE_NAMES[phase]}`;
}

/* =====================================================
   Programme screen — dynamic
   ===================================================== */
function renderProgramme() {
  const { dayNum, globalPct, phase, phasePct } = computeProgram();

  const fill = document.querySelector('[data-program-fill]');
  if (fill) fill.style.width = `${globalPct}%`;
  const pctEl = document.querySelector('[data-program-percent]');
  if (pctEl) pctEl.textContent = `${globalPct} %`;

  // Mark active phase card
  const phaseCards = document.querySelectorAll('section[data-tab="program"] .phase-card');
  phaseCards.forEach((card, i) => {
    const isActive = (i + 1) === phase;
    card.classList.toggle('phase-active', isActive);
    card.classList.toggle('phase-locked', !isActive && (i + 1) > phase);
    const statusEl = card.querySelector('.phase-card-status');
    if (statusEl) {
      if (isActive) {
        statusEl.textContent = 'En cours';
        statusEl.classList.remove('locked');
      } else if ((i + 1) < phase) {
        statusEl.textContent = 'Terminée';
        statusEl.classList.remove('locked');
      } else {
        statusEl.textContent = 'Verrouillée';
        statusEl.classList.add('locked');
      }
    }
  });

  // Active phase fill
  const activeFill = document.querySelector('section[data-tab="program"] .phase-active .phase-card-fill');
  if (activeFill) activeFill.style.width = `${phasePct}%`;

  // SRHI score for Loi des 3 tâches (dernier dimanche)
  const latest = latestSRHI('3tasks');
  const scoreEl = document.querySelector('section[data-tab="program"] .phase-active .srhi-score');
  if (scoreEl) {
    if (latest) {
      const avg = srhiAverage(latest);
      scoreEl.innerHTML = `${avg}<span class="srhi-max"> / 7</span>`;
    } else {
      scoreEl.innerHTML = `—<span class="srhi-max"> / 7</span>`;
    }
  }
}

/* =====================================================
   Settings screen
   ===================================================== */
function renderSettings() {
  const s = getSettings();
  const fields = {
    '[data-setting-apikey]': s.apiKey || '',
    '[data-setting-morning-time]': s.morningTime || '07:00',
    '[data-setting-evening-time]': s.eveningTime || '21:00',
    '[data-setting-brief-style]': s.briefStyle || 'entrepreneur',
    '[data-setting-gistid]': s.gistId || '',
    '[data-setting-githubtoken]': s.githubToken || '',
  };
  Object.entries(fields).forEach(([sel, val]) => {
    const el = document.querySelector(sel);
    if (el && el !== document.activeElement) el.value = val;
  });
  const startEl = document.querySelector('[data-setting-startdate]');
  if (startEl) startEl.textContent = s.startDate || '—';
}

function bindSettings() {
  const api = document.querySelector('[data-setting-apikey]');
  api?.addEventListener('blur', () => {
    updateSettings({ apiKey: api.value.trim() || null });
    toggleAIElements();
  });

  const morning = document.querySelector('[data-setting-morning-time]');
  morning?.addEventListener('change', () => updateSettings({ morningTime: morning.value }));

  const evening = document.querySelector('[data-setting-evening-time]');
  evening?.addEventListener('change', () => updateSettings({ eveningTime: evening.value }));

  const brief = document.querySelector('[data-setting-brief-style]');
  brief?.addEventListener('change', () => updateSettings({ briefStyle: brief.value }));

  const gistId = document.querySelector('[data-setting-gistid]');
  gistId?.addEventListener('blur', () => updateSettings({ gistId: gistId.value.trim() || null }));

  const ghToken = document.querySelector('[data-setting-githubtoken]');
  ghToken?.addEventListener('blur', () => updateSettings({ githubToken: ghToken.value.trim() || null }));

  document.querySelector('[data-copy-scanner-config]')?.addEventListener('click', () => {
    const s = getSettings();
    if (!s.gistId || !s.githubToken) {
      showToast('Renseigne d\'abord Gist ID + Token');
      return;
    }
    const cmd = `mkdir -p ~/.focus-protocol && cat > ~/.focus-protocol/gist.json <<'EOF'
{"gistId":"${s.gistId}","token":"${s.githubToken}"}
EOF`;
    navigator.clipboard?.writeText(cmd);
    showToast('Commande copiée — colle dans ton terminal Mac');
  });

  document.querySelector('[data-export]')?.addEventListener('click', doExport);

  const importFile = document.querySelector('[data-import-file]');
  document.querySelector('[data-import]')?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) doImport(f);
    e.target.value = '';
  });

  document.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (confirm('Tout réinitialiser ? Toutes tes données (tâches, SRHI, rituel, réglages) seront effacées. Action irréversible.')) {
      resetAll();
      location.reload();
    }
  });

  document.querySelector('[data-markdown-report]')?.addEventListener('click', doMarkdownReport);
}

function doMarkdownReport() {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(todayISO(d));
  }
  const allDays = JSON.parse(localStorage.getItem('fp.days') || '{}');
  const ritualLog = JSON.parse(localStorage.getItem('fp.ritual.log') || '[]');
  const ritualByDate = Object.fromEntries(ritualLog.map(e => [e.date, e.count]));

  const lines = [
    `# Rapport Focus Protocol — semaine du ${days[0]} au ${days[6]}`,
    ``,
    `## Jour par jour`,
    ``,
  ];
  days.forEach(iso => {
    const d = allDays[iso];
    if (!d) { lines.push(`- **${iso}** · aucune donnée`); return; }
    const done = (d.priorities || []).filter(p => p.done).length;
    const total = (d.priorities || []).filter(p => p.title?.trim()).length;
    const switches = (d.taskSwitches || []).length;
    const ritual = ritualByDate[iso] || 0;
    const zeig = d.zeigarnikNote?.text || '';
    lines.push(`- **${iso}** · ${done}/${total} tâches · ${switches} switches · ${ritual} rituel${zeig ? ` · Zeigarnik : « ${zeig} »` : ''}`);
  });

  const weekSRHI = days.map(iso => allDays[iso]?.srhiScores?.['3tasks']).find(Boolean);
  if (weekSRHI && weekSRHI.length) {
    const avg = weekSRHI.reduce((a, b) => a + b, 0) / weekSRHI.length;
    lines.push('', `## SRHI — Loi des 3 tâches`, `Score moyen : **${avg.toFixed(1)} / 7**`);
  }

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-report-${days[6]}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText(text);
  showToast('Rapport téléchargé + copié');
}

function doExport() {
  const data = exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focus-protocol-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function doImport(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    importAll(data);
    alert('Import réussi. L\'app va recharger.');
    location.reload();
  } catch (e) {
    alert(`Import échoué : ${e.message}`);
  }
}

/* =====================================================
   Timer 120s plein écran
   ===================================================== */
const TIMER_DURATION = 120; // seconds
const RING_CIRCUMFERENCE = 2 * Math.PI * 72; // ~452.39

let timerInterval = null;
let timerSecondsLeft = 0;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function openTimer(priorityIndex) {
  const day = getDay();
  const p = day.priorities[priorityIndex];
  const action = p.smallestAction || p.title || 'Démarre ta plus petite action';

  const overlay = document.querySelector('[data-timer-overlay]');
  overlay.querySelector('[data-timer-action]').textContent = action;
  overlay.hidden = false;
  document.body.classList.add('modal-open');

  timerSecondsLeft = TIMER_DURATION;
  updateTimerUI();

  timerInterval = setInterval(() => {
    timerSecondsLeft -= 1;
    updateTimerUI();
    if (timerSecondsLeft <= 0) finishTimer();
  }, 1000);
}

function updateTimerUI() {
  const countEl = document.querySelector('[data-timer-countdown]');
  const progEl = document.querySelector('[data-timer-progress]');
  if (countEl) countEl.textContent = formatTime(Math.max(0, timerSecondsLeft));
  if (progEl) {
    const ratio = Math.max(0, timerSecondsLeft) / TIMER_DURATION;
    const offset = RING_CIRCUMFERENCE * (1 - ratio);
    progEl.style.strokeDashoffset = String(offset);
  }
}

function closeTimer(withVibration = false) {
  clearInterval(timerInterval);
  timerInterval = null;
  const overlay = document.querySelector('[data-timer-overlay]');
  overlay.hidden = true;
  document.body.classList.remove('modal-open');
  if (withVibration && navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 120]);
}

function finishTimer() {
  closeTimer(true);
}

function bindTimer() {
  document.querySelectorAll('[data-timer-start]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-priority]');
      const i = Number(card?.dataset.priority ?? 0);
      openTimer(i);
      if (navigator.vibrate) navigator.vibrate(15);
    });
  });
  document.querySelector('[data-timer-cancel]')?.addEventListener('click', () => closeTimer());
  document.querySelector('[data-timer-done]')?.addEventListener('click', () => {
    closeTimer();
    if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
  });
}

/* =====================================================
   Close-day modal — SRHI + Zeigarnik
   ===================================================== */
const SRHI_STATEMENTS = [
  "Faire mes 3 tâches est quelque chose que je fais automatiquement.",
  "…que je fais sans y penser.",
  "…que je fais sans devoir me le rappeler.",
  "…que je commence à faire avant de réaliser que je suis en train de le faire.",
  "…qui fait maintenant partie de ma routine.",
  "…qu'il me serait étrange de ne pas faire.",
  "…que j'aurais du mal à éviter de faire.",
];

let srhiCurrent = [null, null, null, null, null, null, null];

function renderSRHI() {
  const list = document.querySelector('[data-srhi-list]');
  if (!list) return;
  list.innerHTML = '';
  SRHI_STATEMENTS.forEach((txt, i) => {
    const item = document.createElement('div');
    item.className = 'srhi-item';
    item.innerHTML = `
      <p class="srhi-statement">${txt}</p>
      <div class="srhi-scale" data-srhi-row="${i}"></div>
    `;
    const row = item.querySelector('.srhi-scale');
    for (let v = 1; v <= 7; v++) {
      const btn = document.createElement('button');
      btn.className = 'srhi-btn';
      btn.textContent = String(v);
      btn.dataset.value = String(v);
      if (srhiCurrent[i] === v) btn.classList.add('active');
      btn.addEventListener('click', () => {
        srhiCurrent[i] = v;
        row.querySelectorAll('.srhi-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateSaveState();
        if (navigator.vibrate) navigator.vibrate(6);
      });
      row.appendChild(btn);
    }
    list.appendChild(item);
  });
}

function updateCloseSummary() {
  const day = getDay();
  const done = day.priorities.filter(p => p.done).length;
  const switches = day.taskSwitches.length;
  const ritual = getRitualCount();
  document.querySelector('[data-close-done]').textContent = `${done} / 3`;
  document.querySelector('[data-close-switches]').textContent = String(switches);
  document.querySelector('[data-close-ritual]').textContent = String(ritual);
}

function isSRHIDay() {
  return new Date().getDay() === 0; // dimanche uniquement
}

function updateSaveState() {
  const needsSRHI = isSRHIDay();
  const allAnswered = !needsSRHI || srhiCurrent.every(v => v !== null);
  const btn = document.querySelector('[data-close-save]');
  if (btn) btn.disabled = !allAnswered;
}

function openCloseModal() {
  const day = getDay();
  const srhiDay = isSRHIDay();

  // Titre dynamique
  const title = document.querySelector('.modal-title');
  if (title) title.textContent = srhiDay ? 'Revue de la semaine' : 'Clôture de journée';

  // Section SRHI + Diagnostic (dimanche uniquement)
  const srhiSection = document.querySelector('[data-srhi-section]');
  if (srhiSection) srhiSection.hidden = !srhiDay;
  const diagSection = document.querySelector('[data-diag-section]');
  if (diagSection) diagSection.hidden = !srhiDay;

  // Reset diagnostic UI
  const diagResult = document.querySelector('[data-weekly-diag-result]');
  if (diagResult) diagResult.innerHTML = '';
  const diagBtn = document.querySelector('[data-weekly-diag]');
  if (diagBtn) { diagBtn.hidden = false; diagBtn.disabled = false; }

  if (srhiDay) {
    const existing = day.srhiScores?.['3tasks'];
    srhiCurrent = existing && existing.length === 7 ? [...existing] : [null, null, null, null, null, null, null];
    renderSRHI();
  }

  updateCloseSummary();
  updateSaveState();

  const zeigarnikField = document.querySelector('[data-close-zeigarnik]');
  zeigarnikField.value = day.zeigarnikNote?.text || '';

  const modal = document.querySelector('[data-close-modal]');
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeCloseModal() {
  const modal = document.querySelector('[data-close-modal]');
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

function saveCloseModal() {
  const srhiDay = isSRHIDay();
  if (srhiDay && srhiCurrent.some(v => v === null)) return;
  const today = todayISO();
  if (srhiDay) {
    setSRHI(today, '3tasks', srhiCurrent);
    renderProgramme(); // met à jour le score SRHI affiché
  }
  const note = document.querySelector('[data-close-zeigarnik]').value.trim();
  setZeigarnikNote(today, note);
  closeCloseModal();
  if (navigator.vibrate) navigator.vibrate([20, 40, 20, 40, 60]);
}

function bindCloseModal() {
  document.querySelector('[data-close-day]')?.addEventListener('click', openCloseModal);
  document.querySelector('[data-close-modal-dismiss]')?.addEventListener('click', closeCloseModal);
  document.querySelector('[data-close-save]')?.addEventListener('click', saveCloseModal);
  document.querySelector('[data-weekly-diag]')?.addEventListener('click', runWeeklyDiagnostic);
  // Tap on backdrop closes
  const modal = document.querySelector('[data-close-modal]');
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeCloseModal();
  });
}

/* =====================================================
   AI feedback UI — injected under smallest-action input
   ===================================================== */
function renderAIFeedback(container, { level, why, suggestion, onApply }) {
  // level: 'ok' | 'warn' | 'error' | 'loading'
  let el = container.querySelector('.ai-feedback');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ai-feedback';
    container.appendChild(el);
  }
  el.className = `ai-feedback ai-feedback-${level}`;
  if (level === 'loading') {
    el.innerHTML = `<span class="ai-spinner"></span><span class="ai-feedback-text">Claude analyse…</span>`;
    return el;
  }
  const hasApply = suggestion && onApply;
  el.innerHTML = `
    <div class="ai-feedback-body">
      ${why ? `<p class="ai-feedback-why">${escapeHtml(why)}</p>` : ''}
      ${suggestion ? `<p class="ai-feedback-suggest">${escapeHtml(suggestion)}</p>` : ''}
    </div>
    ${hasApply ? `<button class="ai-feedback-apply" type="button">Utiliser</button>` : ''}
  `;
  if (hasApply) {
    el.querySelector('.ai-feedback-apply').addEventListener('click', () => {
      onApply(suggestion);
      clearAIFeedback(container);
    });
  }
  return el;
}
function clearAIFeedback(container) {
  container.querySelector('.ai-feedback')?.remove();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* =====================================================
   Hook 4.3 — Smallest action checker (bouton 🔍)
   ===================================================== */
function bindAICheckHandlers() {
  document.querySelectorAll('[data-ai-check]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-priority]');
      const i = Number(card.dataset.priority);
      const title = card.querySelector('.priority-title').value.trim();
      const smallestInput = card.querySelector('.smallest-input');
      const action = smallestInput.value.trim();
      const container = card.querySelector('.priority-body');

      if (!action) {
        renderAIFeedback(container, { level: 'warn', why: 'Remplis d\'abord le champ plus petite action.' });
        return;
      }
      if (!hasApiKey()) {
        renderAIFeedback(container, { level: 'warn', why: 'Ajoute ta clé API Anthropic dans Réglages.' });
        return;
      }

      renderAIFeedback(container, { level: 'loading' });
      btn.disabled = true;

      try {
        const res = await checkSmallestAction(title, action);
        if (res.verdict === 'ok') {
          renderAIFeedback(container, { level: 'ok', why: res.why || 'Action infaillible.' });
          updatePriority(todayISO(), i, { smallestActionApproved: true });
          if (navigator.vibrate) navigator.vibrate(15);
        } else {
          renderAIFeedback(container, {
            level: 'warn',
            why: res.why || 'Cette action n\'est pas assez petite.',
            suggestion: res.suggestion,
            onApply: (val) => {
              smallestInput.value = val;
              updatePriority(todayISO(), i, { smallestAction: val, smallestActionApproved: null });
            },
          });
          if (navigator.vibrate) navigator.vibrate([8, 40, 8]);
        }
      } catch (e) {
        renderAIFeedback(container, {
          level: 'error',
          why: e instanceof ApiError ? e.message : 'Erreur inconnue',
        });
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/* =====================================================
   Hook 4.2 — Zeigarnik evaluator (au blur du textarea)
   ===================================================== */
function bindZeigarnikEvaluator() {
  const field = document.querySelector('[data-close-zeigarnik]');
  if (!field) return;

  const container = field.parentElement;
  let lastText = '';

  field.addEventListener('blur', async () => {
    const text = field.value.trim();
    if (!text || text === lastText) return;
    lastText = text;
    if (!hasApiKey()) return; // silencieux si pas de clé

    renderAIFeedback(container, { level: 'loading' });
    try {
      const res = await evaluateZeigarnik(text);
      if (res.quality === 'clear') {
        renderAIFeedback(container, { level: 'ok', why: 'Note claire et déclenchable.' });
      } else if (res.quality === 'vague') {
        renderAIFeedback(container, {
          level: 'warn',
          why: res.why,
          suggestion: res.reformulation,
          onApply: (val) => { field.value = val; lastText = val; },
        });
      } else {
        clearAIFeedback(container);
      }
    } catch (e) {
      // silencieux — ne pas bloquer l'UX
      clearAIFeedback(container);
    }
  });
}

/* =====================================================
   Hook 4.4 — Weekly diagnostic (dimanche)
   ===================================================== */
async function runWeeklyDiagnostic() {
  const btn = document.querySelector('[data-weekly-diag]');
  const container = document.querySelector('[data-weekly-diag-result]');
  if (!btn || !container) return;

  if (!hasApiKey()) {
    container.innerHTML = `<p class="ai-feedback-why">Ajoute ta clé API Anthropic dans Réglages pour recevoir un diagnostic.</p>`;
    return;
  }

  btn.disabled = true;
  container.innerHTML = `<div class="ai-feedback ai-feedback-loading"><span class="ai-spinner"></span><span class="ai-feedback-text">Claude analyse ta semaine…</span></div>`;

  try {
    const diag = await weeklyDiagnostic();
    const order = ['3tasks', 'zeigarnik', 'ritual', 'smallestAction', 'batching'];
    const labels = { '3tasks': 'Loi des 3 tâches', zeigarnik: 'Zeigarnik', ritual: 'Rituel', smallestAction: 'Plus petite action', batching: 'Batching' };
    container.innerHTML = `
      <div class="diag-block">
        ${order.map(k => diag[k] ? `
          <div class="diag-row">
            <div class="diag-row-head">
              <span class="diag-row-label">${labels[k]}</span>
              <span class="diag-row-score">${diag[k].score}<span class="diag-row-max">/10</span></span>
            </div>
            <p class="diag-row-obs">${escapeHtml(diag[k].observation || '')}</p>
          </div>
        ` : '').join('')}
        ${diag.nextWeekAction ? `
          <div class="diag-next">
            <span class="diag-next-label">Action pour la semaine prochaine</span>
            <p>${escapeHtml(diag.nextWeekAction)}</p>
          </div>
        ` : ''}
      </div>
    `;
    btn.hidden = true;
  } catch (e) {
    container.innerHTML = `<div class="ai-feedback ai-feedback-error"><p>${escapeHtml(e.message || 'Erreur')}</p></div>`;
    btn.disabled = false;
  }
}

/* =====================================================
   Debug viewer dans Settings
   ===================================================== */
function renderDebugViewer() {
  const container = document.querySelector('[data-debug-content]');
  if (!container) return;
  const { expertPrompt, user7dContext, promptTokensEstimate } = getDebugPayload();
  container.innerHTML = `
    <p class="settings-hint" style="padding:0 0 8px">Estimation : ${promptTokensEstimate} tokens envoyés à chaque appel (cached après le 1er). Lecture seule.</p>
    <div class="debug-section">
      <div class="debug-label">EXPERT_SYSTEM_PROMPT</div>
      <pre class="debug-pre" data-debug-expert></pre>
      <button class="debug-copy" data-copy-target="data-debug-expert">Copier</button>
    </div>
    <div class="debug-section">
      <div class="debug-label">user7dContext (régénéré 1x/jour)</div>
      <pre class="debug-pre" data-debug-context></pre>
      <button class="debug-copy" data-copy-target="data-debug-context">Copier</button>
    </div>
  `;
  container.querySelector('[data-debug-expert]').textContent = expertPrompt;
  container.querySelector('[data-debug-context]').textContent = user7dContext;

  container.querySelectorAll('.debug-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.copyTarget;
      const text = container.querySelector(`[${target}]`)?.textContent || '';
      navigator.clipboard?.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copié ✓';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });
  });
}

/* =====================================================
   Toggle visibility of AI-only elements based on API key
   ===================================================== */
function toggleAIElements() {
  const on = hasApiKey();
  document.querySelectorAll('[data-ai-check], [data-ai-decompose]').forEach(el => {
    el.hidden = !on;
  });
}

/* =====================================================
   Inbox IA — fetch + render + promote
   ===================================================== */
const TYPE_LABELS_SHORT = { impact: 'IMPACT', urgence: 'URGENCE', facile: 'FACILITÉ' };
const SOURCE_LABELS = {
  git: 'git', 'claude-code': 'claude code', cc: 'claude code',
  gmail: 'mail', calendar: 'agenda', notes: 'notes',
};

let inboxCache = null;

async function fetchSuggestions() {
  const settings = getSettings();
  const { gistId, githubToken } = settings;

  // 1. Essayer Gist si configuré (pour iPhone + cross-device)
  if (gistId && githubToken) {
    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
        },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.files?.['suggestions.json']?.content;
        if (content) {
          try { return JSON.parse(content); } catch {}
        }
      } else {
        console.warn('[api] Gist fetch failed', res.status);
      }
    } catch (e) {
      console.warn('[api] Gist network error', e);
    }
  }

  // 2. Fallback local (Mac dev)
  try {
    const res = await fetch(`suggestions.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function formatScanTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `scanné à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderInbox() {
  const section = document.querySelector('[data-inbox-section]');
  const list = document.querySelector('[data-inbox-list]');
  const empty = document.querySelector('[data-inbox-empty]');
  const meta = document.querySelector('[data-inbox-meta]');
  if (!section || !list) return;

  if (!inboxCache || !inboxCache.suggestions?.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (meta) meta.textContent = formatScanTime(inboxCache.generatedAt);

  const dismissed = new Set(getInboxDismissed());
  const visible = inboxCache.suggestions.filter(s => !dismissed.has(s.id));

  list.innerHTML = '';

  if (!visible.length) {
    list.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  list.hidden = false;
  if (empty) empty.hidden = true;

  const day = getDay();
  const filledSlots = day.priorities.map(p => Boolean(p.title?.trim()));

  visible.forEach(s => {
    const type = (s.type || '').toLowerCase();
    const typeLabel = TYPE_LABELS_SHORT[type] || 'TYPE';
    const badgeClass = type ? `badge-${type}` : 'badge-empty';
    const sourceLabel = SOURCE_LABELS[s.source] || s.source || '—';

    const card = document.createElement('article');
    card.className = 'inbox-card';
    card.dataset.inboxId = s.id;
    card.innerHTML = `
      <div class="inbox-card-head">
        <span class="badge ${badgeClass}">${typeLabel}</span>
        <span class="inbox-card-source">${sourceLabel}</span>
      </div>
      <p class="inbox-card-title"></p>
      <p class="inbox-card-rationale"></p>
      <div class="inbox-card-actions">
        <button class="inbox-slot-btn${filledSlots[0] ? ' is-filled' : ''}" data-inbox-promote="0">→ 1</button>
        <button class="inbox-slot-btn${filledSlots[1] ? ' is-filled' : ''}" data-inbox-promote="1">→ 2</button>
        <button class="inbox-slot-btn${filledSlots[2] ? ' is-filled' : ''}" data-inbox-promote="2">→ 3</button>
        <button class="inbox-dismiss" data-inbox-dismiss aria-label="Ignorer">✕</button>
      </div>
    `;
    // Inject texts via textContent to avoid any injection issues
    card.querySelector('.inbox-card-title').textContent = s.title || '';
    card.querySelector('.inbox-card-rationale').textContent = s.rationale || '';

    card.querySelectorAll('[data-inbox-promote]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.dataset.inboxPromote);
        promoteSuggestion(s, slot);
      });
    });
    card.querySelector('[data-inbox-dismiss]').addEventListener('click', () => {
      dismissInboxItem(s.id);
      renderInbox();
      if (navigator.vibrate) navigator.vibrate(8);
    });

    list.appendChild(card);
  });
}

function promoteSuggestion(suggestion, slotIndex) {
  const type = (suggestion.type || '').toLowerCase();
  const validType = ['impact', 'urgence', 'facile'].includes(type) ? type : null;

  updatePriority(todayISO(), slotIndex, {
    title: suggestion.title || '',
    smallestAction: suggestion.smallestAction || '',
    type: validType,
    smallestActionApproved: null,
    done: false,
    doneAt: null,
  });

  dismissInboxItem(suggestion.id);

  renderPriorities();
  renderInbox();

  showToast(`Ajoutée au slot ${slotIndex + 1}`);
  if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
}

function bindInbox() {
  document.querySelector('[data-inbox-rescan]')?.addEventListener('click', () => {
    showToast('Lance « /focus-scan » sur ton Mac Claude Code');
  });
  document.querySelector('[data-inbox-restore]')?.addEventListener('click', () => {
    clearInboxDismissed();
    renderInbox();
  });
}

async function initInbox() {
  inboxCache = await fetchSuggestions();
  renderInbox();
  bindInbox();
}

/* =====================================================
   Notes screen (écrites par l'utilisateur, lues par le scanner cloud)
   ===================================================== */
const NOTES_KEY = 'fp.notes';

function readLocalNotes() {
  try { return localStorage.getItem(NOTES_KEY) || ''; } catch { return ''; }
}
function writeLocalNotes(text) {
  try { localStorage.setItem(NOTES_KEY, text); } catch {}
}

function setNotesStatus(msg) {
  const el = document.querySelector('[data-notes-status]');
  if (el) el.textContent = msg;
}

async function fetchNotesFromGist() {
  const { gistId, githubToken } = getSettings();
  if (!gistId || !githubToken) return null;
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.files?.['notes.md']?.content ?? null;
  } catch {
    return null;
  }
}

async function pushNotesToGist(text) {
  const { gistId, githubToken } = getSettings();
  if (!gistId || !githubToken) {
    setNotesStatus('⚠ Gist ID ou token manquant dans Réglages');
    return false;
  }
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { 'notes.md': { content: text || ' ' } } }),
    });
    if (!res.ok) {
      setNotesStatus(`⚠ Sync échouée (${res.status})`);
      return false;
    }
    setNotesStatus(`Synchronisé · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    return true;
  } catch (e) {
    setNotesStatus('⚠ Réseau indisponible — note gardée en local');
    return false;
  }
}

async function initNotes() {
  const ta = document.querySelector('[data-notes-input]');
  if (!ta) return;

  // 1. Load from localStorage (instantané)
  ta.value = readLocalNotes();
  setNotesStatus(ta.value ? 'Brouillon local' : '—');

  // 2. Try to pull latest from Gist (si config OK)
  const remote = await fetchNotesFromGist();
  if (remote !== null && remote.trim() !== ta.value.trim() && document.activeElement !== ta) {
    ta.value = remote;
    writeLocalNotes(remote);
    setNotesStatus('Synchronisé depuis Gist');
  }

  // 3. Save local immédiatement, push Gist au blur
  ta.addEventListener('input', () => {
    writeLocalNotes(ta.value);
    setNotesStatus('Brouillon local…');
  });
  ta.addEventListener('blur', () => {
    pushNotesToGist(ta.value);
  });
}

/* =====================================================
   Boot
   ===================================================== */
function boot() {
  getSettings(); // ensures initialization
  initTabs();
  renderHeader();
  renderZeigarnikRecall();
  renderPriorities();
  bindPriorityHandlers();
  renderSwitchCounter();
  bindSwitchCounter();
  refreshRitual();
  renderRitualInputs();
  bindRitual();
  bindRitualInputs();
  bindTimer();
  bindCloseModal();
  renderProgramme();
  renderSettings();
  bindSettings();
  initInbox();
  initNotes();
  bindAICheckHandlers();
  bindZeigarnikEvaluator();
  renderDebugViewer();
  toggleAIElements();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* =====================================================
   Service Worker registration (PWA)
   ===================================================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(err => {
      console.warn('[sw] registration failed', err);
    });
  });
}
