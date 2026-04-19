#!/usr/bin/env python3
"""One-time OAuth setup pour Gmail + Calendar (scopes readonly).

Usage (une seule fois, sur Mac) :
  1. Créer un projet Google Cloud, activer Gmail API + Calendar API
  2. OAuth 2.0 → type "Desktop app" → télécharger client_secret.json
  3. Placer client_secret.json dans ce dossier (cloud-scanner/)
  4. pip install google-auth-oauthlib
  5. python oauth-setup.py
  6. Un navigateur s'ouvre → accepter les scopes
  7. Récupérer le refresh_token affiché et le coller dans les secrets GitHub

Le refresh_token est long-lived (pas de rotation automatique sauf révoc manuelle).
"""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
]

if __name__ == '__main__':
    flow = InstalledAppFlow.from_client_secrets_file('client_secret.json', SCOPES)
    # access_type=offline + prompt=consent force un refresh_token même si déjà autorisé
    creds = flow.run_local_server(
        port=0,
        access_type='offline',
        prompt='consent',
    )

    print('\n=== Secrets à copier dans GitHub ===')
    print(f'GOOGLE_CLIENT_ID     = {creds.client_id}')
    print(f'GOOGLE_CLIENT_SECRET = {creds.client_secret}')
    print(f'GOOGLE_REFRESH_TOKEN = {creds.refresh_token}')
    print('\nCopie-les dans Settings > Secrets and variables > Actions du repo GitHub.')
