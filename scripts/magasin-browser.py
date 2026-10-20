#!/usr/bin/env python3
"""Contrôle navigateur du magasin de jeux (administration), avec un catalogue simulé.

Le catalogue vient d'une réponse simulée, pour ne pas dépendre de GitHub. Ce qui est vérifié, dans le vrai code de
l'administration : la fiche illisible affiche son problème (et non « Disponible »), le quota restant s'affiche, un
avertissement apparaît quand le quota ne suffit pas à « Installer tout », et la page tient sur un téléphone sans
défilement horizontal.

Usage : BASE_URL=http://127.0.0.1:8282 ADMIN_PASSWORD=... python3 scripts/magasin-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "ci-admin-password-test")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("ok   " if condition else "ECHEC ") + message)
    if not condition:
        failures.append(message)


def game(id, name, label, status, *, installed=None, latest="1.0.0", error=None, last_error=None, builtin=False):
    return {
        "id": id,
        "tag": f"{id}-v{latest}",
        "latestVersion": latest,
        "name": name,
        "description": "Description de test.",
        "author": "Test",
        "moduleLabel": label,
        "hasCover": False,
        "error": error,
        "builtin": builtin,
        "status": status,
        "installedVersion": installed,
        "pendingVersion": None,
        "autoUpdate": False,
        "lastError": last_error,
        "lastCheckedAt": "2026-10-20T07:10:00.000Z",
    }


GAMES = [
    game("gags-en-rafale", "Gags en rafale", "Jeu de cartes", "non_installe"),
    game("bombes-party", "Bombes party", "Jeu de plateau", "non_installe"),
    game("ponts", "Ponts", "Jeu de code", "non_installe", error="manifest.json invalide à ce tag."),
    game("quiz-a-theme", "Quiz à thème", "Questions médias", "a_jour", installed="1.2.0", latest="1.2.0"),
]

# Quota presque épuisé : trois jeux installables demandent environ douze appels, il reste cinq appels.
RESET_AT = int((time.time() + 20 * 60) * 1000)
CATALOG = {
    "repo": "matosman40/jeux-partyhub",
    "tokenConfigured": False,
    "autoUpdate": True,
    "checkedAt": "2026-10-20T07:10:00.000Z",
    "rateLimit": {"limit": 60, "remaining": 5, "resetAt": RESET_AT},
    "games": GAMES,
    "error": None,
}


def mock_store(page) -> None:
    def catalog(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(CATALOG))

    def no_job(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"job": None}))

    # Enregistré en dernier : prioritaire sur les règles plus générales.
    page.route(re.compile(r".*/api/admin/store(\?.*)?$"), catalog)
    page.route(re.compile(r".*/api/admin/store/jobs/current$"), no_job)


def login_and_open_store(page) -> None:
    page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    page.fill("input[type=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_selector("text=En service depuis", timeout=15000)
    page.goto(f"{BASE_URL}/admin?section=creation", wait_until="networkidle")
    page.wait_for_selector(".store-row", timeout=15000)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH, args=["--no-sandbox"])

        # Ordinateur
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        mock_store(page)
        login_and_open_store(page)

        ponts = page.locator(".store-row", has_text="Ponts")
        check(ponts.count() == 1, "le jeu « Ponts » est listé")
        badge = ponts.locator(".store-badge").inner_text().strip()
        check(badge == "Fiche illisible", f"la fiche illisible n’affiche pas « Disponible » (badge : « {badge} »)")

        quota = page.locator(".store-quota", has_text="Appels GitHub restants")
        check(quota.count() == 1, "le quota restant s’affiche sans jeton")
        check("5 sur 60" in quota.first.inner_text(), "le quota affiche « 5 sur 60 »")

        warning = page.locator(".store-quota.is-warning")
        check(warning.count() == 1, "un avertissement apparaît : « Installer tout » ne tient pas dans le quota")
        check("Il reste 5 appel(s) GitHub" in warning.first.inner_text(), "l’avertissement chiffre le manque")
        page.close()

        # Téléphone : pas de défilement horizontal, et la liste reste lisible.
        phone = browser.new_page(
            viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True
        )
        mock_store(phone)
        login_and_open_store(phone)
        width = phone.evaluate("document.documentElement.scrollWidth")
        check(width <= 390, f"pas de défilement horizontal sur téléphone (largeur de page : {width} px)")
        thumb = phone.locator(".store-thumb").first.bounding_box()
        check(thumb is not None and thumb["width"] <= 52, "la vignette tient en 3,2 rem sur téléphone")
        phone.close()

        browser.close()

    if failures:
        print(f"\n{len(failures)} contrôle(s) en échec.")
        return 1
    print("\nMagasin : tous les contrôles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
