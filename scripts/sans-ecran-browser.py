#!/usr/bin/env python3
"""Test navigateur du mode « sans écran » : tout se joue sur les téléphones.

Scénario, dans de vrais navigateurs (deux téléphones, deux contextes isolés) :
1. le téléphone A crée une salle « sans écran » depuis la fiche du jeu (bouton « Créer sans écran ») ;
   il arrive sur sa salle, sans écran TV connecté ;
2. le téléphone B rejoint la salle avec le code ;
3. le téléphone B recharge la page : il reste assis à sa place (reconnexion) ;
4. le téléphone A retrouve la salle dans « Parties en cours » sur l'accueil, et peut la rouvrir.

Pour chaque page : aucune erreur JavaScript ni console, aucun défilement horizontal.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/sans-ecran-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chromium pour utiliser un Chromium existant.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
GAME_ID = os.environ.get("GAME_ID", "plutot-qui")
PHONE_WIDTH, PHONE_HEIGHT = 390, 844

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("ok    " if condition else "ECHEC ") + message)
    if not condition:
        failures.append(message)


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def ensure_profile(page, name: str) -> None:
    """Premier passage sur un appareil : le site demande un nom (sans mot de passe)."""
    field = page.get_by_label("Votre nom")
    if field.count() and field.is_visible():
        field.fill(name)
        page.get_by_role("button", name="Continuer").click()
        page.wait_for_load_state("networkidle")


def check_page(page, errors: list[str], label: str) -> None:
    check(not errors, f"{label} : aucune erreur JavaScript ni console" + (f" ({errors[:2]})" if errors else ""))
    check(overflow(page) <= 0, f"{label} : pas de défilement horizontal")


def code_from_url(url: str) -> str | None:
    match = re.search(r"/j/(\d{4,6})", url)
    return match.group(1) if match else None


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH) if CHROMIUM_PATH else p.chromium.launch()

        # 1. Téléphone A : crée la salle sans écran depuis la fiche du jeu.
        ctx_a = browser.new_context(viewport={"width": PHONE_WIDTH, "height": PHONE_HEIGHT}, is_mobile=True, has_touch=True)
        phone_a = ctx_a.new_page()
        errors_a: list[str] = []
        watch(phone_a, errors_a)
        phone_a.goto(f"{BASE_URL}/jeux/{GAME_ID}", wait_until="networkidle")
        ensure_profile(phone_a, "Alice")
        phone_a.goto(f"{BASE_URL}/jeux/{GAME_ID}", wait_until="networkidle")
        create = phone_a.get_by_role("button", name="Créer sans écran")
        expect(create).to_be_visible(timeout=15000)
        create.click()
        phone_a.wait_for_url(re.compile(r"/j/\d{4,6}$"), timeout=15000)
        code = code_from_url(phone_a.url)
        check(code is not None, f"A : redirigé vers la salle sans écran ({phone_a.url})")
        if code is None:
            browser.close()
            return 1
        # Pas d'écran TV connecté : le salon le dit, et la vue reste celle du téléphone.
        room = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/rooms/{code}", timeout=10).read())
        check(room.get("exists") is True, f"A : la salle {code} existe côté serveur ({room.get('status')})")
        check_page(phone_a, errors_a, "A (salle sans écran)")

        # 2. Téléphone B : rejoint avec le code.
        ctx_b = browser.new_context(viewport={"width": PHONE_WIDTH, "height": PHONE_HEIGHT}, is_mobile=True, has_touch=True)
        phone_b = ctx_b.new_page()
        errors_b: list[str] = []
        watch(phone_b, errors_b)
        phone_b.goto(f"{BASE_URL}/join", wait_until="networkidle")
        ensure_profile(phone_b, "Bob")
        phone_b.goto(f"{BASE_URL}/join", wait_until="networkidle")
        phone_b.locator("input.code-input").fill(code)
        phone_b.get_by_role("button", name="Continuer").click()
        phone_b.wait_for_url(re.compile(rf"/j/{code}$"), timeout=15000)
        check(True, f"B : a rejoint la salle {code}")
        phone_b.wait_for_timeout(800)
        check_page(phone_b, errors_b, "B (joueur)")

        # 3. Reconnexion : B recharge sa page, il doit rester assis (même place, même salle).
        phone_b.reload(wait_until="networkidle")
        phone_b.wait_for_timeout(800)
        check(code_from_url(phone_b.url) == code, "B : après rechargement, toujours sur la même salle")
        check_page(phone_b, errors_b, "B (après rechargement)")

        # 4. A retrouve la salle sur l'accueil et peut la rouvrir.
        phone_a.goto(f"{BASE_URL}/", wait_until="networkidle")
        mine = phone_a.get_by_role("heading", name="Parties en cours")
        expect(mine).to_be_visible(timeout=15000)
        section = phone_a.locator(".my-rooms")
        resume = section.get_by_role("link", name=re.compile("Rejoindre|Reprendre"))
        check(resume.count() >= 1, "A : « Parties en cours » liste la salle, avec un bouton pour la rejoindre")
        resume.first.click()
        phone_a.wait_for_url(re.compile(rf"/j/{code}$"), timeout=15000)
        check(True, "A : la salle se rouvre en un clic depuis l'accueil")
        check_page(phone_a, errors_a, "A (accueil puis salle)")

        browser.close()

    if failures:
        print(f"\n{len(failures)} échec(s).")
        return 1
    print("\nTous les contrôles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
