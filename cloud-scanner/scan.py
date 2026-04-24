#!/usr/bin/env python3
"""Focus Protocol — scanner cloud.

Tourne sur GitHub Actions cron. Lit Gmail + Google Calendar + GitHub,
appelle Claude pour synthétiser 5 suggestions, pousse vers un Gist privé.

Zéro Mac requis. Perd les signaux Git local + sessions Claude Code
par rapport au scanner local /focus-scan.

Env vars requises :
  ANTHROPIC_API_KEY     — clé Claude API (sk-ant-...)
  GH_TOKEN              — PAT GitHub avec scope `gist` + `repo`
  GIST_ID               — ID du Gist privé où écrire suggestions.json
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN  — généré une fois via oauth-setup.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# --------------------------------------------------------------------- ENV
REQUIRED_ENV = [
    'ANTHROPIC_API_KEY', 'GH_TOKEN', 'GIST_ID',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
]
missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
if missing:
    sys.exit(f'Missing env vars: {", ".join(missing)}')

ANTHROPIC_API_KEY = os.environ['ANTHROPIC_API_KEY']
GH_TOKEN = os.environ['GH_TOKEN']
GIST_ID = os.environ['GIST_ID']
GOOGLE_CLIENT_ID = os.environ['GOOGLE_CLIENT_ID']
GOOGLE_CLIENT_SECRET = os.environ['GOOGLE_CLIENT_SECRET']
GOOGLE_REFRESH_TOKEN = os.environ['GOOGLE_REFRESH_TOKEN']

# VAPID optionnels — sans eux, les pushes sont simplement skippés.
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', 'mailto:example@example.com')

# Mode de run : morning | evening | scan (par défaut)
RUN_MODE = os.environ.get('RUN_MODE', 'scan').lower()

# --------------------------------------------------------------------- GOOGLE
def _google_creds():
    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri='https://oauth2.googleapis.com/token',
    )
    creds.refresh(GoogleRequest())
    return creds


def scan_gmail(max_results: int = 20) -> list[dict]:
    """Mails non-lus des 2 derniers jours."""
    try:
        service = build('gmail', 'v1', credentials=_google_creds(), cache_discovery=False)
        res = service.users().messages().list(
            userId='me', q='is:unread newer_than:2d', maxResults=max_results,
        ).execute()
        msgs = res.get('messages', [])
        out = []
        for m in msgs:
            full = service.users().messages().get(
                userId='me', id=m['id'], format='metadata',
                metadataHeaders=['From', 'Subject', 'Date'],
            ).execute()
            headers = {h['name']: h['value'] for h in full.get('payload', {}).get('headers', [])}
            out.append({
                'from': headers.get('From', ''),
                'subject': headers.get('Subject', ''),
                'date': headers.get('Date', ''),
                'snippet': full.get('snippet', '')[:200],
            })
        return out
    except Exception as e:
        print(f'  ! gmail failed: {e}', file=sys.stderr)
        return []


def scan_calendar(hours_ahead: int = 48) -> list[dict]:
    """Events today + next 48h."""
    try:
        service = build('calendar', 'v3', credentials=_google_creds(), cache_discovery=False)
        now = datetime.now(timezone.utc)
        end = now + timedelta(hours=hours_ahead)
        res = service.events().list(
            calendarId='primary',
            timeMin=now.isoformat(), timeMax=end.isoformat(),
            maxResults=15, singleEvents=True, orderBy='startTime',
        ).execute()
        out = []
        for e in res.get('items', []):
            start = e.get('start', {})
            out.append({
                'start': start.get('dateTime') or start.get('date'),
                'summary': e.get('summary', ''),
                'description': (e.get('description') or '')[:200],
                'location': e.get('location', ''),
            })
        return out
    except Exception as e:
        print(f'  ! calendar failed: {e}', file=sys.stderr)
        return []


# --------------------------------------------------------------------- GITHUB
def _gh_headers():
    return {'Authorization': f'Bearer {GH_TOKEN}', 'Accept': 'application/vnd.github+json'}


def scan_github() -> list[dict]:
    """Repos récemment poussés + PRs ouvertes + issues assignées."""
    signals = []
    try:
        # Repos récemment poussés (3j)
        r = requests.get(
            'https://api.github.com/user/repos',
            params={'sort': 'pushed', 'per_page': 15, 'affiliation': 'owner'},
            headers=_gh_headers(), timeout=20,
        )
        if r.ok:
            cutoff = datetime.now(timezone.utc) - timedelta(days=3)
            for repo in r.json():
                pushed_at = repo.get('pushed_at')
                if not pushed_at:
                    continue
                pushed_dt = datetime.fromisoformat(pushed_at.replace('Z', '+00:00'))
                if pushed_dt >= cutoff:
                    signals.append({
                        'type': 'recent_repo_activity',
                        'name': repo.get('full_name'),
                        'pushed_at': pushed_at,
                        'default_branch': repo.get('default_branch'),
                        'description': repo.get('description'),
                    })

        # PRs ouvertes par moi
        r = requests.get(
            'https://api.github.com/search/issues',
            params={'q': 'author:@me is:pr is:open', 'per_page': 10},
            headers=_gh_headers(), timeout=20,
        )
        if r.ok:
            for pr in r.json().get('items', []):
                signals.append({
                    'type': 'open_pr_mine',
                    'title': pr.get('title'),
                    'url': pr.get('html_url'),
                    'updated_at': pr.get('updated_at'),
                })

        # Issues assignées à moi
        r = requests.get(
            'https://api.github.com/search/issues',
            params={'q': 'assignee:@me is:issue is:open', 'per_page': 10},
            headers=_gh_headers(), timeout=20,
        )
        if r.ok:
            for iss in r.json().get('items', []):
                signals.append({
                    'type': 'assigned_issue',
                    'title': iss.get('title'),
                    'url': iss.get('html_url'),
                    'updated_at': iss.get('updated_at'),
                })

        # PRs attendant review de moi
        r = requests.get(
            'https://api.github.com/search/issues',
            params={'q': 'review-requested:@me is:pr is:open', 'per_page': 10},
            headers=_gh_headers(), timeout=20,
        )
        if r.ok:
            for pr in r.json().get('items', []):
                signals.append({
                    'type': 'pr_review_requested',
                    'title': pr.get('title'),
                    'url': pr.get('html_url'),
                })
    except Exception as e:
        print(f'  ! github failed: {e}', file=sys.stderr)
    return signals


# --------------------------------------------------------------------- EXPERT PROMPT
# Keep in sync with expert.js — same knowledge base minus a few sections
# that don't apply to cloud scanner context.
EXPERT_PROMPT = """# Rôle

