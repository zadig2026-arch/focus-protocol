# Focus Protocol

PWA mobile d'installation durable de **5 techniques de concentration** sur **12 semaines**, avec coaching IA.

- HTML + CSS + JS vanilla, zéro build step
- Installable sur iPhone via Safari (PWA)
- Données en `localStorage` uniquement (pas de serveur, pas de tracking)
- IA optionnelle : Claude API (classification, évaluation Zeigarnik, diagnostic hebdo)
- Scanner matinal Mac via Claude Code (Git, mail, calendrier, fichiers)

## Les 5 techniques

1. **Loi des 3 tâches** — Impact / Urgence / Facilité, ordre d'exécution imposé (semaines 1-4)
2. **Effet Zeigarnik** — note de clôture du soir, libère l'attention pour demain (semaines 5-8)
3. **Rituel d'ancrage** — geste physique ↔ état mental cible (semaines 9-12)
4. **Plus petite action + timer 120s** — outil transversal anti-procrastination
5. **Batching cognitif** — regrouper les tâches de même contexte

## Structure du projet

```
focus-protocol/
├── index.html              # Structure des 6 onglets + modales
├── styles.css              # Apple light mode, palette #f2f2f7 / #1e40af
├── app.js                  # Router + état + event handlers + IA
├── storage.js              # CRUD localStorage
├── expert.js               # EXPERT_SYSTEM_PROMPT + build7DContext
├── api.js                  # Wrapper Claude API + prompt caching
├── manifest.json           # PWA manifest
├── service-worker.js       # Cache shell, offline-first
├── icons/                  # Icônes PWA + script de génération
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-512-maskable.png
│   ├── apple-touch-icon.png
│   └── generate.py
├── suggestions.json        # Produit par le scanner /focus-scan (gitignored)
└── README.md
```

## Setup local

### 1. Lancer un serveur

```bash
cd ~/Documents/Github/Tools/Focus
npx live-server --port=8080
# ou, sans Node :
python3 -m http.server 8080
```

Ouvre `http://localhost:8080`.

### 2. Obtenir une clé API Claude (optionnel, pour les features IA)

1. Va sur **https://console.anthropic.com/settings/keys**
2. Clique **"Create Key"**, nomme-la (ex: `Focus Protocol`)
3. **Copie la clé immédiatement** (format `sk-ant-api03-…`, affichée une seule fois)
4. Ajoute 5-10 $ de crédit dans **Billing** → **Credits**
5. **Colle-la directement dans Focus Protocol → Réglages → Clé API Anthropic**
6. L'app te confirme en affichant les boutons 🔍 sur les cartes priorités

⚠️ **Sécurité** :
- La clé est stockée uniquement dans ton `localStorage` local, jamais envoyée ailleurs que vers l'API Anthropic.
- **Ne colle JAMAIS ta clé dans une conversation Claude Code ou un prompt IA** — les transcripts sont loggés sur disque.
- Si une fuite est suspectée : va sur la même page et supprime/régénère la clé.

### 3. Scanner matinal (Claude Code, sur Mac)

Chaque matin, tape dans Claude Code :

```
/focus-scan
```

Le skill analyse en parallèle :
- Tes repos Git (changements non committés, commits non poussés)
- Les 5 sessions Claude Code les plus récentes (48h)
- Tes mails non-lus Gmail (via MCP)
- Ton Google Calendar (48h)
- Les notes locales dans `~/.focus-protocol/context.md`

Et produit 5 suggestions rankées Impact / Urgence / Facilité dans `suggestions.json`. Elles apparaissent dans l'app (onglet Aujourd'hui > section "Suggestions du matin").

### 4. Sync Mac → iPhone (optionnel)

Pour lire les suggestions depuis l'iPhone :

