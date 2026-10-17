#!/usr/bin/env python3
"""Test navigateur du mode test : curseur de cadence dans l'administration, bandeau sur l'écran et le téléphone, extinction.

Usage : BASE_URL=http://127.0.0.1:8282 ADMIN_PASSWORD=… python3 scripts/test-mode-browser.py
Le serveur doit tourner avec BUILTIN_GAMES=on (le jeu « quiz-party » sert à ouvrir la salle).
"""
import json
import os
import re
import urllib.request
import tempfile
import uuid

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
SHOTS = os.environ.get("SHOTS_DIR") or tempfile.mkdtemp(prefix="test-mode-shots-")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "ci-admin-password-test")
NOTICE_X4 = "Mode test : cadence ×4 pour les émotions et les voix."


def post_json(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def get_mode():
    with urllib.request.urlopen(BASE + "/api/test-mode") as r:
        return json.loads(r.read())["mode"]


def watch(page, errors):
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)


def main() -> int:
    failures: list[str] = []
    os.makedirs(SHOTS, exist_ok=True)
    stamp = uuid.uuid4().hex[:6]
    token = post_json(
        "/api/profiles/register",
        {"username": f"mode{stamp}", "password": "motdepasse1", "displayName": "Mélo"},
    )["token"]
    room = post_json("/api/rooms", {"gameId": "quiz-party"})
    code, host_token = room["code"], room["hostToken"]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        errors: list[str] = []

        # 1. Administration : allumer le curseur sur ×4.
        admin_ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        admin_ctx.request.post(BASE + "/api/admin/login", data={"password": ADMIN_PWD})
        admin = admin_ctx.new_page()
        watch(admin, errors)
        admin.goto(BASE + "/admin?section=systeme", wait_until="networkidle", timeout=20000)
        expect(admin.get_by_role("heading", name="Mode test")).to_be_visible(timeout=15000)
        admin.get_by_label("Mode test actif").check()
        slider = admin.get_by_label(re.compile("Cadence des émotions"))
        slider.focus()
        admin.keyboard.press("Home")  # position de départ connue, quel que soit le réglage précédent
        admin.keyboard.press("ArrowRight")
        admin.keyboard.press("ArrowRight")
        expect(slider).to_have_value("2")
        admin.get_by_role("button", name="Enregistrer le mode test").click()
        expect(admin.get_by_text("Mode test actif : cadence ×4.")).to_be_visible(timeout=10000)
        mode = get_mode()
        if mode != {"enabled": True, "factor": 4}:
            failures.append(f"réglage enregistré inattendu : {mode}")
        admin.get_by_role("heading", name="Mode test").locator("xpath=..").screenshot(
            path=os.path.join(SHOTS, "mode-test-admin.png")
        )
        print(f"OK  administration : réglage {mode}")

        # 2. Écran principal : le bandeau apparaît dans le salon.
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        tv = tv_ctx.new_page()
        watch(tv, errors)
        tv.goto(BASE + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(host_token)})")
        tv.goto(f"{BASE}/tv/{code}", wait_until="networkidle", timeout=20000)
        try:
            expect(tv.get_by_text(NOTICE_X4)).to_be_visible(timeout=15000)
            tv.screenshot(path=os.path.join(SHOTS, "mode-test-tv.png"))
            print("OK  écran principal : bandeau affiché")
        except AssertionError:
            failures.append("écran principal : bandeau absent")

        # 3. Téléphone : le bandeau apparaît dans le salon, au-dessus des émotions.
        phone_ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        phone = phone_ctx.new_page()
        watch(phone, errors)
        phone.goto(BASE + "/", wait_until="domcontentloaded")
        phone.evaluate(f"() => localStorage.setItem('ph:profile', {json.dumps(token)})")
        phone.goto(f"{BASE}/j/{code}", wait_until="networkidle", timeout=20000)
        phone.get_by_role("button", name="Entrer dans la salle").click()
        try:
            expect(phone.get_by_text(NOTICE_X4)).to_be_visible(timeout=15000)
            phone.screenshot(path=os.path.join(SHOTS, "mode-test-phone.png"))
            overflow = phone.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            if overflow > 0:
                failures.append(f"téléphone : débordement horizontal de {overflow} px")
            print("OK  téléphone : bandeau affiché")
        except AssertionError:
            failures.append("téléphone : bandeau absent")

        # 4. Extinction : le bandeau disparaît et la cadence revient à la normale.
        admin.goto(BASE + "/admin?section=systeme", wait_until="networkidle", timeout=20000)
        expect(admin.get_by_role("heading", name="Mode test")).to_be_visible(timeout=15000)
        admin.get_by_label("Mode test actif").uncheck()
        admin.get_by_role("button", name="Enregistrer le mode test").click()
        expect(admin.get_by_text("Mode test éteint.")).to_be_visible(timeout=10000)
        if get_mode()["enabled"] is not False:
            failures.append("le mode test ne s'est pas éteint")
        tv.reload(wait_until="networkidle")
        expect(tv.get_by_text(NOTICE_X4)).to_have_count(0, timeout=10000)
        print("OK  extinction : bandeau retiré")

        browser.close()

    if errors:
        print("Erreurs de console relevées :")
        for e in errors[:10]:
            print("  -", e[:200])
    if failures:
        print("ÉCHECS :")
        for f in failures:
            print(" -", f)
        return 1
    print("Mode test : vérifications de bout en bout passées.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
