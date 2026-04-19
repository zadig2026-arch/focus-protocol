#!/usr/bin/env bash
# Focus Protocol — setup-secrets.sh
# Crée (ou réutilise) le Gist privé, pose les 6 secrets GitHub Actions, déclenche le workflow.
# Usage :
#   bash cloud-scanner/setup-secrets.sh                   # crée un nouveau Gist
#   GIST_ID=<id> bash cloud-scanner/setup-secrets.sh      # réutilise un Gist existant
# Secrets saisis au terminal masqués (read -rs) — jamais logués ni passés en argument.

set -uo pipefail  # pas de -e : on gère chaque erreur explicitement

REPO="zadig2026-arch/focus-protocol"
WORKFLOW="focus-scan.yml"
EXISTING_GIST_ID="${GIST_ID:-}"

echo "== Focus Protocol — setup-secrets =="
echo

# 0. Pré-requis
command -v gh >/dev/null || { echo "Erreur : gh CLI non installé."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Erreur : gh non authentifié. Lance 'gh auth login'."; exit 1; }

# 1. Gist privé (création ou réutilisation)
if [[ -n "$EXISTING_GIST_ID" ]]; then
  GIST_ID="$EXISTING_GIST_ID"
  GIST_URL="https://gist.github.com/$GIST_ID"
  echo "1/3 · Gist réutilisé"
  echo "   GIST_ID : $GIST_ID"
else
  echo "1/3 · Création du Gist privé (filename: suggestions.json)"
  if ! GIST_URL=$(printf '{}' | gh gist create --filename suggestions.json --desc "Focus Protocol daily suggestions" -); then
    echo "Erreur création Gist."
    exit 1
  fi
  # Extract ID via parameter expansion (avoids basename BSD quirks on macOS)
  GIST_URL="${GIST_URL%$'\n'}"        # strip trailing newline
  GIST_ID="${GIST_URL##*/}"           # everything after last '/'
  if [[ -z "$GIST_ID" || "$GIST_ID" == *$'\n'* ]]; then
    echo "Erreur : impossible d'extraire GIST_ID depuis l'URL : $GIST_URL"
    exit 1
  fi
  echo "   ✓ Gist créé : $GIST_URL"
  echo "   GIST_ID    : $GIST_ID"
fi
echo

# 2. Saisie masquée des secrets (bash read -rs)
echo "2/3 · Saisie des 5 secrets (rien ne s'affiche quand tu colles, c'est normal)"
read -rs -p "   Clé Anthropic (sk-ant-…)    : " ANTHROPIC_API_KEY; echo
read -rs -p "   PAT GitHub (ghp_…)          : " GH_TOKEN_GIST;     echo
read -rs -p "   GOOGLE_CLIENT_ID            : " GOOGLE_CLIENT_ID;  echo
read -rs -p "   GOOGLE_CLIENT_SECRET        : " GOOGLE_CLIENT_SECRET; echo
read -rs -p "   GOOGLE_REFRESH_TOKEN        : " GOOGLE_REFRESH_TOKEN; echo

# Sanity checks (longueur minimale pour détecter un Entrée accidentel)
for var in ANTHROPIC_API_KEY GH_TOKEN_GIST GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN; do
  if [[ -z "${!var}" || "${#var}" -lt 4 ]]; then :; fi
  if [[ -z "${!var}" ]]; then
    echo "Erreur : $var est vide. Relance le script."
    exit 1
  fi
done

# 3. Envoi des 6 secrets
echo
echo "   Envoi des secrets → $REPO"
FAILED=0
set_secret() {
  local name=$1 val=$2
  if printf '%s' "$val" | gh secret set "$name" --repo "$REPO" >/dev/null 2>&1; then
    echo "   ✓ $name"
  else
    echo "   ✗ $name  (échec)"
    FAILED=$((FAILED+1))
  fi
}
set_secret GIST_ID               "$GIST_ID"
set_secret ANTHROPIC_API_KEY     "$ANTHROPIC_API_KEY"
set_secret GH_TOKEN_GIST         "$GH_TOKEN_GIST"
set_secret GOOGLE_CLIENT_ID      "$GOOGLE_CLIENT_ID"
set_secret GOOGLE_CLIENT_SECRET  "$GOOGLE_CLIENT_SECRET"
set_secret GOOGLE_REFRESH_TOKEN  "$GOOGLE_REFRESH_TOKEN"

# Nettoyage mémoire
unset ANTHROPIC_API_KEY GH_TOKEN_GIST GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN

if [[ $FAILED -gt 0 ]]; then
  echo
  echo "Erreur : $FAILED secret(s) n'ont pas été posés. Corrige et relance avec GIST_ID=$GIST_ID."
  exit 1
fi

# 4. Déclenchement du workflow
echo
echo "3/3 · Déclenchement du workflow Focus Scan"
if ! gh workflow run "$WORKFLOW" --repo "$REPO" 2>&1; then
  echo "Erreur déclenchement workflow."
  exit 1
fi
sleep 5
RUN_ID=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "?")

echo
echo "=============================================="
echo " ✓ Setup terminé"
echo "=============================================="
echo "  Gist URL    : $GIST_URL"
echo "  GIST_ID     : $GIST_ID"
echo "  Workflow run: #$RUN_ID"
echo
echo "  Suivre en direct :"
echo "    gh run watch $RUN_ID --repo $REPO"
echo
echo "  Une fois vert, colle le GIST_ID dans la PWA :"
echo "  Réglages > Sync iPhone > Gist ID"
