#!/usr/bin/env python3
"""Vérifie la pause de partie dans un vrai navigateur.

Scénario, dans une salle d'entraînement (les robots jouent) :
- avant la pause, le jeu doit avancer (contrôle : sinon le test ne prouve rien) ;
- l'écran principal met la partie en pause : la surcouche « Partie en pause » apparaît ;
- pendant la pause, le contenu du jeu ne change plus (décomptes et robots figés) ;
- le téléphone du joueur affiche la pause ;
- la reprise relance le jeu : l'écran avance à nouveau.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/pause-check-browser.py [identifiant_du_jeu]
Code de sortie : 1 si un point du scénario échoue.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
GAME_ID = sys.argv[1] if len(sys.argv) > 1 else "quiz-party"
WATCH_MS = 3500
FROZEN_MS = 4000


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def join_phone(page, code: str) -> None:
    """Le téléphone rejoint la salle, entre dans le salon et se déclare prêt."""
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    name = page.get_by_label("Votre nom", exact=False)
    if name.count():
        name.first.fill("Pause")
        page.get_by_role("button", name="Continuer").first.click()
    enter = page.get_by_role("button", name=re.compile("entrer dans la salle", re.I))
    enter.first.wait_for(timeout=15000)
    enter.first.click()
    ready = page.get_by_role("button", name=re.compile("Je suis prêt", re.I))
    ready.first.wait_for(timeout=15000)
    ready.first.click()


def game_text(tv) -> str:
    """Texte du plateau de jeu sur l'écran principal (sans la surcouche de pause ni la barre de commandes)."""
    return tv.evaluate("() => (document.querySelector('.stage-game') || document.body).innerText")


def show_bar(tv) -> None:
    """La barre de commandes ne s'affiche qu'après une activité de la souris ou du clavier."""
    tv.mouse.move(960, 1000)
    tv.wait_for_timeout(400)


def main() -> int:
    room = post_json("/api/rooms", {"gameId": GAME_ID, "practice": True})
    code, token = room["code"], room["hostToken"]
    failures: list[str] = []

    def check(ok: bool, label: str) -> None:
        print(f"     {'OK ' if ok else 'ÉCHEC'} {label}")
        if not ok:
            failures.append(label)

    print(f"Pause de partie ({GAME_ID}), salle {code}")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, bypass_csp=True)
        phone_ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True
        )
        tv = tv_ctx.new_page()
        phone = phone_ctx.new_page()
        try:
            tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
            tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
            tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
            start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
            start.wait_for(timeout=15000)
            join_phone(phone, code)
            for _ in range(60):
                if start.is_enabled():
                    break
                tv.wait_for_timeout(250)
            start.click()

            pause_btn = tv.get_by_role("button", name="Mettre en pause")
            pause_btn.first.wait_for(timeout=15000)

            tv.wait_for_timeout(1000)
            before = game_text(tv)
            tv.wait_for_timeout(WATCH_MS)
            check(game_text(tv) != before, "avant la pause, le jeu avance (contrôle)")

            show_bar(tv)
            pause_btn.first.click()
            overlay = tv.locator(".stage-pause")
            overlay.wait_for(timeout=5000)
            check(overlay.is_visible(), "l’écran principal affiche la surcouche de pause")

            frozen_at = game_text(tv)
            tv.wait_for_timeout(FROZEN_MS)
            check(game_text(tv) == frozen_at, f"pendant {FROZEN_MS // 1000} s de pause, le jeu ne change plus")

            phone_notice = phone.locator(".seat-pause")
            phone_notice.wait_for(timeout=8000)
            check(phone_notice.is_visible(), "le téléphone affiche que la partie est en pause")

            overlay.get_by_role("button", name="Reprendre la partie").click()
            overlay.wait_for(state="hidden", timeout=5000)
            check(True, "la reprise retire la surcouche")

            tv.wait_for_timeout(1000)
            resumed_from = game_text(tv)
            tv.wait_for_timeout(WATCH_MS + 1500)
            check(game_text(tv) != resumed_from, "après la reprise, le jeu avance à nouveau")
        except Exception as err:  # noqa: BLE001 — le script doit rendre un verdict, pas planter
            failures.append(f"exception : {err}")
            print(f"     ÉCHEC inattendu : {err}")
        finally:
            browser.close()

    if failures:
        print(f"Échec : {len(failures)} point(s) du scénario non tenus.")
        return 1
    print("Pause vérifiée : figée pendant la pause, reprise correcte.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