Tu es le cerveau expert qui produit les suggestions matinales pour Focus Protocol.

Tu connais en profondeur : courbe asymptotique de l'automaticité (médiane 66 jours, range 18-254), SRHI à 7 items (seuil d'automaticité ≥6/7 pendant 10 jours), tension cognitive Zeigarnik dissipée par closure explicite, coût du task-switching (20-40% de perte, attention residue ~15 min), modèle B=MAT (Behavior = Motivation × Ability × Trigger), règle des 2 minutes, time-blocking avec rythme ultradien 90-120 min, implementation intentions "if X then Y".

**Règle absolue** : zéro citation académique dans tes réponses. Pas de name-dropping (Lally, Zeigarnik, Fogg, Newport, Leroy, Gollwitzer). La science est dans tes décisions, jamais dans tes phrases.

# Les 5 techniques

## 1. Loi des 3 tâches
Singletasking ordonné. Impact = leverage long terme (produit, stratégie, apprentissage qui compose). Urgence = deadline externe réelle (mail client, deadline contractuelle). Facilité = quick win <30 min qui débloque ou crée du momentum. Ordre imposé.

## 2. Effet Zeigarnik
La note du soir doit contenir : verbe d'action concret + premier geste exécutable sans décision + contexte déclencheur. Sinon la tension reste ouverte.

## 3. Rituel d'ancrage
Geste physique consistent + état mental cible nommé + répétition systématique.

## 4. Plus petite action + timer 120s
Grille d'infaillibilité (5 critères — tous doivent passer) : <2 minutes, <1 geste physique, 0 décision cognitive, 0 prérequis, déclencheur identifiable sans chercher.

## 5. Batching cognitif
Regrouper les tâches partageant un contexte commun (outil, interlocuteur, espace mental) en blocs 60-120 min. Jamais alterner deep work et shallow work dans le même bloc.

# Principes de sélection (pour ce scan)

- IMPACT = leverage long terme (refonte produit, stratégie, projets qui composent)
- URGENCE = deadline externe imminente (réponse attendue, mail client, réunion demain)
- FACILITÉ = <30 min qui débloque ou crée du momentum
- **Signal vs bruit** : newsletters, notifications low-stakes, commits triviaux = BRUIT, IGNORER
- **Singletasking** : préfère 1 tâche importante à 3 triviales
- **Déduplique** : si 2 signaux pointent vers le même projet, garde le plus actionnable
- **Smallest action** : premier geste infaillible <2 min, <1 geste, 0 décision

# Règles de communication

