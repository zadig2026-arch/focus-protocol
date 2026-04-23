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
  setZeigarnikNote,
  getAllDays,
  replaceAllDays,
  ensureSchema,
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
    if (tabId === 'settings') renderHistory();
  }

  tabs.forEach(t => {
    t.addEventListener('click', e => {
      e.preventDefault();
      activate(t.dataset.tab);
    });
  });

  // Liens internes vers un onglet (ex: CTA "Configurer →")
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    if (a.classList.contains('tab')) return;
    a.addEventListener('click', e => {
      const target = a.getAttribute('href')?.slice(1);
      const isScreen = Array.from(screens).some(s => s.dataset.tab === target);
      if (isScreen) {
        e.preventDefault();
        activate(target);
      }
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

  const doneCount = day.priorities.filter(p => p.done).length;
  const totalCount = day.priorities.filter(p => p.title?.trim()).length || 3;
  const progressEl = document.querySelector('[data-today-progress]');
  if (progressEl) {
    progressEl.textContent = `${doneCount} / ${totalCount} faites`;
    progressEl.classList.toggle('is-complete', doneCount > 0 && doneCount === totalCount);
  }

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
      const before = getDay().priorities.filter(p => p.done).length;
      updatePriority(todayISO(), i, {
        done,
        doneAt: done ? new Date().toISOString() : null,
      });
      renderPriorities();
      if (done && navigator.vibrate) navigator.vibrate([15, 30, 15]);

      // Auto-clôture si on vient de cocher la 3e
      const after = getDay().priorities.filter(p => p.done).length;
      const total = getDay().priorities.filter(p => p.title?.trim()).length;
      if (done && after === 3 && before === 2 && total === 3 && !getDay().zeigarnikNote?.text) {
        setTimeout(() => {
          showToast('🎯 Journée bouclée — pense à ta prochaine action.');
          openCloseModal();
        }, 500);
      }
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
   Header date
   ===================================================== */
function renderHeader() {
  const now = new Date();
  const dateEls = document.querySelectorAll('[data-today-date]');
  const formatted = now.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  dateEls.forEach(el => el.textContent = formatted);
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
  renderHistory();
}

function renderHistory() {
  const container = document.querySelector('[data-history-list]');
  if (!container) return;
  const all = getAllDays();
  const today = new Date();
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = todayISO(d);
    const day = all[iso];
    const weekday = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!day) {
      rows.push({ iso, weekday, empty: true });
      continue;
    }
    const done = (day.priorities || []).filter(p => p.done).length;
    const total = (day.priorities || []).filter(p => p.title?.trim()).length;
    const switches = (day.taskSwitches || []).length;
    const zeig = day.zeigarnikNote?.text || '';
    rows.push({ iso, weekday, done, total, switches, zeig, empty: false });
  }
  const hasAny = rows.some(r => !r.empty);
  if (!hasAny) {
    container.innerHTML = `<div class="history-row-empty">Pas encore de données cette semaine.</div>`;
    return;
  }
  container.innerHTML = rows.map(r => {
    if (r.empty) {
      return `<div class="history-row">
        <div class="history-row-head">
          <span class="history-row-date">${r.weekday}</span>
          <span class="history-row-stats">—</span>
        </div>
      </div>`;
    }
    const complete = r.total > 0 && r.done === r.total;
    const stats = `${r.done}/${r.total || 0} tâches · ${r.switches} switch${r.switches > 1 ? 'es' : ''}`;
    return `<div class="history-row">
      <div class="history-row-head">
        <span class="history-row-date">${r.weekday}</span>
        <span class="history-row-stats${complete ? ' is-complete' : ''}">${stats}</span>
      </div>
      ${r.zeig ? `<div class="history-row-zeig">« ${escapeHtml(r.zeig)} »</div>` : ''}
    </div>`;
  }).join('');
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

  document.querySelector('[data-copy-shortcut-config]')?.addEventListener('click', () => {
    const s = getSettings();
    if (!s.gistId || !s.githubToken) {
      showToast('Renseigne d\'abord Gist ID + Token');
      return;
    }
    const cfg = JSON.stringify({ gistId: s.gistId, token: s.githubToken }, null, 2);
    navigator.clipboard?.writeText(cfg);
    showToast('Config copiée — colle dans ton Shortcut iOS');
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
    if (confirm('Tout réinitialiser ? Toutes tes données (tâches, notes, réglages) seront effacées. Action irréversible.')) {
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
    const zeig = d.zeigarnikNote?.text || '';
    lines.push(`- **${iso}** · ${done}/${total} tâches · ${switches} switches${zeig ? ` · Zeigarnik : « ${zeig} »` : ''}`);
  });

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
   Close-day modal — Zeigarnik + diagnostic hebdo
   ===================================================== */
function updateCloseSummary() {
  const day = getDay();
  const done = day.priorities.filter(p => p.done).length;
  const switches = day.taskSwitches.length;
  document.querySelector('[data-close-done]').textContent = `${done} / 3`;
  document.querySelector('[data-close-switches]').textContent = String(switches);
}

function isWeeklyReviewDay() {
  return new Date().getDay() === 0; // dimanche uniquement
}

function openCloseModal() {
  const day = getDay();
  const weeklyDay = isWeeklyReviewDay();

  // Section diagnostic (dimanche uniquement)
  const diagSection = document.querySelector('[data-diag-section]');
  if (diagSection) diagSection.hidden = !weeklyDay;

  // Reset diagnostic UI
  const diagResult = document.querySelector('[data-weekly-diag-result]');
  if (diagResult) diagResult.innerHTML = '';
  const diagBtn = document.querySelector('[data-weekly-diag]');
  if (diagBtn) { diagBtn.hidden = false; diagBtn.disabled = false; }

  updateCloseSummary();

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
  const today = todayISO();
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
    const sections = [
      { key: 'wins', label: 'Ce qui a marché' },
      { key: 'frictions', label: 'Ce qui a bloqué' },
      { key: 'patternObservation', label: 'Pattern observé' },
    ];
    container.innerHTML = `
      <div class="diag-block">
        ${sections.map(s => diag[s.key] ? `
          <div class="diag-row">
            <div class="diag-row-head">
              <span class="diag-row-label">${s.label}</span>
            </div>
            <p class="diag-row-obs">${escapeHtml(diag[s.key])}</p>
          </div>
        ` : '').join('')}
        ${diag.nextWeekPriority ? `
          <div class="diag-next">
            <span class="diag-next-label">Priorité de la semaine prochaine</span>
            <p>${escapeHtml(diag.nextWeekPriority)}</p>
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
  renderApiKeyBanner();
}

function renderApiKeyBanner() {
  const banner = document.querySelector('[data-api-missing]');
  if (banner) banner.hidden = hasApiKey();
}

function formatAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

function renderScanFreshnessBanner() {
  const banner = document.querySelector('[data-scan-freshness]');
  const when = document.querySelector('[data-scan-when]');
  if (!banner || !when) return;
  const visible = document.querySelector('[data-inbox-section]');
  const hasVisibleInbox = visible && !visible.hidden;
  if (!inboxCache?.generatedAt || hasVisibleInbox) {
    banner.hidden = true;
    return;
  }
  when.textContent = formatAgo(inboxCache.generatedAt);
  banner.hidden = false;
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
    renderScanFreshnessBanner();
    return;
  }
  section.hidden = false;
  renderScanFreshnessBanner();
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

/* =====================================================
   Backup automatique des journées vers Gist (days.json)
   Fusion au boot : jours distants que le local ne connaît pas sont restaurés.
   Push débounce après toute mutation de fp.days.
   ===================================================== */
async function fetchDaysFromGist() {
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
    const raw = data.files?.['days.json']?.content;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function pushDaysToGist() {
  const { gistId, githubToken } = getSettings();
  if (!gistId || !githubToken) return false;
  try {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      days: getAllDays(),
    };
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { 'days.json': { content: JSON.stringify(payload, null, 2) } } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let daysPushTimer = null;
function scheduleDaysPush() {
  clearTimeout(daysPushTimer);
  daysPushTimer = setTimeout(() => { pushDaysToGist(); }, 2500);
}

async function restoreDaysFromGistIfNeeded() {
  const remote = await fetchDaysFromGist();
  if (!remote || !remote.days) return;
  const local = getAllDays();
  let merged = false;
  Object.entries(remote.days).forEach(([iso, day]) => {
    if (!local[iso]) {
      local[iso] = day;
      merged = true;
    }
  });
  if (merged) {
    replaceAllDays(local);
    renderPriorities();
    renderHistory();
    renderZeigarnikRecall();
  }
}

function initDaysBackup() {
  document.addEventListener('fp:days-changed', scheduleDaysPush);
  // Restauration depuis Gist en arrière-plan (non bloquant)
  restoreDaysFromGistIfNeeded();
}

/* =====================================================
   Web Push — subscribe + upload abonnement au Gist
   Scanner (GHA cron) lit push-subscription.json et envoie des pushes.
   ===================================================== */
function setNotifStatus(msg) {
  const el = document.querySelector('[data-notif-status]');
  if (el) el.textContent = msg;
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function fetchVapidPublicKey() {
  try {
    const res = await fetch('vapid-public.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.publicKey || '').trim() || null;
  } catch {
    return null;
  }
}

async function pushSubscriptionToGist(subscription) {
  const { gistId, githubToken } = getSettings();
  if (!gistId || !githubToken) return false;
  try {
    const payload = {
      updatedAt: new Date().toISOString(),
      subscription: subscription ? subscription.toJSON() : null,
    };
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { 'push-subscription.json': { content: JSON.stringify(payload, null, 2) } } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function initPushNotifications() {
  const toggle = document.querySelector('[data-setting-notifs]');
  if (!toggle) return;

  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) {
    toggle.disabled = true;
    setNotifStatus('Non supporté sur ce navigateur');
    return;
  }

  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) {
    toggle.disabled = true;
    setNotifStatus('VAPID non configurée — lire vapid-public.json');
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  toggle.checked = !!existing;
  setNotifStatus(existing ? 'Actives · souscrit' : 'Désactivées');

  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      try {
        if (Notification.permission === 'denied') {
          setNotifStatus('Permission refusée — autorise dans réglages iOS');
          toggle.checked = false;
          return;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setNotifStatus('Permission refusée');
          toggle.checked = false;
          return;
        }
        setNotifStatus('Souscription…');
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(vapidKey),
        });
        const ok = await pushSubscriptionToGist(sub);
        setNotifStatus(ok ? 'Actives · souscrit' : '⚠ Upload Gist échoué');
        updateSettings({ notifEnabled: true });
      } catch (e) {
        console.error('[push] subscribe failed', e);
        setNotifStatus('⚠ Échec : ' + (e.message || 'inconnu'));
        toggle.checked = false;
      }
    } else {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await pushSubscriptionToGist(null);
      setNotifStatus('Désactivées');
      updateSettings({ notifEnabled: false });
    }
  });
}

/* =====================================================
   Dark mode — suit prefers-color-scheme, met à jour theme-color
   ===================================================== */
function initTheme() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    meta.setAttribute('content', mq.matches ? '#000000' : '#f2f2f7');
  };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply); // Safari <14
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
  ensureSchema();
  initTabs();
  renderHeader();
  renderZeigarnikRecall();
  renderPriorities();
  bindPriorityHandlers();
  renderSwitchCounter();
  bindSwitchCounter();
  bindTimer();
  bindCloseModal();
  renderSettings();
  bindSettings();
  initInbox();
  initNotes();
  initDaysBackup();
  initPushNotifications();
  bindAICheckHandlers();
  bindZeigarnikEvaluator();
  renderDebugViewer();
  toggleAIElements();
  initTheme();
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
