#!/usr/bin/env python3
"""Test navigateur du jeu « Essai des appareils » : une partie complète à deux téléphones.

Le téléphone A crée la salle sans écran (il est l'hôte) ; le téléphone B la rejoint. Les quatre essais
sont joués sur les deux téléphones, avec un micro et une caméra factices (Chromium) :
- micro : A démarre le micro (le niveau s'affiche) ; les deux déclarent leur résultat ;
- caméra : démarrée, l'image arrive, A confirme qu'il se voit ;
- mouvement : Chromium de bureau n'a pas de capteur ; le téléphone doit le dire, sans bloquer la partie ;
- dessin : un trait tracé à la souris valide l'essai de A.
Le tableau de l'hôte doit alors montrer les résultats déclarés. Aucune erreur JavaScript ni console.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/essai-appareils-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chromium pour utiliser un Chromium existant.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
PHONE = {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}

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
    field = page.get_by_label("Votre nom")
    if field.count() and field.is_visible():
        field.fill(name)
        page.get_by_role("button", name="Continuer").click()
        page.wait_for_load_state("networkidle")


def main() -> int:
    with sync_playwright() as p:
        args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
        browser = p.chromium.launch(args=args, executable_path=CHROMIUM_PATH) if CHROMIUM_PATH else p.chromium.launch(args=args)

        def new_phone(nom: str):
            ctx = browser.new_context(**PHONE, permissions=["microphone", "camera"])
            page = ctx.new_page()
            errors: list[str] = []
            watch(page, errors)
            return page, errors, nom

        # Téléphone A : crée la salle sans écran, il organise la partie.
        a, errors_a, _ = new_phone("Alice")
        a.goto(f"{BASE_URL}/jeux/essai-appareils", wait_until="networkidle")
        ensure_profile(a, "Alice")
        a.goto(f"{BASE_URL}/jeux/essai-appareils", wait_until="networkidle")
        a.get_by_role("button", name="Créer sans écran").click()
        a.wait_for_url(re.compile(r"/j/\d{4,6}$"), timeout=15000)
        code = re.search(r"/j/(\d{4,6})", a.url).group(1)
        check(True, f"A : salle créée sans écran ({code})")
        # L'hôte prend sa place de joueur : il joue aussi les essais sur son téléphone.
        a.get_by_role("button", name="Entrer dans la salle").click()
        a.wait_for_timeout(800)

        # Téléphone B : rejoint avec le code.
        b, errors_b, _ = new_phone("Bob")
        b.goto(f"{BASE_URL}/join", wait_until="networkidle")
        ensure_profile(b, "Bob")
        b.goto(f"{BASE_URL}/join", wait_until="networkidle")
        b.locator("input.code-input").fill(code)
        b.get_by_role("button", name="Continuer").click()
        b.wait_for_url(re.compile(rf"/j/{code}$"), timeout=15000)
        check(True, "B : a rejoint la salle")
        b.get_by_role("button", name="Entrer dans la salle").click()
        b.wait_for_timeout(800)

        # L'hôte lance la partie depuis son téléphone.
        a.get_by_role("button", name="Lancer la partie").click()
        expect(a.get_by_role("button", name="Démarrer le micro")).to_be_visible(timeout=15000)
        expect(b.get_by_role("button", name="Démarrer le micro")).to_be_visible(timeout=15000)
        check(True, "les deux téléphones sont à l’essai du micro")

        # 1. Micro : A démarre le micro (le niveau s'affiche), B n'entend rien.
        a.get_by_role("button", name="Démarrer le micro").click()
        expect(a.get_by_text(re.compile("Maintenez le son"))).to_be_visible(timeout=15000)
        check(True, "A : le micro démarre et le niveau s’affiche")
        a.get_by_role("button", name="Je n’entends rien").click()
        b.get_by_role("button", name="Démarrer le micro").click()
        expect(b.get_by_text(re.compile("Maintenez le son"))).to_be_visible(timeout=15000)
        b.get_by_role("button", name="Je n’entends rien").click()
        expect(a.get_by_role("button", name="Étape suivante")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Étape suivante").click()

        # 2. Caméra : l'image factice arrive ; A confirme qu'il se voit, B ne se voit pas.
        expect(a.get_by_role("button", name="Démarrer la caméra")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Démarrer la caméra").click()
        b.get_by_role("button", name="Démarrer la caméra").click()
        expect(a.get_by_text(re.compile("Vidéo fluide|Vidéo saccadée"))).to_be_visible(timeout=20000)
        check(a.get_by_text(re.compile("Vidéo fluide")).count() == 1, "A : la vidéo est fluide (images mesurées)")
        check(True, "A : l’image de la caméra arrive")
        a.get_by_role("button", name="Enregistrer 2 s pour vérifier la vidéo").click()
        expect(a.get_by_text("Votre enregistrement se relit")).to_be_visible(timeout=20000)
        expect(a.get_by_role("button", name="Je me vois")).to_be_enabled(timeout=5000)
        check(True, "A : l’enregistrement de 2 s se relit")
        a.get_by_role("button", name="Je me vois").click()
        b.get_by_role("button", name="Je ne me vois pas").click()
        expect(a.get_by_role("button", name="Étape suivante")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Étape suivante").click()

        # 3. Mouvement : Chromium de bureau n'a pas de capteur. Le téléphone le dit, sans bloquer la partie.
        a.get_by_role("button", name="Démarrer le mouvement").click()
        b.get_by_role("button", name="Démarrer le mouvement").click()
        for page in (a, b):
            expect(
                page.get_by_role("button", name="Ce n’est pas possible sur mon téléphone")
                .or_(page.get_by_text(re.compile("Penchez le téléphone")))
                .first
            ).to_be_visible(timeout=15000)
        check(True, "mouvement : chaque téléphone affiche son état sans bloquer")
        for page in (a, b):
            button = page.get_by_role("button", name="Ce n’est pas possible sur mon téléphone")
            if button.count():
                button.click()
        expect(a.get_by_role("button", name="Étape suivante")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Étape suivante").click()

        # 4. Dessin : A trace un trait à la souris et valide ; B renonce.
        canvas = a.get_by_label("Zone de dessin")
        expect(canvas).to_be_visible(timeout=15000)
        box = canvas.bounding_box()
        a.mouse.move(box["x"] + 30, box["y"] + 30)
        a.mouse.down()
        for i in range(1, 11):
            a.mouse.move(box["x"] + 30 + i * 20, box["y"] + 30 + i * 8)
        a.mouse.up()
        expect(a.get_by_role("button", name="Le dessin marche")).to_be_enabled(timeout=5000)
        check(True, "A : le trait est tracé, l’essai peut être validé")
        a.get_by_role("button", name="Le dessin marche").click()
        b.get_by_role("button", name="Je n’arrive pas à dessiner").click()

        # 5. Touches : chaque téléphone touche la cible cinq fois ; le retour est mesuré sur place.
        expect(a.get_by_role("button", name="Étape suivante")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Étape suivante").click()
        for page in (a, b):
            expect(page.get_by_text(re.compile("Touche 1 sur 5"))).to_be_visible(timeout=15000)
            for _ in range(5):
                page.locator(".essai-cible").click()
            expect(page.get_by_text("Mesure terminée.")).to_be_visible(timeout=15000)
        check(True, "touches : les cinq touches de chaque téléphone sont mesurées")

        # Bilan : l'hôte voit le tableau avec les résultats déclarés.
        expect(a.get_by_role("button", name="Étape suivante")).to_be_visible(timeout=15000)
        a.get_by_role("button", name="Étape suivante").click()
        expect(a.get_by_text("Bilan des essais")).to_be_visible(timeout=15000)
        table = a.locator("table.essai-tableau")
        check(table.count() == 1, "A : le tableau des résultats est affiché")
        # Sur téléphone, le tableau est compact : seules les pastilles ✔ / ✘ restent, avec leur libellé accessible.
        check(table.locator(".essai-chip.is-ok").count() >= 2, "A : les essais réussis sont marqués ✔")
        check(table.locator(".essai-chip.is-ko").count() >= 1, "A : les essais en échec sont marqués ✘")
        b.locator("table.essai-tableau").wait_for(timeout=15000)
        check(
            b.locator("table.essai-tableau .essai-chip.is-ok").count() >= 1,
            "B : le bilan (tableau de la salle) est visible sur son téléphone",
        )

        for name, page, errors in (("A", a, errors_a), ("B", b, errors_b)):
            check(not errors, f"{name} : aucune erreur JavaScript ni console" + (f" ({errors[:2]})" if errors else ""))
            check(overflow(page) <= 0, f"{name} : pas de défilement horizontal")

        browser.close()

    if failures:
        print(f"\n{len(failures)} échec(s).")
        return 1
    print("\nTous les contrôles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