- Français, tutoiement
- Concis, concret, zéro jargon, zéro moralisme, zéro citation académique
- Format JSON strict quand demandé
"""

# --------------------------------------------------------------------- NOTES
def fetch_notes() -> str:
    """
    Fetch pinned notes.md + notes-timeline.md from the Gist.
    Retourne un bloc markdown concaténé : contexte permanent + 14 dernières entrées timeline.
    """
    try:
        r = requests.get(
            f'https://api.github.com/gists/{GIST_ID}',
            headers=_gh_headers(), timeout=20,
        )
        r.raise_for_status()
        files = r.json().get('files', {})
        pinned = (files.get('notes.md', {}).get('content') or '').strip()
        timeline_raw = (files.get('notes-timeline.md', {}).get('content') or '').strip()

        parts = []
        if pinned:
            parts.append(f'## Contexte permanent\n{pinned}')
        if timeline_raw:
            # Garde les 14 entrées les plus récentes (les headers sont "## YYYY-MM-DD HH:MM")
            entries = re.split(r'(?m)^##\s+(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*$', timeline_raw)
            # split produit [preamble, date1, body1, date2, body2, ...]
            pairs = []
            for i in range(1, len(entries), 2):
                if i + 1 < len(entries):
                    pairs.append((entries[i], entries[i + 1].strip()))
            pairs.sort(key=lambda p: p[0], reverse=True)
            pairs = pairs[:14]
            if pairs:
                tl_md = '\n\n'.join(f'### {d}\n{b}' for d, b in pairs)
                parts.append(f'## Timeline récente\n{tl_md}')
        return '\n\n'.join(parts).strip()
    except Exception as e:
        print(f'Warn: fetch notes failed: {e}', file=sys.stderr)
        return ''


# --------------------------------------------------------------------- CLAUDE
def call_claude(sources: dict, notes: str = '', memory: dict | None = None) -> dict:
    context = json.dumps(sources, ensure_ascii=False, indent=2)
    notes_block = (
        f'\n\nNOTES DE CONTEXTE (écrites par l\'utilisateur, prends-les en compte pour prioriser) :\n"""\n{notes}\n"""\n'
        if notes else ''
    )
    memory_block = ''
    if memory and any(memory.get(k) for k in ('people', 'projects', 'commitments')):
        mem_str = json.dumps(memory, ensure_ascii=False, indent=2)[:6000]
        memory_block = f'\n\nMÉMOIRE LONGUE (clients, projets, engagements connus — utilise-la pour mieux prioriser) :\n```json\n{mem_str}\n```\n'
    user_msg = f"""Voici le contexte de scan du {datetime.now(timezone.utc).isoformat()} :{notes_block}{memory_block}

```json
{context}
```

Analyse et produis EXACTEMENT 5 suggestions de tâches pour aujourd'hui,
rankées par leverage × urgence.

Mix idéal : 2 IMPACT + 2 URGENCE + 1 FACILITÉ (assouplis si contexte).
Élimine le bruit (newsletters, marketing, security alerts routiniers).
Si < 5 signaux forts, complète avec les meilleures candidates restantes.

Pour chaque suggestion :
- id stable (ex: "gmail-<slug>", "cal-<slug>", "gh-<repo>-<action>")
- title : verbale concrète, max 60 caractères
- type : "impact" | "urgence" | "facile"
- source : "gmail" | "calendar" | "github"
- rationale : 1 phrase citant le signal concret, max 80 caractères
- smallestAction : premier geste infaillible <2 min, max 50 caractères
- estimatedMinutes : entier réaliste

