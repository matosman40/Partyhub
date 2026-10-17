#!/usr/bin/env python3
"""Vérifie le mode hors ligne dans un vrai navigateur.

La page est chargée en ligne, le service worker prend le contrôle, puis le réseau est coupé et la page est
rechargée : l'application doit s'afficher depuis le cache. L'API, elle, ne doit jamais venir du cache.

Usage : BASE_URL=http://127.0.0.1:8323 python3 scripts/offline-check-browser.py
Code de sortie : 1 si l'application ne s'ouvre pas hors ligne, ou si l'API répond depuis le cache.
Le test ne vaut qu'en production (le service worker n'est pas enregistré par le serveur de développement).
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")

API_PROBE = """async () => {
  try {
    await fetch('/api/catalog', { cache: 'no-store' });
    return 'répondu';
  } catch {
    return 'injoignable';
  }
}"""


def main() -> int:
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto(BASE_URL + "/", wait_until="networkidle", timeout=30000)
            page.wait_for_function("() => navigator.serviceWorker.controller !== null", timeout=20000)
            caches = page.evaluate("() => caches.keys()")
            print(f"service worker actif, caches : {', '.join(caches) or 'aucun'}")

            context.set_offline(True)
            page.reload(wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(1500)
            children = page.evaluate("() => document.getElementById('root')?.children.length ?? 0")
            title = page.title()
            api = page.evaluate(API_PROBE)
            print(f"hors ligne : titre « {title} », contenu affiché : {'oui' if children else 'non'}")
            print(f"API hors ligne : {api}")
            ok = title == "PartyHub" and children > 0 and api == "injoignable"
        except Exception as exc:  # noqa: BLE001 - le résultat est un échec, pas une erreur d'outil
            print(f"erreur : {exc}")
            ok = False
        finally:
            context.set_offline(False)
            browser.close()

    print("OK" if ok else "ÉCHEC : l'application ne s'ouvre pas hors ligne, ou l'API vient du cache")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
