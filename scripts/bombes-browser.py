#!/usr/bin/env python3
"""Test navigateur de Bombes party : un téléphone se déplace sur le plateau bomberman, puis danse et sourit.

Dans de vrais navigateurs (écran principal 1920 × 1080, téléphone 390 × 844) :
- une salle Bombes party (avec des robots) se lance depuis l'écran principal ;
- le téléphone rejoint, et ses flèches le font marcher sur le plateau : sa case change, reste dans la grille ;
- le bouton « Danser » et le bouton « Sourire » sont actifs en partie, et l'expression est confirmée par le serveur
  (attribut data-emote du téléphone), puis elle s'arrête seule ;
- aucune erreur JavaScript ni console, aucun défilement horizontal ;
- des captures sont écrites dans SHOTS.

Usage : BASE_URL=http://127.0.0.1:8291 SHOTS=/chemin/captures python3 scripts/bombes-browser.py
Options : CHROMIUM_PATH=/chemin/vers/chrome ; DURATION=secondes (60 par défaut).
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
SHOTS = os.environ.get("SHOTS", "shots")
DURATION = int(os.environ.get("DURATION", "60"))

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


def check(label: str, ok: bool, detail: str = "") -> None:
    if not ok:
        failures.append(f"{label}{(' : ' + detail) if detail else ''}")
    print(f"{'OK ' if ok else 'KO '} {label}{(' — ' + detail) if detail and not ok else ''}")


def position(phone) -> tuple[int, int] | None:
    raw = phone.locator(".arena-player").first.get_attribute("data-pos")
    if not raw:
        return None
    x, y = raw.split(",")
    return int(x), int(y)


def emote_of(phone) -> str | None:
    return phone.locator(".arena-player").first.get_attribute("data-emote")


def wait_emote(phone, expected: str | None, timeout_ms: int) -> bool:
    """Attend que le téléphone affiche l'expression attendue (None : aucune)."""
    end = time.time() + timeout_ms / 1000
    while time.time() < end:
        if emote_of(phone) == expected:
            return True
        phone.wait_for_timeout(100)
    return emote_of(phone) == expected


def main() -> int:
    os.makedirs(SHOTS, exist_ok=True)
    room = post_json("/api/rooms", {"gameId": "bombes-party", "practice": True})
    code, token = room["code"], room["hostToken"]
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH, args=["--no-sandbox"])
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        tv = tv_ctx.new_page()
        tv_errors: list[str] = []
        watch(tv, tv_errors)
        phone_ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        phone = phone_ctx.new_page()
        phone_errors: list[str] = []
        watch(phone, phone_errors)
        try:
            tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
            tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
            tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
            phone.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
            phone.get_by_label(re.compile("votre nom", re.I)).first.fill("Testeur")
            phone.get_by_role("button", name=re.compile("continuer", re.I)).first.click()
            phone.get_by_role("button", name=re.compile("entrer dans la salle", re.I)).first.click()
            phone.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first.wait_for(timeout=15000)
            phone.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first.click()

            start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
            start.wait_for(timeout=15000)
            for _ in range(40):
                if start.is_enabled():
                    break
                tv.wait_for_timeout(250)
            start.click()

            # La partie commence : le téléphone affiche son plateau.
            arena = phone.locator(".arena-player").first
            arena.wait_for(timeout=15000)
            check("le téléphone affiche le plateau en partie", arena.is_visible())

            # Déplacement : un parcours en carré sur le plateau, avec les flèches du clavier.
            depart = position(phone)
            visites = {depart}
            parcours = ["ArrowRight"] * 3 + ["ArrowDown"] * 3 + ["ArrowLeft"] * 2 + ["ArrowUp"] * 2
            for touche in parcours:
                phone.keyboard.press(touche)
                phone.wait_for_timeout(260)
                visites.add(position(phone))
            visites.discard(None)
            check(
                "le personnage se déplace sur le plateau (au moins trois cases visitées)",
                len(visites) >= 3,
                f"cases visitées : {sorted(visites)}",
            )
            hors = [c for c in visites if not (0 <= c[0] < 13 and 0 <= c[1] < 11)]
            check("le personnage reste dans la grille du plateau", not hors, f"hors grille : {hors}")

            # Expressions : les boutons sont actifs en partie, et le serveur confirme chaque expression.
            danser = phone.get_by_role("button", name=re.compile("Danser sur place"))
            sourire = phone.get_by_role("button", name=re.compile("Sourire sur place"))
            actifs = danser.is_enabled() and sourire.is_enabled()
            check("les boutons Danser et Sourire sont actifs en partie", actifs)
            if actifs:
                danser.click()
                check("danser : l'expression est confirmée par le serveur", wait_emote(phone, "dance", 2500))
                phone.screenshot(path=os.path.join(SHOTS, "bombes-danse.png"))
                check("danser : l'expression s'arrête seule", wait_emote(phone, None, 5000))

                sourire.click()
                check("sourire : l'expression est confirmée par le serveur", wait_emote(phone, "smile", 2500))
                phone.screenshot(path=os.path.join(SHOTS, "bombes-sourire.png"))
                check("sourire : l'expression s'arrête seule", wait_emote(phone, None, 5000))
            else:
                print("INFO boutons d'expression désactivés : personnage éliminé pendant le test")

            tv.wait_for_timeout(800)
            tv.screenshot(path=os.path.join(SHOTS, "bombes-tv.png"))
            phone.screenshot(path=os.path.join(SHOTS, "bombes-telephone.png"))
            over_tv, over_phone = overflow(tv), overflow(phone)
            check("pas de défilement horizontal (écran principal)", over_tv <= 1, f"{over_tv} px")
            check("pas de défilement horizontal (téléphone)", over_phone <= 1, f"{over_phone} px")
            check("aucune erreur JavaScript ni console (écran principal)", not tv_errors, "; ".join(tv_errors[:3]))
            check("aucune erreur JavaScript ni console (téléphone)", not phone_errors, "; ".join(phone_errors[:3]))
        except Exception as exc:  # noqa: BLE001 - le test se termine proprement et signale l'erreur
            check("le parcours s'est déroulé jusqu'au bout", False, str(exc))
            try:
                tv.screenshot(path=os.path.join(SHOTS, "bombes-erreur-tv.png"))
                phone.screenshot(path=os.path.join(SHOTS, "bombes-erreur-telephone.png"))
            except Exception:  # noqa: BLE001
                pass
        finally:
            browser.close()

    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f" - {f}")
        return 1
    print("\nTous les contrôles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
