# Cloud Scanner — Focus Protocol

Scanner matinal qui tourne sur GitHub Actions (zéro Mac requis). Remplace partiellement le skill `/focus-scan` quand tu n'as pas accès à ton Mac.

## Ce qu'il fait

- ✅ Gmail non-lus (2 derniers jours) via API
- ✅ Google Calendar (48h à venir) via API
- ✅ GitHub (repos récemment poussés, PRs ouvertes, issues assignées, reviews demandées)
- ✅ Appelle Claude Sonnet 4.6 avec le même cerveau expert
- ✅ Écrit dans le Gist que la PWA iPhone lit

## Ce qu'il ne fait PAS (vs scanner local Mac)

- ❌ Git repos locaux (uncommitted / unpushed)
- ❌ Sessions Claude Code récentes
- ❌ Notes locales (`~/.focus-protocol/context.md`)

Ces signaux restent uniquement dans le scanner local `/focus-scan` sur Mac.

---

## Setup (1 fois, ~45 min)

### 1. Pousser le projet sur GitHub

```bash
cd ~/Documents/Github/Tools/Focus
git init
git add .
git commit -m "initial focus protocol"
# Crée un repo privé sur github.com nommé focus-protocol
git remote add origin git@github.com:zadig2026/focus-protocol.git
git branch -M main
git push -u origin main
```

Le dossier `.github/workflows/focus-scan.yml` est auto-détecté par GitHub Actions.

### 2. Créer le projet Google Cloud pour OAuth

1. https://console.cloud.google.com/ → **"Nouveau projet"** → nomme-le `Focus Protocol`
2. Dans le projet → **APIs & Services > Library** :
   - Active **Gmail API**
   - Active **Google Calendar API**
3. **OAuth consent screen** :
   - User Type : **External**
   - App name : `Focus Protocol`
   - User support email : ton email
   - Scopes : ajouter `.../auth/gmail.readonly` et `.../auth/calendar.readonly`
   - Test users : ajouter **ton propre email** (important, sinon le refresh token se révoque après 7j en mode "Testing")
4. **Credentials** → **Create Credentials > OAuth client ID** :
   - Type : **Desktop app**
   - Name : `Focus scanner local`
   - Download JSON → sauve-le en `cloud-scanner/client_secret.json` (⚠️ NE PAS committer)

### 3. Générer le refresh token (une fois, depuis ton Mac)

```bash
cd ~/Documents/Github/Tools/Focus/cloud-scanner
python3 -m venv .venv
source .venv/bin/activate
pip install google-auth-oauthlib
python3 oauth-setup.py
```

Un navigateur s'ouvre → connecte-toi avec ton compte Google → accepte les scopes read-only Gmail + Calendar. Le terminal affiche :
```
GOOGLE_CLIENT_ID     = xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = GOCSPX-xxx
GOOGLE_REFRESH_TOKEN = 1//0gxxx...
```
Copie ces 3 valeurs.

### 4. Créer un PAT GitHub avec scopes `gist` + `repo`

https://github.com/settings/tokens/new
- Note : `Focus Protocol cloud scanner`
- Expiration : 1 an
- Scopes : `gist` + `repo` (pour lire tes repos privés et pousser au Gist)
- Copie le token (format `ghp_…`)

### 5. Créer un Gist privé (si pas encore fait)

https://gist.github.com/ → filename `suggestions.json` → contenu `{}` → **Create secret gist**
Note l'ID (dans l'URL après ton username).

### 6. Ajouter les 6 secrets dans GitHub Actions

Repo GitHub → **Settings > Secrets and variables > Actions > New repository secret** :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | Ta clé `sk-ant-...` |
| `GH_TOKEN_GIST` | Le PAT créé à l'étape 4 (`ghp_...`) |
| `GIST_ID` | L'ID du Gist de l'étape 5 |
| `GOOGLE_CLIENT_ID` | Depuis étape 3 |
| `GOOGLE_CLIENT_SECRET` | Depuis étape 3 |
| `GOOGLE_REFRESH_TOKEN` | Depuis étape 3 |

### 7. Tester manuellement

GitHub repo → **Actions > Focus Scan > Run workflow** (bouton vert)

Ça lance le scanner immédiatement. Vérifie les logs : tu dois voir "5 suggestions" et un URL de Gist. Ouvre Focus Protocol sur iPhone → les suggestions apparaissent.

### 8. Cron auto

Le workflow tourne ensuite chaque matin à **6:30 UTC**. Pour changer :
- Europe/Paris été = UTC+2 → `'30 4 * * *'` pour 6:30 Paris en été
- Europe/Paris hiver = UTC+1 → `'30 5 * * *'` pour 6:30 Paris en hiver
- Pacific/Auckland = UTC+12 (été NZ UTC+13) → `'30 18 * * *'` pour 6:30 Auckland matin

Édite `.github/workflows/focus-scan.yml` → commit → push.

---

## Debug

### Les logs du workflow

Repo → Actions → Focus Scan → dernier run → "Run scanner" step.

### "Invalid refresh token"

Ton token a expiré (probable si tu es resté en mode "Testing" dans l'OAuth consent screen). Solutions :
1. Passer l'app en **"In production"** (aucune review nécessaire pour les scopes readonly)
2. OU re-générer un refresh_token via `oauth-setup.py` et mettre à jour le secret GitHub

### "403 Forbidden" sur l'API Anthropic

Vérifie le crédit sur console.anthropic.com/settings/billing. Un scan coûte ~$0.002.

### Le Gist ne se met pas à jour

Vérifie que `GH_TOKEN_GIST` a bien les scopes `gist` (écriture) et que `GIST_ID` est correct (pas confondu avec une URL ou un username).

---

## Coût mensuel

- GitHub Actions : **gratuit** (2000 min/mois public, 500 min/mois privé, 1 scan = ~30s)
- Claude Sonnet 4.6 : ~**$0.002 par scan** → ~$0.06 / mois si daily
- Google APIs : **gratuit** dans les quotas (1M requêtes/jour, tu en fais 40)
- Gist : **gratuit**

**Total : ~$0.06 / mois.**