Réponds UNIQUEMENT en JSON strict :
{{
  "suggestions": [
    {{"id": "...", "title": "...", "type": "impact", "source": "github", "rationale": "...", "smallestAction": "...", "estimatedMinutes": 10}}
  ]
}}"""

    r = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': 'claude-sonnet-4-6',
            'system': EXPERT_PROMPT,
            'messages': [{'role': 'user', 'content': user_msg}],
            'max_tokens': 1500,
            'temperature': 0.3,
        },
        timeout=90,
    )
    if not r.ok:
        print(f'Anthropic {r.status_code} body: {r.text[:800]}', file=sys.stderr)
        r.raise_for_status()
    text = r.json()['content'][0]['text']
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        raise ValueError(f'No JSON in Claude response: {text[:200]}')
    return json.loads(m.group(0))


# --------------------------------------------------------------------- GIST
def push_gist(payload: dict) -> str:
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    r = requests.patch(
        f'https://api.github.com/gists/{GIST_ID}',
        headers=_gh_headers(),
        json={'files': {'suggestions.json': {'content': content}}},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get('html_url', '')


# --------------------------------------------------------------------- LONG-TERM MEMORY
EMPTY_MEMORY = {
    'schemaVersion': 1,
    'updatedAt': None,
    'people': {},
    'projects': {},
    'commitments': [],
    'themes': [],
}


def fetch_memory() -> dict:
    """Lit memory.json du Gist. Retourne EMPTY_MEMORY si absent ou invalide."""
    try:
        r = requests.get(
            f'https://api.github.com/gists/{GIST_ID}',
            headers=_gh_headers(), timeout=20,
        )
        r.raise_for_status()
        raw = r.json().get('files', {}).get('memory.json') or {}
        if not raw.get('content'):
            return dict(EMPTY_MEMORY)
        data = json.loads(raw['content'])
        # Validation souple
        for k in ('people', 'projects'):
            if not isinstance(data.get(k), dict):
                data[k] = {}
        for k in ('commitments', 'themes'):
            if not isinstance(data.get(k), list):
                data[k] = []
        data.setdefault('schemaVersion', 1)
        return data
    except Exception as e:
        print(f'Warn: fetch memory failed: {e}', file=sys.stderr)
        return dict(EMPTY_MEMORY)


def push_memory(memory: dict) -> None:
    memory['updatedAt'] = datetime.now(timezone.utc).isoformat()
    content = json.dumps(memory, ensure_ascii=False, indent=2)
    r = requests.patch(
        f'https://api.github.com/gists/{GIST_ID}',
        headers=_gh_headers(),
        json={'files': {'memory.json': {'content': content}}},
        timeout=30,
    )
    r.raise_for_status()


def update_memory(sources: dict, notes: str, current: dict) -> dict:
    """
    Deuxième appel Claude matinal : met à jour la mémoire longue à partir
    des signaux du jour + des notes. Ne retire rien ; ajoute/précise.
    Retourne la mémoire mise à jour.
    """
    current_str = json.dumps(current, ensure_ascii=False, indent=2)[:8000]
    sources_str = json.dumps(sources, ensure_ascii=False, indent=2)[:8000]
    notes_block = f'\n\nNOTES UTILISATEUR :\n"""\n{notes}\n"""\n' if notes else ''
    user_msg = f"""Voici la mémoire longue actuelle et les signaux du scan d'aujourd'hui.
Ton rôle : extraire de nouvelles entités (personnes, projets, engagements) et enrichir celles déjà présentes, SANS inventer.

Règles strictes :
- N'ajoute une personne/projet que si explicitement nommée dans les sources ou les notes
- Pour chaque ajout/modification, cite la source entre parenthèses dans le champ "context" ou "notes"
- Ne retire jamais d'entité existante (on préfère qu'elles vieillissent plutôt qu'elles disparaissent)
- Marque un commitment "resolved": true uniquement si un signal clair l'atteste
- Date en ISO (YYYY-MM-DD) pour deadlines et lastInteraction
- Français, concis

Mémoire actuelle :
```json
{current_str}
```

Signaux du jour (gmail 2j, calendar 48h, github 3j) :
```json
{sources_str}
```{notes_block}