1. Crée un **token GitHub** avec scope `gist` uniquement : https://github.com/settings/tokens/new
2. Crée un **Gist privé** vide avec un fichier `suggestions.json` (contenu `{}`) : https://gist.github.com/
3. Copie l'ID du Gist (dans l'URL, après ton username)
4. Dans la PWA : Réglages > Sync iPhone via GitHub Gist → colle Gist ID + Token
5. Tap "Copier la config pour le scanner" → colle la commande dans ton terminal Mac
6. Au prochain `/focus-scan`, le scanner pousse automatiquement vers le Gist
7. Quand ton iPhone ouvre la PWA déployée, elle lit le Gist

## Déploiement Netlify

### Drag & drop (le plus rapide, 30 secondes)

1. Va sur **https://app.netlify.com/drop**
2. Drag le dossier `~/Documents/Github/Tools/Focus` (entier) dans la zone
3. Netlify déploie et te donne une URL du type `https://random-name-abcdef.netlify.app`
4. Va dans **Site settings** → **Change site name** → nomme-la (ex: `focus-protocol-zag`)
5. Ton URL stable : `https://focus-protocol-zag.netlify.app`

### Via Git (recommandé pour les mises à jour)

```bash
cd ~/Documents/Github/Tools/Focus
git init
git add .
git commit -m "initial commit"
# crée un repo privé sur github.com, puis :
git remote add origin git@github.com:zadig/focus-protocol.git
git push -u origin main
```

Sur Netlify : **Add new site** → **Import from Git** → choisis le repo → build command vide, publish directory `/`. Push sur `main` = déploie auto.

### Configuration conseillée

Créer `netlify.toml` à la racine si besoin :

```toml
[build]
  publish = "."
  command = ""

[[headers]]
  for = "/service-worker.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
```

## Installation sur iPhone

1. Ouvre l'URL Netlify dans **Safari** (pas Chrome)
2. Tape l'icône partage (carré avec flèche vers le haut) en bas
3. Scrolle → **"Sur l'écran d'accueil"** → **Ajouter**
4. L'icône Focus apparaît sur ton Springboard — tap dessus → plein écran, sans barre Safari, comme une vraie app

## Export / Import des données

- **Réglages** → Exporter un backup → télécharge un `.json` avec tout (settings, days, ritual, program)
- **Réglages** → Importer un backup → restore depuis un `.json`
- **Réglages** → Rapport hebdo (markdown) → télécharge + copie un rapport des 7 derniers jours

## Tests manuels rapides

| Feature | Comment tester |
|---|---|
| Navigation onglets | Tap chaque onglet en bas, fade transition 200ms |
| Priorités | Tape titre, blur → persiste au reload |
| Badge type | Tap le pill "TYPE" → cycle impact/urgence/facile |
| Timer 120s | Tap "Timer 120 s" sur une carte ouverte |
| Clôture journée | Tap "Clôturer ma journée" → modal, Zeigarnik persiste |
| SRHI (dimanche) | Forcer `Date.prototype.getDay = () => 0` dans la console |
| Rituel | Tap "Je viens de l'utiliser" → streak + calendrier mis à jour |
| Programme | Change `settings.startDate` dans DevTools pour tester les phases |
| Scanner | `/focus-scan` dans Claude Code → écrit `suggestions.json` |
| Inbox IA | Les 5 cartes s'affichent, tap "→ 1" promeut dans le slot 1 |
| IA 🔍 | Si clé API OK, tap 🔍 → verdict sur la plus petite action |
| Zeigarnik eval | Tape note floue dans modal clôture → reformulation silencieuse au blur |
| Diagnostic hebdo | Dimanche → bouton "Recevoir mon diagnostic" dans modal |
| PWA | DevTools → Application → Manifest + Service Workers OK |

## Hors scope MVP

- Sync multi-device (localStorage suffit, utilise Export/Import JSON pour bouger)
- Authentification (app perso mono-user)
- Analytics / tracking
- Mode clair/sombre toggle (light only pour l'instant)
- Timeblocks dans onglet Blocs (placeholder)
- Stats graphiques (placeholder)
