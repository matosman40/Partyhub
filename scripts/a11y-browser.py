#!/usr/bin/env python3
"""Audit d'accessibilité (axe-core, WCAG 2 niveaux A et AA) sur les pages principales.

Pour chaque page, axe-core est injecté dans le navigateur et lance ses règles. Les violations
« critiques » et « graves » font échouer le test ; les « modérées » et « mineures » sont listées.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/a11y-browser.py
Option : CHROMIUM_PATH=/chemin/vers/chrome pour utiliser un Chromium existant.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
AXE = Path(__file__).resolve().parent.parent / "node_modules" / "axe-core" / "axe.min.js"
BLOCKING = {"critical", "serious"}

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


def audit(page, name: str) -> None:
    page.add_script_tag(path=str(AXE))
    violations = page.evaluate(
        """async () => {
          const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
          return r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.length,
            sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')),
          }));
        }"""
    )
    blocking = [v for v in violations if v["impact"] in BLOCKING]
    print(f"\n== {name} : {len(violations)} violation(s), {len(blocking)} grave(s) ou critique(s)")
    for v in violations:
        print(f"   [{v['impact']}] {v['id']} ({v['nodes']}) : {v['help']} → {v['sample']}")
    for v in blocking:
        failures.append(f"{name} : {v['id']} ({v['impact']})")


def main() -> int:
    room = post_json("/api/rooms", {"gameId": "reflexe", "practice": False})
    code, host_token = room["code"], room["hostToken"]

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH) if CHROMIUM_PATH else p.chromium.launch()
        # bypass_csp : axe-core s’injecte comme script ; la CSP de l’application reste active en production.
        desktop = browser.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True)
        page = desktop.new_page()

        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        audit(page, "accueil")

        page.goto(f"{BASE_URL}/join", wait_until="networkidle")
        audit(page, "rejoindre une salle")

        page.goto(f"{BASE_URL}/spectate/{code}", wait_until="networkidle")
        page.wait_for_selector("text=En attente de la partie", timeout=10000)
        audit(page, "spectateur (salon)")

        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(host_token)})")
        page.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle")
        page.wait_for_selector(".stage-lobby", timeout=10000)
        audit(page, "écran TV (salon)")

        # Plateau de test : le salon devient un plateau où chacun déplace son personnage.
        plateau = post_json("/api/rooms", {"gameId": "plateau-test", "practice": False})
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.evaluate(f"() => sessionStorage.setItem('ph:host:{plateau['code']}', {json.dumps(plateau['hostToken'])})")
        page.goto(f"{BASE_URL}/tv/{plateau['code']}", wait_until="networkidle")
        page.wait_for_selector(".lobby-plateau .plateau-figures", timeout=10000)
        audit(page, "écran TV (plateau de test)")

        page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
        audit(page, "administration (connexion)")

        # Administration connectée : formulaires des jeux, médiathèque, sauvegarde, salles.
        password = os.environ.get("ADMIN_PASSWORD", "ci-admin-password-test")
        login = urllib.request.Request(
            f"{BASE_URL}/api/admin/login",
            data=json.dumps({"password": password}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(login, timeout=15) as res:
            raw = res.headers.get("Set-Cookie", "").split(";")[0]
        name, _, value = raw.partition("=")
        desktop.add_cookies([{"name": name, "value": value, "url": BASE_URL}])
        page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
        page.wait_for_selector("text=Salles ouvertes", timeout=10000)
        audit(page, "administration (connectée)")

        # Magasin de jeux : la page reste auditée même sans accès à GitHub (message d’erreur, filtres, liste vide).
        page.goto(f"{BASE_URL}/admin?section=creation", wait_until="networkidle")
        page.wait_for_selector("h2:has-text('Magasin de jeux')", timeout=10000)
        audit(page, "administration (magasin)")

        phone = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True)
        mobile = phone.new_page()
        mobile.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle")
        audit(mobile, "téléphone (rejoindre)")

        # Téléphone dans le plateau de test : son personnage est déplaçable (bouton, flèches).
        on_plateau = phone.new_page()
        on_plateau.goto(f"{BASE_URL}/j/{plateau['code']}", wait_until="networkidle")
        on_plateau.get_by_label("Votre nom", exact=False).first.fill("Audit")
        on_plateau.get_by_role("button", name="Continuer").click()
        on_plateau.get_by_role("button", name=re.compile("entrer dans la salle", re.I)).first.click()
        on_plateau.wait_for_selector(".lobby-plateau .plateau-figures", timeout=10000)
        audit(on_plateau, "téléphone (plateau de test)")

        browser.close()

    if failures:
        print(f"\n{len(failures)} violation(s) grave(s) ou critique(s) :")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("\nAucune violation grave ou critique.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
