#!/usr/bin/env python3
"""
Génération one-shot d'une paire de clés VAPID pour Web Push.

Usage (à lancer une seule fois, en local) :
    pip install py-vapid
    python cloud-scanner/generate-vapid.py

Copie ensuite les deux valeurs affichées dans GitHub :
    Repo → Settings → Secrets and variables → Actions
        VAPID_PUBLIC_KEY  = clé publique (base64url)
        VAPID_PRIVATE_KEY = clé privée (base64url)
        VAPID_SUBJECT     = mailto:zadig2026@gmail.com

La clé publique est aussi à coller dans vapid-public.json à la racine du repo
(c'est ok de la commiter — elle est publique par nature).
"""
import base64
from py_vapid import Vapid01


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def main() -> None:
    v = Vapid01()
    v.generate_keys()

    # La clé privée au format DER, la publique au format raw bytes uncompressed (65 bytes)
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_bytes = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )

    print("=" * 70)
    print("VAPID_PUBLIC_KEY (à coller dans GitHub Secrets + vapid-public.json) :")
    print(b64url(public_raw))
    print()
    print("VAPID_PRIVATE_KEY (à coller dans GitHub Secrets UNIQUEMENT) :")
    print(b64url(private_bytes))
    print()
    print("VAPID_SUBJECT (à coller dans GitHub Secrets) :")
    print("mailto:zadig2026@gmail.com")
    print("=" * 70)


if __name__ == "__main__":
    main()
