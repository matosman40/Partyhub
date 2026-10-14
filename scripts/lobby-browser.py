#!/usr/bin/env python3
"""Test navigateur de tous les jeux : réglages du salon et vue du téléphone.

Pour chaque jeu du catalogue, crée une salle (API) puis vérifie, dans un vrai navigateur :
- l'écran TV du salon affiche les réglages du jeu (leur code est chargé à la demande) ;
- la page du téléphone, une fois la salle rejointe, s'affiche sans erreur ;
- aucune erreur JavaScript ni console, et aucun défilement horizontal.

Les jeux de cartes et de plateau sont couverts ici par leurs réglages ; leurs parties complètes
sont dans games-browser.py.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/lobby-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None

failures: list[str] = []


def get_json(path: str):
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=15) as res:
        return json.loads(res.read())


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def check_lobby(browser, game: dict) -> None:
    """Écran TV du salon (avec le jeton d'hôte) : les réglages du jeu doivent apparaître, sans erreur."""
    name = game["name"]
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code, token = room["code"], room["hostToken"]
    context = browser.new_context(viewport={"width": 1920, "height": 1080})
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)
    try:
        page.goto(BASE_URL + "/", wait_until="domcontentloaded")
        page.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        page.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        page.get_by_role("button", name="Lancer la partie").first.wait_for(timeout=15000)
        # Le code des réglages se charge à la demande : le texte d'attente doit disparaître.
        page.wait_for_function(
            "() => !document.body.innerText.includes('Chargement des réglages')",
            timeout=15000,
        )
        if errors:
            failures.append(f"{name} TV : " + " | ".join(errors[:3]))
        if overflow(page) > 0:
            failures.append(f"{name} TV : débordement horizontal de {overflow(page)} px")
        print(f"OK  {name} salon TV (code {code})" if not errors else f"ERR {name} salon TV")
    except Exception as exc:  # noqa: BLE001 - un échec est rapporté, pas interrompu
        failures.append(f"{name} TV : {exc}")
        print(f"ERR {name} salon TV : {exc}")
    finally:
        context.close()


def check_phone(browser, game: dict) -> None:
    """Page du téléphone : une fois la salle rejointe, la vue du jeu s'affiche sans erreur."""
    name = game["name"]
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code = room["code"]
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)
    try:
        page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(500)
        if errors:
            failures.append(f"{name} téléphone : " + " | ".join(errors[:3]))
        if overflow(page) > 0:
            failures.append(f"{name} téléphone : débordement horizontal de {overflow(page)} px")
        print(f"OK  {name} téléphone (débordement {overflow(page)} px)" if not errors else f"ERR {name} téléphone")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name} téléphone : {exc}")
        print(f"ERR {name} téléphone : {exc}")
    finally:
        context.close()


def main() -> int:
    catalog = get_json("/api/catalog")
    games = catalog["games"] if isinstance(catalog, dict) else catalog
    if not games:
        print("Catalogue vide : aucun jeu à tester.")
        return 1
    print(f"{len(games)} jeux au catalogue")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH) if CHROMIUM_PATH else p.chromium.launch()
        try:
            for game in games:
                check_lobby(browser, game)
                check_phone(browser, game)
        finally:
            browser.close()
    if failures:
        print("\nÉchecs :")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("\nTous les jeux s'affichent dans le salon et sur le téléphone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
