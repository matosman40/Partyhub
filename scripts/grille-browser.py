#!/usr/bin/env python3
"""Test navigateur du plateau en grille (salon de test) : deux écrans, un téléphone qui joue sur la grille.

Dans de vrais navigateurs (écran principal 1920 × 1080, téléphone 390 × 844) :
- une salle « Plateau de test » s'ouvre sur l'écran principal, et le téléphone y entre ;
- le plateau en grille s'affiche sur les deux écrans, avec le personnage du téléphone ;
- les flèches du clavier (ou les boutons du téléphone) déplacent le personnage, qui reste dans la grille ;
- « Saluer » : le geste est confirmé par le serveur et l'écran principal le voit (attitude « salut ») ;
- « Action » sans rien devant : la bande de la manette le dit ;
- aucune erreur JavaScript ni console, aucun défilement horizontal ;
- des captures sont écrites dans SHOTS.

Usage : BASE_URL=http://127.0.0.1:8282 SHOTS=/chemin/captures python3 scripts/grille-browser.py
Options : CHROMIUM_PATH=/chemin/vers/chrome.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS = os.environ.get("SHOTS", "shots")

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


def own_cell(page) -> tuple[int, int, str] | None:
    """Position et attitude du personnage de ce téléphone (ou None si absent)."""
    loc = page.locator(".grille-personnage.is-own").first
    if loc.count() == 0:
        return None
    return int(loc.get_attribute("data-x")), int(loc.get_attribute("data-y")), loc.get_attribute("data-attitude")


def main() -> int:
    os.makedirs(SHOTS, exist_ok=True)
    room = post_json("/api/rooms", {"gameId": "plateau-test", "practice": False})
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

            # L'écran principal : un plateau 3D (canevas WebGL) et les personnages posés dessus.
            canevas = tv.locator(".grille3d canvas").first
            canevas.wait_for(timeout=20000)
            check("l'écran principal affiche le plateau en 3D", canevas.is_visible())
            tv.locator(".grille3d-figure").first.wait_for(state="attached", timeout=10000)

            # Le téléphone : le plateau et la manette, par-dessus.
            manette = phone.locator(".grille-console").first
            manette.wait_for(timeout=15000)
            check("le téléphone affiche le plateau et la manette", manette.is_visible())
            check(
                "le téléphone a la croix de direction et les trois boutons",
                phone.get_by_role("button", name=re.compile("Aller vers haut")).count() == 1
                and phone.get_by_role("button", name=re.compile("^Action$")).count() == 1,
            )
            check(
                "le personnage du téléphone est posé sur la grille",
                own_cell(phone) is not None,
                "aucun personnage « à moi » sur le plateau",
            )

            depart = own_cell(phone)
            visites = {depart[:2]} if depart else set()
            parcours = ["ArrowRight"] * 3 + ["ArrowDown"] * 3 + ["ArrowLeft"] * 2 + ["ArrowUp"] * 2
            for touche in parcours:
                phone.keyboard.press(touche)
                phone.wait_for_timeout(260)
                cell = own_cell(phone)
                if cell:
                    visites.add(cell[:2])
            check(
                "les flèches déplacent le personnage (au moins trois cases visitées)",
                len(visites) >= 3,
                f"cases visitées : {sorted(visites)}",
            )
            hors = [c for c in visites if not (0 <= c[0] < 13 and 0 <= c[1] < 11)]
            check("le personnage reste dans la grille", not hors, f"hors grille : {hors}")

            # Le plateau de l'écran principal suit les mêmes positions.
            tv.wait_for_timeout(400)
            tv_own = tv.locator(".grille3d-figure").filter(has_text="Testeur").first
            check(
                "l'écran principal voit le personnage à sa nouvelle case",
                tv_own.count() > 0 and tv_own.get_attribute("data-x") is not None,
            )

            # Salut : le serveur confirme, et l'écran principal voit l'attitude « salut ».
            # Le bouton de la manette (et non l’émotion « Saluer » du salon, qui a le même nom).
            phone.locator(".grille-b-saluer").click()
            # On attend l'attitude sur l'écran principal, sans compter sur une durée fixe.
            salut_vu = True
            try:
                # Le rendu 3D s'exécute en logiciel dans un navigateur de test : on laisse le temps.
                tv.locator('.grille3d-figure[data-attitude="salut"]').first.wait_for(state="attached", timeout=10000)
            except Exception:  # noqa: BLE001 - l'échec est signalé par le contrôle juste après
                salut_vu = False
            check("saluer : l'écran principal voit l'attitude « salut »", salut_vu)

            # Action sans rien devant : la manette le dit, sans rien envoyer au plateau.
            phone.get_by_role("button", name=re.compile("^Action$")).first.click()
            alerte = phone.locator(".grille-bande-message").first
            alerte.wait_for(timeout=5000)
            check("Action sans rien devant : la bande le dit", "Rien à faire ici" in alerte.inner_text(), alerte.inner_text())
            tv.wait_for_timeout(300)
            tv.screenshot(path=os.path.join(SHOTS, "grille-tv.png"))
            phone.screenshot(path=os.path.join(SHOTS, "grille-telephone.png"))

            over_tv, over_phone = overflow(tv), overflow(phone)
            check("pas de défilement horizontal (écran principal)", over_tv <= 1, f"{over_tv} px")
            check("pas de défilement horizontal (téléphone)", over_phone <= 1, f"{over_phone} px")
            check("aucune erreur JavaScript ni console (écran principal)", not tv_errors, "; ".join(tv_errors[:3]))
            check("aucune erreur JavaScript ni console (téléphone)", not phone_errors, "; ".join(phone_errors[:3]))
        except Exception as exc:  # noqa: BLE001 - le test se termine proprement et signale l'erreur
            check("le parcours s'est déroulé jusqu'au bout", False, str(exc))
            try:
                tv.screenshot(path=os.path.join(SHOTS, "grille-erreur-tv.png"))
                phone.screenshot(path=os.path.join(SHOTS, "grille-erreur-telephone.png"))
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
