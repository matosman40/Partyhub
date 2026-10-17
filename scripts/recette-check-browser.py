#!/usr/bin/env python3
"""Vérifie une recette (paquet .phgame, format 3) dans un vrai navigateur, de bout en bout.

Scénario :
- l'administrateur installe le paquet d'exemple (API admin, comme depuis l'interface) ;
- une salle d'entraînement démarre, les robots jouent ;
- l'écran principal affiche la consigne et le minuteur, le téléphone affiche la saisie ;
- le téléphone envoie un mot, puis vote pour un mot qui n'est pas le sien ;
- la révélation (résultats) apparaît sur l'écran principal ;
- sur chaque appareil : pas de défilement horizontal, cibles tactiles mesurées ;
- aucune erreur de page pendant le parcours.

Usage : BASE_URL=http://127.0.0.1:8282 ADMIN_PASSWORD=… python3 scripts/recette-check-browser.py [chemin.phgame]
Code de sortie : 1 si un point du scénario échoue.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ci-admin-password-test")
ROOT = Path(__file__).resolve().parent.parent
PACKAGE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "examples" / "exemple-recette.phgame"
GAME_ID = "pkgr-exemple-recette"
MIN_TARGET = 44

MEASURE_JS = """
() => {
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;
  const sel = 'button, a[href], input, select, textarea, [role=button]';
  let small = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[aria-hidden="true"]') || el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 44 || r.height < 44) small++;
  }
  return { overflow, small };
}
"""


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def admin_cookie() -> str:
    req = urllib.request.Request(
        f"{BASE_URL}/api/admin/login",
        data=json.dumps({"password": ADMIN_PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.headers.get("Set-Cookie", "").split(";")[0]


def install_package(cookie: str) -> dict:
    """Installe le paquet par l'API d'administration. Une réinstallation identique est acceptée."""
    req = urllib.request.Request(
        f"{BASE_URL}/api/admin/packages",
        data=PACKAGE.read_bytes(),
        headers={"Content-Type": "application/octet-stream", "Cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as err:
        body = json.loads(err.read() or b"{}")
        raise RuntimeError(f"installation refusée : {body.get('error')} {body.get('issues', '')}") from err


def join_phone(page, code: str) -> None:
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    name = page.get_by_label("Votre nom", exact=False)
    if name.count():
        name.first.fill("Recette")
        page.get_by_role("button", name="Continuer").first.click()
    enter = page.get_by_role("button", name=re.compile("entrer dans la salle", re.I))
    enter.first.wait_for(timeout=15000)
    enter.first.click()
    ready = page.get_by_role("button", name=re.compile("Je suis prêt", re.I))
    ready.first.wait_for(timeout=15000)
    ready.first.click()


def main() -> int:
    failures: list[str] = []

    def check(ok: bool, label: str) -> None:
        print(f"     {'OK ' if ok else 'ÉCHEC'} {label}")
        if not ok:
            failures.append(label)

    print(f"Recette de bout en bout ({GAME_ID}), paquet {PACKAGE.name}")
    cookie = admin_cookie()
    installed = install_package(cookie)
    check(True, "paquet installé" if not installed.get("unchanged") else "paquet déjà installé (contenu identique)")

    room = post_json("/api/rooms", {"gameId": GAME_ID, "practice": True})
    code, token = room["code"], room["hostToken"]
    print(f"  salle {code}")

    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, bypass_csp=True)
        phone_ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True
        )
        tv = tv_ctx.new_page()
        phone = phone_ctx.new_page()
        for page, label in ((tv, "écran principal"), (phone, "téléphone")):
            page.on("pageerror", lambda e, label=label: errors.append(f"{label} : {e}"))
        try:
            tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
            tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
            tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
            start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
            start.wait_for(timeout=15000)

            join_phone(phone, code)
            start.wait_for(timeout=15000)
            for _ in range(60):
                if start.is_enabled():
                    break
                tv.wait_for_timeout(250)
            start.click()

            prompt_tv = tv.locator(".recipe-prompt .huge-word").first
            prompt_tv.wait_for(timeout=20000)
            check(True, f"écran principal : consigne affichée « {prompt_tv.inner_text().strip()[:40]} »")

            # Le téléphone reçoit la même consigne et une zone de saisie.
            phone_prompt = phone.locator(".recipe-prompt-text").first
            phone_prompt.wait_for(timeout=20000)
            check(
                phone_prompt.inner_text().strip() == prompt_tv.inner_text().strip(),
                "téléphone : même consigne que l’écran principal",
            )
            word = phone.locator("input#recipe-word")
            word.wait_for(timeout=15000)
            word.fill("Mot de test")
            phone.get_by_role("button", name="Envoyer", exact=True).click()
            sent = phone.locator(".recipe-sent").first
            sent.wait_for(timeout=15000)
            check("Mot envoyé" in sent.inner_text(), "téléphone : mot envoyé et confirmé")

            # Mesure de la mise en page pendant l'écriture (saisie visible, consigne lisible).
            phone.wait_for_timeout(300)
            m = phone.evaluate(MEASURE_JS)
            check(m["overflow"] <= 1, f"téléphone (écriture) : pas de défilement horizontal ({m['overflow']} px)")
            print(f"       cibles < {MIN_TARGET} px sur le téléphone : {m['small']}")

            # Les robots écrivent et le vote s'ouvre : le téléphone vote pour un mot qui n'est pas le sien.
            choices = phone.locator(".recipe-choices .btn:not([disabled])")
            choices.first.wait_for(timeout=90_000)
            choices.first.click()
            voted = phone.locator(".recipe-sent", has_text="Vote enregistré")
            voted.first.wait_for(timeout=15000)
            check(True, "téléphone : vote enregistré")

            results = tv.locator(".recipe-results li").first
            results.wait_for(timeout=120_000)
            check(True, f"écran principal : révélation « {results.inner_text().strip()[:50]} »")

            tv.wait_for_timeout(300)
            mt = tv.evaluate(MEASURE_JS)
            check(mt["overflow"] <= 1, f"écran principal (révélation) : pas de défilement horizontal ({mt['overflow']} px)")
            print(f"       cibles < {MIN_TARGET} px sur l’écran principal : {mt['small']}")
        finally:
            tv_ctx.close()
            phone_ctx.close()
            browser.close()

    check(not errors, "aucune erreur de page" + (f" ({'; '.join(errors)})" if errors else ""))
    print()
    if failures:
        print(f"Échec : {len(failures)} point(s) du scénario.")
        return 1
    print("Recette : scénario complet réussi.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
