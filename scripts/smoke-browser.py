#!/usr/bin/env python3
"""Test de fumée navigateur : pages principales sur plusieurs tailles d'écran.

Vérifie, pour chaque page et chaque taille d'écran :
- la page répond et se charge sans erreur JavaScript ni erreur console ;
- aucun défilement horizontal (la mise en page tient dans la largeur de l'écran).

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/smoke-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None

# Écrans représentatifs : téléphones (les joueurs), tablette, TV / ordinateur (écran principal).
VIEWPORTS = {
    "téléphone 360 px": {"width": 360, "height": 740, "mobile": True},
    "téléphone 390 px (iPhone)": {"width": 390, "height": 844, "mobile": True},
    "tablette 768 px": {"width": 768, "height": 1024, "mobile": True},
    "ordinateur 1280 px": {"width": 1280, "height": 800, "mobile": False},
    "TV 1920 px": {"width": 1920, "height": 1080, "mobile": False},
}
PAGES = ["/", "/join"]

failures: list[str] = []


def check_api() -> None:
    with urllib.request.urlopen(f"{BASE_URL}/api/catalog", timeout=10) as res:
        data = json.loads(res.read())
    games = data.get("games", [])
    if not games:
        failures.append("/api/catalog : aucun jeu listé")
    print(f"API catalogue : {len(games)} jeux")


def check_page(browser, path: str, label: str, spec: dict) -> None:
    context = browser.new_context(
        viewport={"width": spec["width"], "height": spec["height"]},
        is_mobile=spec["mobile"],
        has_touch=spec["mobile"],
        device_scale_factor=2 if spec["mobile"] else 1,
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on(
        "console",
        lambda msg: errors.append(f"console : {msg.text}") if msg.type == "error" else None,
    )
    name = f"{path} · {label}"
    try:
        response = page.goto(f"{BASE_URL}{path}", wait_until="networkidle", timeout=20000)
        status = response.status if response else 0
        if status != 200:
            failures.append(f"{name} : HTTP {status}")
        page.wait_for_timeout(300)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        if overflow > 1:
            failures.append(f"{name} : défilement horizontal de {overflow} px")
        if errors:
            failures.append(f"{name} : {len(errors)} erreur(s), par exemple « {errors[0]} »")
        print(f"{'OK ' if not errors and status == 200 and overflow <= 1 else 'KO '} {name} (HTTP {status}, débordement {overflow} px)")
    except Exception as exc:  # noqa: BLE001 - on veut rapporter tout échec de chargement
        failures.append(f"{name} : {exc}")
        print(f"KO  {name} : {exc}")
    finally:
        context.close()


def main() -> int:
    check_api()
    with sync_playwright() as p:
        launch = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            launch["executable_path"] = CHROMIUM_PATH
        browser = p.chromium.launch(**launch)
        for path in PAGES:
            for label, spec in VIEWPORTS.items():
                check_page(browser, path, label, spec)
        browser.close()
    if failures:
        print("\nÉchecs :")
        for item in failures:
            print(f"- {item}")
        return 1
    print("\nTous les contrôles de navigation sont passés.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
