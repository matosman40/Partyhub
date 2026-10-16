#!/usr/bin/env python3
"""Test navigateur de BOUM ! : une partie d'entraînement, un téléphone, et le déroulé des manches.

Dans de vrais navigateurs (écran principal 1920 × 1080, téléphone 390 × 844) :
- la salle BOUM ! d'entraînement (avec des robots) se lance depuis l'écran principal ;
- l'écran principal affiche « Manche n / total », et le compteur change au fil des manches ;
- un téléphone rejoint, et sa vue de jeu s'affiche pendant la partie ;
- aucune erreur JavaScript ni console, aucun défilement horizontal ;
- des captures sont écrites dans SHOTS.

Le test attend au plus DURATION secondes (180 par défaut) : il s'arrête dès que deux manches sont vues.

Usage : BASE_URL=http://127.0.0.1:8282 SHOTS=/chemin/captures python3 scripts/boum-browser.py
Options : CHROMIUM_PATH=/chemin/vers/chrome ; DURATION=secondes.
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
DURATION = int(os.environ.get("DURATION", "180"))
MANCHE = re.compile(r"Manche (\d+) / (\d+)")

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


def main() -> int:
    os.makedirs(SHOTS, exist_ok=True)
    room = post_json("/api/rooms", {"gameId": "boum", "practice": True})
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
            # Le téléphone rejoint avant le lancement : une partie déjà commencée refuse les nouveaux joueurs.
            phone.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
            phone.get_by_label(re.compile("pseudo", re.I)).first.fill("Testeur")
            phone.get_by_role("button", name=re.compile("entrer|rejoindre|continuer", re.I)).first.click()
            phone.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first.wait_for(timeout=15000)
            phone.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first.click()

            start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
            start.wait_for(timeout=15000)
            for _ in range(40):
                if start.is_enabled():
                    break
                tv.wait_for_timeout(250)
            start.click()

            seen: set[tuple[int, int]] = set()
            first_text = ""
            phone_text_ok = False
            rhythm_counted: bool | None = None
            started = time.time()
            while time.time() - started < DURATION and len({n for n, _ in seen}) < 2:
                body = tv.inner_text("body")
                match = MANCHE.search(body)
                if match:
                    seen.add((int(match.group(1)), int(match.group(2))))
                    if not first_text:
                        first_text = body
                pad = phone.locator("button.rhythm-pad")
                if rhythm_counted is None and pad.count() and pad.first.is_enabled():
                    # Manche Rythme : le téléphone tape le rythme, l'écran principal compte les joueurs qui ont tapé.
                    # Le rythme compte de 3 à 5 intervalles, tirés au hasard : on tape jusqu'à l'envoi (6 coups au plus).
                    for _ in range(6):
                        if pad.count() == 0 or not pad.first.is_enabled():
                            break
                        pad.first.click()
                        phone.wait_for_timeout(250)
                    tv.wait_for_timeout(600)
                    counted = re.search(r"([1-9]\d*) joueur\(s\) ont tapé", tv.inner_text("body"))
                    rhythm_counted = bool(counted)
                phone_body = phone.inner_text("body")
                # La vue de jeu remplace l'écran d'entrée : plus de bouton « Entrer dans la salle », pas d'erreur.
                if "Entrer dans la salle" not in phone_body and "impossible" not in phone_body.lower():
                    phone_text_ok = True
                tv.wait_for_timeout(2000)

            check("l'écran principal affiche « Manche n / total »", bool(seen), f"aucune manche vue")
            check(
                "le déroulé avance (au moins deux manches vues)",
                len({n for n, _ in seen}) >= 2,
                f"manches vues : {sorted(seen)}",
            )
            check("le téléphone affiche sa vue de jeu pendant la partie", phone_text_ok)
            if rhythm_counted is None:
                print("INFO manche Rythme non tirée pendant ce test : geste de tap non vérifié")
            else:
                check("le tap sur le téléphone est compté sur l'écran principal (Rythme)", rhythm_counted)

            tv.screenshot(path=os.path.join(SHOTS, "boum-tv.png"))
            phone.screenshot(path=os.path.join(SHOTS, "boum-telephone.png"))
            over_tv, over_phone = overflow(tv), overflow(phone)
            check("pas de défilement horizontal (écran principal)", over_tv <= 1, f"{over_tv} px")
            check("pas de défilement horizontal (téléphone)", over_phone <= 1, f"{over_phone} px")
            check("aucune erreur sur l'écran principal", not tv_errors, tv_errors[0] if tv_errors else "")
            check("aucune erreur sur le téléphone", not phone_errors, phone_errors[0] if phone_errors else "")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"BOUM ! : {exc}")
            print(f"KO  BOUM ! : {exc}")
        finally:
            phone_ctx.close()
            tv_ctx.close()
            browser.close()

    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f" - {f}")
        return 1
    print("\nBOUM ! se joue sans erreur dans le navigateur.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
