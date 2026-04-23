/* =========================================================
   Focus Protocol — api.js
   Wrapper Claude API avec prompt caching ephemeral.
   Gestion résiliente : pas de clé / réseau / quota → fallback silencieux.
   ========================================================= */

import { EXPERT_SYSTEM_PROMPT, build7DContext } from './expert.js';
import {
  getSettings,
  getAllDays,
} from './storage.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
};

let cachedContext = null;
let cachedContextDate = null;

function buildCurrentContext() {
  const today = new Date().toISOString().slice(0, 10);
  if (cachedContext && cachedContextDate === today) return cachedContext;

  cachedContext = build7DContext({
    days: getAllDays(),
    settings: getSettings(),
  });
  cachedContextDate = today;
  return cachedContext;
}

export function invalidateContextCache() {
  cachedContext = null;
  cachedContextDate = null;
}

export function hasApiKey() {
  return Boolean(getSettings().apiKey);
}

/* =====================================================
   Core fetch with prompt caching ephemeral on both system blocks
   ===================================================== */
export async function callClaude({
  model = MODELS.HAIKU,
  userMessage,
  maxTokens = 300,
  temperature = 0.3,
}) {
  const settings = getSettings();
  const apiKey = settings.apiKey;
  if (!apiKey) throw new ApiError('no_key', 'Aucune clé API configurée');

  const payload = {
    model,
    system: [
      { type: 'text', text: EXPERT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildCurrentContext(),   cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: maxTokens,
    temperature,
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new ApiError('network', 'Problème réseau : ' + (e.message || 'inconnu'));
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.error?.message || detail;
    } catch {}
    const code = res.status === 401 ? 'auth' : res.status === 429 ? 'quota' : 'http';
    throw new ApiError(code, detail);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text || '';
  const usage = json.usage || {};

  if (console && usage.cache_read_input_tokens) {
    console.debug('[api] cache hit', usage.cache_read_input_tokens, 'tokens read');
  }

  return { text, usage, raw: json };
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* =====================================================
   Helpers
   ===================================================== */
function parseJsonStrict(text) {
  // Tolère un bloc ```json ... ``` ou du texte autour
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ApiError('parse', 'Réponse IA non-JSON : ' + text.slice(0, 100));
  }
}

/* =====================================================
   Hook 4.2 — Évaluateur qualité Zeigarnik (Haiku)
   ===================================================== */
export async function evaluateZeigarnik(note) {
  if (!note?.trim()) return { quality: null, reformulation: '', why: 'note vide' };
  const { text } = await callClaude({
    model: MODELS.HAIKU,
    userMessage: `Évalue cette note de clôture Zeigarnik selon les 3 critères. Note : "${note.trim()}".
Réponds en JSON strict avec : {"quality":"clear|vague","reformulation":"version améliorée (ou note originale si déjà clear)","why":"1 phrase sur ce qui manquait ou 'note claire'"}.`,
    maxTokens: 300,
    temperature: 0.2,
  });
  return parseJsonStrict(text);
}

/* =====================================================
   Hook 4.3 — Détecteur plus petite action trop grosse (Haiku)
   ===================================================== */
export async function checkSmallestAction(task, smallestAction) {
  if (!smallestAction?.trim()) return { verdict: null, suggestion: '', why: 'champ vide' };
  const { text } = await callClaude({
    model: MODELS.HAIKU,
    userMessage: `Tâche : "${task || '(non renseignée)'}". Plus petite action déclarée : "${smallestAction.trim()}". Applique la grille d'infaillibilité (5 critères). Réponds en JSON strict : {"verdict":"ok|too_big","suggestion":"version plus petite si too_big, sinon action originale","why":"1 phrase sur le critère qui manque ou 'action infaillible'"}.`,
    maxTokens: 250,
    temperature: 0.2,
  });
  return parseJsonStrict(text);
}

/* =====================================================
   Hook 4.4 — Rétro hebdomadaire narrative (Sonnet)
   Analyse les 7 jours de données (tâches, switches, zeigarnik)
   et renvoie un feedback + une priorité pour la semaine à venir.
   ===================================================== */
export async function weeklyDiagnostic() {
  const { text } = await callClaude({
    model: MODELS.SONNET,
    userMessage: `Fais une rétro de ma semaine écoulée en t'appuyant strictement sur les 7 jours de données fournis (complétion des 3 tâches, task switches, notes Zeigarnik).

Réponds en JSON strict, en français, ton direct tutoyant :
{
  "wins": "1-2 phrases sur ce qui a bien marché cette semaine, avec une observation spécifique",
  "frictions": "1-2 phrases sur ce qui a bloqué ou créé de la friction, avec une observation spécifique",
  "patternObservation": "1 pattern notable que tu remarques (ex: moins de switches le matin, tâches impact souvent reportées, zeigarnik plus précise en fin de semaine…)",
  "nextWeekPriority": "1 priorité claire et actionnable pour la semaine à venir, pas une généralité"
}`,
    maxTokens: 800,
    temperature: 0.3,
  });
  return parseJsonStrict(text);
}

/* =====================================================
   Hook 4.5 — Onboarding diagnostic adaptatif (Sonnet, one-shot)
   ===================================================== */
export async function onboardingDiagnostic(answers) {
  const summary = Object.entries(answers).map(([q, a]) => `- ${q} : ${a}`).join('\n');
  const { text } = await callClaude({
    model: MODELS.SONNET,
    userMessage: `Réponses d'onboarding :\n${summary}\n\nIdentifie la technique la plus faible de cet utilisateur et propose un ordre d'introduction optimal sur 12 semaines. Réponds en JSON strict : {"weakestTechnique":"3tasks|zeigarnik|ritual|smallestAction|batching","introductionOrder":["...","..."],"rationale":"2 phrases max"}.`,
    maxTokens: 500,
    temperature: 0.3,
  });
  return parseJsonStrict(text);
}

/* =====================================================
   Debug viewer — expose le contexte actuel pour affichage dans Settings
   ===================================================== */
export function getDebugPayload() {
  return {
    expertPrompt: EXPERT_SYSTEM_PROMPT,
    user7dContext: buildCurrentContext(),
    promptTokensEstimate: Math.ceil((EXPERT_SYSTEM_PROMPT.length + buildCurrentContext().length) / 4),
  };
}
