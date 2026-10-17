#!/usr/bin/env python3
"""Matrice d'appareils : mise en page sans défilement horizontal, et taille des cibles tactiles.

Pour chaque profil (téléphones, tablettes, portable, écran de salon), on joue une vraie partie d'entraînement :
le téléphone rejoint la salle, l'écran principal la lance, et l'on mesure chaque page visible :
- débordement horizontal (en pixels) : la page ne doit pas défiler de côté ;
- cibles interactives plus petites que 44 × 44 px (recommandation tactile, avertissement seulement).

C'est une émulation Chromium : elle ne remplace pas un vrai téléphone ni WebKit (Safari iOS), non installé ici.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/devices-check-browser.py
Code de sortie : 1 si une page déborde horizontalement.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
GAME_ID = os.environ.get("GAME_ID", "quiz-party")
MIN_TARGET = 44

# (nom, largeur, hauteur, tactile, est un téléphone)
PROFILES = [
    ("Petit Android", 360, 640, True, True),
    ("iPhone SE", 375, 667, True, True),
    ("iPhone 14", 390, 844, True, True),
    ("Pixel 7", 412, 915, True, True),
    ("iPad portrait", 768, 1024, True, False),
    ("iPad paysage", 1024, 768, True, False),
    ("Portable", 1366, 768, False, False),
    ("TV Full HD", 1920, 1080, False, False),
]

MEASURE_JS = """
() => {
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;
  const sel = 'button, a[href], input, select, textarea, [role=button], [role=link], [role=switch], [role=checkbox]';
  const small = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[aria-hidden="true"]') || el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 44 || r.height < 44) {
      const name = (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim();
      small.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} « ${name.replace(/\\s+/g, ' ').slice(0, 28)} »`);
    }
  }
  return { overflow, small };
}
"""

results: list[tuple[str, str, int, int]] = []


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def measure(page, profile: str, label: str) -> None:
    page.wait_for_timeout(400)
    m = page.evaluate(MEASURE_JS)
    results.append((profile, label, m["overflow"], len(m["small"])))
    flag = "  ← DÉBORDEMENT" if m["overflow"] > 1 else ""
    print(f"  {label:<28} débordement {m['overflow']:>4} px, cibles < {MIN_TARGET} px : {len(m['small']):>3}{flag}")
    for item in m["small"][:3]:
        print(f"       · {item}")


def pass_name(page, name: str) -> None:
    field = page.get_by_label("Votre nom", exact=False)
    if not field.count():
        return
    field.first.fill(name)
    page.get_by_role("button", name="Continuer").first.click()
    page.wait_for_timeout(300)


def run_profile(browser, name: str, w: int, h: int, touch: bool, phone: bool) -> None:
    room = post_json("/api/rooms", {"gameId": GAME_ID, "practice": True})
    code, token = room["code"], room["hostToken"]
    print(f"{name} ({w}×{h}), salle {code}")

    tv_w, tv_h = (w, h) if not phone else (1920, 1080)
    tv_ctx = browser.new_context(viewport={"width": tv_w, "height": tv_h}, bypass_csp=True)
    if phone:
        phone_ctx = browser.new_context(
            viewport={"width": w, "height": h}, is_mobile=True, has_touch=True, bypass_csp=True
        )
    else:
        phone_ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True
        )
    tv = tv_ctx.new_page()
    pp = phone_ctx.new_page()
    try:
        tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)
        measure(tv, name, "écran principal (salle)")

        pp.goto(BASE_URL + "/", wait_until="networkidle", timeout=20000)
        pass_name(pp, "Mesure")
        if phone:
            measure(pp, name, "téléphone (accueil)")
        pp.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
        pass_name(pp, "Mesure")
        enter = pp.get_by_role("button", name=re.compile("entrer dans la salle", re.I))
        enter.first.wait_for(timeout=15000)
        enter.first.click()
        ready = pp.get_by_role("button", name=re.compile("Je suis prêt", re.I))
        ready.first.wait_for(timeout=15000)
        if phone:
            measure(pp, name, "téléphone (salon)")
        ready.first.click()

        for _ in range(60):
            if start.is_enabled():
                break
            tv.wait_for_timeout(250)
        start.click()
        tv.get_by_role("button", name=re.compile("Mettre en pause")).first.wait_for(timeout=15000)
        tv.wait_for_timeout(1500)
        measure(tv, name, "écran principal (partie)")
        if phone:
            measure(pp, name, "téléphone (partie)")
    except Exception as err:  # noqa: BLE001 — le relevé continue avec le profil suivant
        print(f"  ÉCHEC inattendu : {err}")
        results.append((name, "parcours interrompu", 999, 0))
    finally:
        tv_ctx.close()
        phone_ctx.close()


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for name, w, h, touch, phone in PROFILES:
                run_profile(browser, name, w, h, touch, phone)
        finally:
            browser.close()

    overflowing = [r for r in results if r[2] > 1]
    small_total = sum(r[3] for r in results)
    print()
    print(f"Pages mesurées : {len(results)} ; débordement horizontal : {len(overflowing)} ; "
          f"cibles < {MIN_TARGET} px (total) : {small_total}")
    if overflowing:
        print("Échec : pages qui défilent de côté :")
        for profile, label, px, _ in overflowing:
            print(f"  · {profile} / {label} : {px} px")
        return 1
    print("Aucun défilement horizontal sur les profils mesurés.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
