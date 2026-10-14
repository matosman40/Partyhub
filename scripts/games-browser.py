#!/usr/bin/env python3
"""Test navigateur des jeux de cartes : une partie complète avec robots, écran TV et téléphone.

Pour chaque jeu : crée une salle d'entraînement (API), ouvre l'écran TV avec le jeton d'hôte,
lance la partie, puis vérifie que l'écran s'affiche sans erreur ni débordement. Pour les jeux
où un téléphone peut rejoindre la salle, un joueur réel rejoint et prend part à la vue joueur.

Usage : BASE_URL=http://127.0.0.1:8282 CHROMIUM_PATH=... python3 scripts/games-browser.py
"""
import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS = os.environ.get("SHOTS_DIR", "/tmp")

# Jeu, identifiant, mot attendu sur l'écran TV une fois la partie lancée, et joueur téléphone possible.
GAMES = [
    {"id": "poker", "name": "Poker", "expect": re.compile(r"pot|mise|croupier", re.I), "phone": True},
    {"id": "rami-51", "name": "Rami 51", "expect": re.compile(r"pioche|rami|défausse", re.I), "phone": True},
    # Tarot exige 4 joueurs : les 3 robots et un téléphone. Il n'a donc pas de passage TV seul.
    {"id": "tarot", "name": "Tarot", "expect": re.compile(r"enchère|chien|pli|contrat", re.I), "phone": True, "tv_alone": False},
]

failures: list[str] = []


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


def tv_for(browser, game: dict) -> None:
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
        start = page.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)
        for _ in range(40):
            if start.is_enabled():
                break
            page.wait_for_timeout(250)
        start.click()
        page.wait_for_timeout(6000)  # les robots jouent : quelques actions suffisent pour l'affichage
        text = page.inner_text("body")
        page.screenshot(path=os.path.join(SHOTS, f"tv-{game['id']}.png"))
        over = overflow(page)
        if not game["expect"].search(text):
            failures.append(f"{name} (TV) : texte attendu absent de l'écran")
        if errors:
            failures.append(f"{name} (TV) : {len(errors)} erreur(s), par exemple « {errors[0]} »")
        if over > 1:
            failures.append(f"{name} (TV) : défilement horizontal de {over} px")
        print(f"{'OK ' if not errors and over <= 1 else 'KO '} {name} TV (code {code}, débordement {over} px)")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name} (TV) : {exc}")
        print(f"KO  {name} TV : {exc}")
    finally:
        context.close()


def phone_for(browser, game: dict) -> None:
    name = game["name"]
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code, token = room["code"], room["hostToken"]
    tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    tv = tv_ctx.new_page()
    phone_ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    errors: list[str] = []
    watch(phone, errors)
    tv_errors: list[str] = []
    watch(tv, tv_errors)
    try:
        tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)

        phone.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
        phone.get_by_label(re.compile("pseudo", re.I)).first.fill("Testeur")
        phone.get_by_role("button", name=re.compile("entrer|rejoindre|rejoindre la salle|continuer", re.I)).first.click()
        ready = phone.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first
        ready.wait_for(timeout=15000)
        ready.click()

        start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)
        for _ in range(40):
            if start.is_enabled():
                break
            tv.wait_for_timeout(250)
        start.click()
        phone.wait_for_timeout(5000)
        phone_text = phone.inner_text("body")
        tv_text = tv.inner_text("body")
        if not game["expect"].search(tv_text):
            failures.append(f"{name} (TV, avec téléphone) : texte attendu absent de l'écran")
        tv.screenshot(path=os.path.join(SHOTS, f"tv-phone-{game['id']}.png"))
        phone.screenshot(path=os.path.join(SHOTS, f"phone-{game['id']}.png"))
        over = overflow(phone)
        if not game["expect"].search(phone_text):
            failures.append(f"{name} (téléphone) : vue de jeu absente")
        if errors:
            failures.append(f"{name} (téléphone) : {len(errors)} erreur(s), par exemple « {errors[0]} »")
        if tv_errors:
            failures.append(f"{name} (TV, avec téléphone) : {len(tv_errors)} erreur(s), par exemple « {tv_errors[0]} »")
        if over > 1:
            failures.append(f"{name} (téléphone) : défilement horizontal de {over} px")
        print(f"{'OK ' if not errors and not tv_errors and over <= 1 else 'KO '} {name} téléphone + TV (débordement {over} px)")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name} (téléphone) : {exc}")
        print(f"KO  {name} téléphone : {exc}")
    finally:
        phone_ctx.close()
        tv_ctx.close()


def main() -> int:
    with sync_playwright() as p:
        launch = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            launch["executable_path"] = CHROMIUM_PATH
        browser = p.chromium.launch(**launch)
        for game in GAMES:
            if game.get("tv_alone", True):
                tv_for(browser, game)
            if game["phone"]:
                phone_for(browser, game)
        browser.close()
    if failures:
        print("\nÉchecs :")
        for item in failures:
            print(f"- {item}")
        return 1
    print("\nTous les jeux de cartes s'affichent sans erreur.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
