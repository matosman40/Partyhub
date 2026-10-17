#!/usr/bin/env python3
"""Test navigateur des appareils : détection, affichage adapté et spectateurs.

Dans de vrais navigateurs (téléphone, tablette, ordinateur, téléviseur 4K) :
- la page d'accueil détecte le bon type d'appareil (data-device) et une taille d'affichage ;
- aucun défilement horizontal, aucune erreur JavaScript ;
- le choix manuel « Affichage » l'emporte sur la détection ;
- un téléphone rejoint la salle, l'écran TV affiche son icône, un spectateur le compte ;
- un second appareil ouvre la place du premier avec le lien « #place= » ;
- les captures d'écran sont écrites dans SHOTS_DIR pour être relues. Sans SHOTS_DIR, elles vont
  dans un dossier temporaire : les captures suivies dans devices-shots/ ne changent pas par accident.
  Pour mettre à jour les captures du dépôt : SHOTS_DIR=devices-shots.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/devices-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS_DIR = Path(os.environ["SHOTS_DIR"]) if os.environ.get("SHOTS_DIR") else Path(tempfile.mkdtemp(prefix="devices-shots-"))
SHOTS_DIR.mkdir(parents=True, exist_ok=True)

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
IPAD_UA = (
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
TV_UA = (
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) "
    "85.0.4183.93/7.0 TV Safari/537.36"
)

# nom, contexte Playwright, type attendu
SCENARIOS = [
    (
        "telephone",
        {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True, "user_agent": IPHONE_UA},
        "phone",
    ),
    (
        "tablette",
        {"viewport": {"width": 1024, "height": 768}, "is_mobile": True, "has_touch": True, "user_agent": IPAD_UA},
        "tablet",
    ),
    ("ordinateur", {"viewport": {"width": 1440, "height": 900}}, "desktop"),
    (
        "tv-4k",
        {"viewport": {"width": 3840, "height": 2160}, "user_agent": TV_UA},
        "tv",
    ),
]

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)
        print(f"  ECHEC : {message}")
    else:
        print(f"  ok : {message}")


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


def device_of(page) -> str:
    return page.evaluate("() => document.documentElement.dataset.device || ''")


def ui_scale(page) -> float:
    raw = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')")
    try:
        return float(raw.strip())
    except ValueError:
        return 0.0


def wait_device(page) -> None:
    page.wait_for_function("() => document.documentElement.dataset.device !== undefined", timeout=10000)


def scenario_checks(browser, name: str, options: dict, expected: str) -> None:
    print(f"\n== {name} (attendu : {expected}) ==")
    context = browser.new_context(**options)
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)

    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    wait_device(page)
    check(device_of(page) == expected, f"{name} : data-device = {device_of(page)!r}")
    scale = ui_scale(page)
    check(0.9 <= scale <= 1.8, f"{name} : --ui-scale = {scale}")
    check(overflow(page) <= 0, f"{name} : pas de défilement horizontal accueil ({overflow(page)}px)")
    page.screenshot(path=str(SHOTS_DIR / f"accueil-{name}.png"))

    # Le choix manuel prime sur la détection.
    page.evaluate("() => localStorage.setItem('ph:device', 'tablet')")
    page.reload(wait_until="networkidle")
    wait_device(page)
    check(device_of(page) == "tablet", f"{name} : choix manuel « tablette » appliqué ({device_of(page)!r})")
    page.evaluate("() => localStorage.removeItem('ph:device')")
    page.reload(wait_until="networkidle")
    wait_device(page)
    check(device_of(page) == expected, f"{name} : retour à la détection ({device_of(page)!r})")

    check(not errors, f"{name} : aucune erreur JavaScript ({len(errors)} erreur(s))")
    for line in errors[:5]:
        print(f"     {line}")
    context.close()


def room_flow(browser) -> None:
    print("\n== Salon : téléphone joue, TV voit l'icône, spectateur compté ==")
    room = post_json("/api/rooms", {"gameId": "reflexe", "practice": False})
    code, host_token = room["code"], room["hostToken"]

    # Écran principal (ordinateur) : il tient l'hôte.
    tv = browser.new_context(viewport={"width": 1920, "height": 1080})
    tv_page = tv.new_page()
    tv_errors: list[str] = []
    watch(tv_page, tv_errors)
    tv_page.goto(f"{BASE_URL}/", wait_until="networkidle")
    tv_page.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(host_token)})")
    tv_page.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle")
    tv_page.wait_for_selector(".stage-lobby", timeout=10000)

    # Téléphone : rejoint la salle depuis sa page joueur.
    phone = browser.new_context(**SCENARIOS[0][1])
    phone_page = phone.new_page()
    phone_errors: list[str] = []
    watch(phone_page, phone_errors)
    phone_page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle")
    # Appareil neuf : le profil (« Votre nom ») est créé avant d'entrer dans la salle.
    phone_page.get_by_label("Votre nom").fill("Léa")
    phone_page.get_by_role("button", name="Continuer").click()
    phone_page.get_by_role("button", name="Entrer dans la salle").click()
    phone_page.wait_for_selector("text=Je suis prêt", timeout=10000)
    check(True, "téléphone : entré dans la salle")

    # La liste des joueurs est dans le tiroir du menu d'angle (fermé par défaut).
    tv_page.get_by_role("button", name="Menu").click()
    tv_page.wait_for_selector(".corner-players .device-icons", timeout=10000)
    icons = tv_page.locator(".corner-players .device-icons").first.inner_text()
    check("📱" in icons, f"TV : icône téléphone affichée ({icons!r})")
    tv_page.screenshot(path=str(SHOTS_DIR / "tv-salon-avec-joueur.png"))

    # Spectateur : tablette qui regarde le salon.
    spectator = browser.new_context(**SCENARIOS[1][1])
    spec_page = spectator.new_page()
    spec_errors: list[str] = []
    watch(spec_page, spec_errors)
    spec_page.goto(f"{BASE_URL}/spectate/{code}", wait_until="networkidle")
    spec_page.wait_for_selector("text=En attente de la partie", timeout=10000)
    check(overflow(spec_page) <= 0, f"spectateur : pas de défilement horizontal ({overflow(spec_page)}px)")
    spec_page.screenshot(path=str(SHOTS_DIR / "spectateur-salon.png"))
    check(True, "spectateur : salon affiché")

    tv_page.wait_for_selector("text=1 spectateur(s)", timeout=10000)
    check(True, "TV : compte des spectateurs mis à jour")

    # Le lien « jouer sur un autre appareil » ouvre la même place ailleurs.
    token = phone_page.evaluate(f"() => JSON.parse(localStorage.getItem('ph:player:{code}') || 'null')?.token ?? null")
    check(bool(token), "téléphone : jeton de place présent sur l'appareil")
    other = browser.new_context(**SCENARIOS[1][1])
    other_page = other.new_page()
    other_errors: list[str] = []
    watch(other_page, other_errors)
    other_page.goto(f"{BASE_URL}/j/{code}#place={token}", wait_until="networkidle")
    # Appareil neuf : il crée d'abord son profil, puis la place partagée s'ouvre.
    other_page.get_by_label("Votre nom").fill("Marc")
    other_page.get_by_role("button", name="Continuer").click()
    other_page.wait_for_selector(".seat-tabs", timeout=10000)
    check("#place=" not in other_page.url, "second appareil : jeton retiré de l'adresse")
    check(True, "second appareil : place partagée, onglets de joueurs affichés")
    other_page.screenshot(path=str(SHOTS_DIR / "place-partagee-tablette.png"))

    for label, errs in [("TV", tv_errors), ("téléphone", phone_errors), ("spectateur", spec_errors), ("second appareil", other_errors)]:
        check(not errs, f"{label} : aucune erreur JavaScript ({len(errs)})")
        for line in errs[:5]:
            print(f"     {line}")

    for ctx in (tv, phone, spectator, other):
        ctx.close()


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH) if CHROMIUM_PATH else p.chromium.launch()
        try:
            for name, options, expected in SCENARIOS:
                scenario_checks(browser, name, options, expected)
            room_flow(browser)
        finally:
            browser.close()

    if failures:
        print(f"\n{len(failures)} échec(s).")
        return 1
    print("\nTous les contrôles d'appareils et de spectateurs sont passés.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