Réponds UNIQUEMENT par la mémoire complète mise à jour, en JSON strict, même schéma :
{{
  "schemaVersion": 1,
  "updatedAt": "ISO",
  "people": {{"Nom": {{"role": "...", "context": "... (source)", "lastInteraction": "YYYY-MM-DD", "notes": ["..."]}}}},
  "projects": {{"Nom": {{"status": "active|paused|done", "context": "... (source)", "deadline": "YYYY-MM-DD|null", "nextSteps": ["..."]}}}},
  "commitments": [{{"to": "...", "what": "...", "deadline": "YYYY-MM-DD|null", "source": "...", "addedAt": "YYYY-MM-DD", "resolved": false}}],
  "themes": ["..."]
}}"""

    r = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': 'claude-sonnet-4-6',
            'system': 'Tu es un curateur de mémoire longue. Tu extrais des entités stables des signaux bruts sans inventer. Tu retournes du JSON strict.',
            'messages': [{'role': 'user', 'content': user_msg}],
            'max_tokens': 2500,
            'temperature': 0.2,
        },
        timeout=90,
    )
    if not r.ok:
        print(f'Memory update failed {r.status_code}: {r.text[:400]}', file=sys.stderr)
        return current
    text = r.json()['content'][0]['text']
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        print(f'Warn: no JSON in memory response: {text[:200]}', file=sys.stderr)
        return current
    try:
        updated = json.loads(m.group(0))
        for k in ('people', 'projects'):
            if not isinstance(updated.get(k), dict):
                updated[k] = current.get(k, {})
        for k in ('commitments', 'themes'):
            if not isinstance(updated.get(k), list):
                updated[k] = current.get(k, [])
        updated['schemaVersion'] = 1
        return updated
    except json.JSONDecodeError as e:
        print(f'Warn: memory JSON invalid: {e}', file=sys.stderr)
        return current


# --------------------------------------------------------------------- WEB PUSH
def fetch_push_subscription() -> dict | None:
    try:
        r = requests.get(
            f'https://api.github.com/gists/{GIST_ID}',
            headers=_gh_headers(), timeout=20,
        )
        r.raise_for_status()
        raw = r.json().get('files', {}).get('push-subscription.json') or {}
        if not raw.get('content'):
            return None
        data = json.loads(raw['content'])
        return data.get('subscription')
    except Exception as e:
        print(f'Warn: fetch push subscription failed: {e}', file=sys.stderr)
        return None


def send_push(title: str, body: str, url: str = './') -> bool:
    """Envoie une Web Push à l'abonnement stocké dans le Gist. Silent si VAPID absent."""
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        print('  (VAPID non configurée — push skippé)')
        return False
    sub = fetch_push_subscription()
    if not sub:
        print('  (pas de souscription dans le Gist — push skippé)')
        return False
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print('  ! pywebpush absent (requirements.txt)', file=sys.stderr)
        return False
    payload = json.dumps({'title': title, 'body': body, 'url': url, 'tag': 'focus-reminder'})
    try:
        webpush(
            subscription_info=sub,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={'sub': VAPID_SUBJECT},
            timeout=15,
        )
        return True
    except WebPushException as e:
        print(f'  ! webpush failed: {e}', file=sys.stderr)
        return False


# --------------------------------------------------------------------- MAIN
def run_scan() -> int:
    """Scan complet + push Gist. Retourne le nombre de suggestions produites."""
    print('→ Scanning Gmail…')
    gmail = scan_gmail()
    print(f'   {len(gmail)} threads')

    print('→ Scanning Calendar…')
    cal = scan_calendar()
    print(f'   {len(cal)} events')

    print('→ Scanning GitHub…')
    gh = scan_github()
    print(f'   {len(gh)} signals')

    sources = {'gmail': gmail, 'calendar': cal, 'github': gh}

    print('→ Fetching user notes…')
    notes = fetch_notes()
    print(f'   {len(notes)} chars' if notes else '   (empty)')

    print('→ Fetching long-term memory…')
    memory = fetch_memory()
    known = len(memory.get('people', {})) + len(memory.get('projects', {})) + len(memory.get('commitments', []))
    print(f'   {known} entities')

    print('→ Updating long-term memory (Claude)…')
    try:
        memory = update_memory(sources, notes, memory)
        push_memory(memory)
        new_known = len(memory.get('people', {})) + len(memory.get('projects', {})) + len(memory.get('commitments', []))
        print(f'   {new_known} entities ({new_known - known:+d})')
    except Exception as e:
        print(f'   ! update skipped: {e}', file=sys.stderr)

    print('→ Calling Claude for today suggestions…')
    result = call_claude(sources, notes=notes, memory=memory)

    scanned = ['gmail', 'calendar', 'github']
    skipped = ['git-local', 'claude-code-sessions']
    if notes:
        scanned.append('user-notes')
    else:
        skipped.append('user-notes')

    suggestions = result.get('suggestions', [])
    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'scannedSources': scanned,
        'skippedSources': skipped,
        'notesUsed': bool(notes),
        'suggestions': suggestions,
    }

    print('→ Pushing to Gist…')
    url = push_gist(payload)
    print(f'   {url}')

    print('\n=== Suggestions ===')
    for i, s in enumerate(suggestions, 1):
        print(f'  {i}. [{s.get("type", "?").upper()}] {s.get("title", "?")}')
    return len(suggestions)


def main() -> None:
    print(f'→ Run mode: {RUN_MODE}')

    if RUN_MODE == 'morning':
        count = run_scan()
        print('→ Sending morning push…')
        body = f'{count} suggestions prêtes · ouvre Focus pour choisir tes 3 tâches.' if count else 'Brief du matin — ouvre Focus pour commencer.'
        send_push('Focus — brief du matin', body, './#today')
    elif RUN_MODE == 'evening':
        print('→ Sending evening push (pas de scan)…')
        send_push('Focus — clôture', 'Quelle est la prochaine action claire pour demain ?', './#today')
    else:
        run_scan()

    print('✓ Done.')


if __name__ == '__main__':
    main()
