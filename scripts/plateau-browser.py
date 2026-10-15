#!/usr/bin/env python3
"""Test navigateur du plateau de test : le bouton de l'accueil, trois téléphones, et le salon sur l'écran principal.

Vérifie, dans de vrais navigateurs :
- le bouton « Essayer le plateau » ouvre une salle, sans bouton de lancement sur l'écran principal ;
- chaque téléphone rejoint, et son personnage se déplace : glissé à la souris, placé d'un tap, ou aux flèches ;
- l'écran principal reçoit ces positions (même place à 2 % près) et l'émotion envoyée en bulle ;
- aucune erreur JavaScript ni console, aucun défilement horizontal ;
- des captures d'écran (écran principal, téléphone, accueil) sont enregistrées dans SHOTS.

Usage : BASE_URL=http://127.0.0.1:8290 SHOTS=/chemin/captures python3 scripts/plateau-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS = os.environ.get("SHOTS", "shots")
TOLERANCE = 0.02

failures: list[str] = []


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def figures(page) -> dict[str, tuple[float, float]]:
    """Position (fractions) de chaque personnage affiché, lue dans le style du plateau."""
    raw = page.evaluate(
        """() => [...document.querySelectorAll('.plateau-figure')].map((li) => ({
            name: li.querySelector('.plateau-name')?.textContent ?? '',
            left: li.style.left,
            top: li.style.top,
        }))"""
    )
    out = {}
    for item in raw:
        x = float(item["left"].rstrip("%")) / 100
        y = float(item["top"].rstrip("%")) / 100
        out[item["name"]] = (x, y)
    return out


def wait_figure_at(page, name: str, x: float, y: float, timeout_ms: int = 4000) -> bool:
    end = timeout_ms / 250
    for _ in range(int(end)):
        pos = figures(page).get(name)
        if pos and abs(pos[0] - x) <= TOLERANCE and abs(pos[1] - y) <= TOLERANCE:
            return True
        page.wait_for_timeout(250)
    return False


def check(label: str, ok: bool, detail: str = "") -> None:
    if not ok:
        failures.append(f"{label}{(' : ' + detail) if detail else ''}")
    print(f"{'OK ' if ok else 'KO '} {label}{(' — ' + detail) if detail and not ok else ''}")


def main() -> int:
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH, args=["--no-sandbox"])
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        tv = tv_ctx.new_page()
        tv_errors: list[str] = []
        watch(tv, tv_errors)
        phones = []
        phone_errors: list[str] = []
        try:
            # 1. Le bouton de l'accueil ouvre le plateau de test.
            tv.goto(BASE_URL + "/", wait_until="networkidle", timeout=20000)
            tv.screenshot(path=os.path.join(SHOTS, "accueil-plateau.png"))
            tv.get_by_role("button", name=re.compile("Essayer le plateau", re.I)).click()
            tv.wait_for_url(re.compile(r"/tv/[A-Z0-9]+"), timeout=15000)
            tv.wait_for_selector(".lobby-plateau .plateau-figures", timeout=15000)
            code = re.search(r"/tv/([A-Z0-9]+)", tv.url).group(1)
            check("le bouton de l'accueil ouvre une salle", bool(code), tv.url)
            check(
                "aucun bouton « Lancer la partie » sur le plateau de test",
                tv.get_by_role("button", name=re.compile("Lancer la partie")).count() == 0,
            )

            # 2. Trois téléphones rejoignent la salle.
            names = ["Lina", "Théo", "Sam"]
            for name in names:
                ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
                phone = ctx.new_page()
                watch(phone, phone_errors)
                phone.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
                phone.get_by_label(re.compile("pseudo", re.I)).first.fill(name)
                phone.get_by_role(
                    "button", name=re.compile("entrer|rejoindre|rejoindre la salle|continuer", re.I)
                ).first.click()
                phone.wait_for_selector(".lobby-plateau .plateau-figures", timeout=15000)
                phones.append((name, ctx, phone))
            check("trois téléphones rejoignent le plateau", True)

            # Les trois personnages apparaissent sur l'écran principal.
            seen = False
            for _ in range(60):
                if all(n in figures(tv) for n in names):
                    seen = True
                    break
                tv.wait_for_timeout(250)
            check("l'écran principal affiche les trois personnages", seen, str(figures(tv)))

            # 3. Lina glisse son personnage à la souris.
            _, _, lina = phones[0]
            own = lina.locator(".plateau-figure.is-own")
            board = lina.locator(".plateau").first.bounding_box()
            fig = own.bounding_box()
            sx, sy = fig["x"] + fig["width"] / 2, fig["y"] + fig["height"] / 2
            tx, ty = board["x"] + board["width"] * 0.72, board["y"] + board["height"] * 0.58
            lina.mouse.move(sx, sy)
            lina.mouse.down()
            lina.mouse.move(tx, ty, steps=14)
            lina.mouse.up()
            check("Lina glisse son personnage (écran principal à 2 % près)", wait_figure_at(tv, "Lina", 0.72, 0.58))

            # 4. Théo touche un endroit libre du plateau : son personnage y va.
            _, _, theo = phones[1]
            tb = theo.locator(".plateau").first.bounding_box()
            theo.mouse.click(tb["x"] + tb["width"] * 0.25, tb["y"] + tb["height"] * 0.45)
            check("Théo tape le plateau : son personnage s'y déplace", wait_figure_at(tv, "Théo", 0.25, 0.45))

            # 5. Sam avance aux flèches du clavier.
            _, _, sam = phones[2]
            sam_own = sam.locator(".plateau-figure.is-own")
            sam_own.focus()
            start = figures(tv)["Sam"]
            for _ in range(5):
                sam.keyboard.press("ArrowRight")
            sam.keyboard.press("ArrowDown")
            sam.keyboard.up("ArrowDown")
            target = (min(start[0] + 0.2, 0.94), min(start[1] + 0.04, 0.86))
            check(
                "Sam avance aux flèches du clavier",
                wait_figure_at(tv, "Sam", target[0], target[1]),
                f"attendu {target}, vu {figures(tv).get('Sam')}",
            )

            # 6. Une émotion envoyée par Lina apparaît en bulle sur l'écran principal.
            lina.get_by_role("button", name=re.compile("Joie", re.I)).click()
            bubble = False
            for _ in range(20):
                if tv.locator(".plateau-bubble").count() > 0:
                    bubble = True
                    break
                tv.wait_for_timeout(200)
            check("l'émotion de Lina s'affiche en bulle sur l'écran principal", bubble)

            # 7. Captures et contrôles de mise en page.
            tv.wait_for_timeout(600)
            tv.screenshot(path=os.path.join(SHOTS, "tv-plateau.png"))
            lina.screenshot(path=os.path.join(SHOTS, "telephone-plateau.png"))
            over_tv = overflow(tv)
            over_phone = overflow(lina)
            check("pas de défilement horizontal (écran principal)", over_tv <= 1, f"{over_tv} px")
            check("pas de défilement horizontal (téléphone)", over_phone <= 1, f"{over_phone} px")

            check("aucune erreur sur l'écran principal", not tv_errors, tv_errors[0] if tv_errors else "")
            check("aucune erreur sur les téléphones", not phone_errors, phone_errors[0] if phone_errors else "")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"plateau de test : {exc}")
            print(f"KO  plateau de test : {exc}")
        finally:
            for _, ctx, _ in phones:
                ctx.close()
            tv_ctx.close()
            browser.close()

    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f" - {f}")
        return 1
    print("\nTout est vert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
