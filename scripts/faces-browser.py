#!/usr/bin/env python3
"""Test navigateur des émotions du salon et de la photo à la webcam.

1. Émotions : un joueur (téléphone, avec son profil) appuie sur « Chagrin », « Rire », puis sur une
   attitude (« Joie »). Le personnage de l'écran TV et celui du téléphone changent de visage pendant
   quelques secondes, puis reviennent à leur visage habituel.
2. Webcam : le profil prend une photo avec la caméra (fausse caméra du navigateur), après un compte
   à rebours de 3 secondes ; la photo est enregistrée et affichée.

Vérifie aussi : aucune erreur JavaScript, aucun défilement horizontal, et des captures dans SHOTS_DIR.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/faces-browser.py
Options : CHROMIUM_PATH, SHOTS_DIR.
"""
import json
import os
import sys
import tempfile
import urllib.request
import uuid

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS_DIR = os.environ.get("SHOTS_DIR") or tempfile.mkdtemp(prefix="faces-shots-")
os.makedirs(SHOTS_DIR, exist_ok=True)

failures: list[str] = []


def post_json(path: str, body: dict, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def get_json(path: str, token: str) -> dict:
    req = urllib.request.Request(f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def head_markup(page, name: str) -> str:
    """Dessin du personnage de ce joueur dans le salon (sans son identifiant unique, qui change)."""
    return page.evaluate(
        """(name) => {
          const li = [...document.querySelectorAll('.lobby-head')].find((el) => el.textContent.includes(name));
          const svg = li && li.querySelector('svg');
          return svg ? svg.innerHTML.replace(/id="[^"]*"/g, '').replace(/url\\(#[^)]*\\)/g, '') : '';
        }""",
        name,
    )


def check_emotes(browser, token: str, name: str) -> None:
    room = post_json("/api/rooms", {"gameId": "quiz-party"})
    code, host_token = room["code"], room["hostToken"]
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
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(host_token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        expect(tv.get_by_role("button", name="Lancer la partie").first).to_be_visible(timeout=15000)

        phone.goto(BASE_URL + "/", wait_until="domcontentloaded")
        phone.evaluate(f"() => localStorage.setItem('ph:profile', {json.dumps(token)})")
        phone.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
        phone.get_by_role("button", name="Entrer dans la salle").click()
        expect(phone.get_by_role("group", name="Visages de votre personnage")).to_be_visible(timeout=15000)
        expect(tv.locator(".lobby-head", has_text=name)).to_be_visible(timeout=10000)

        rest_tv = head_markup(tv, name)
        if not rest_tv:
            raise AssertionError("le personnage n'apparaît pas sur l'écran")

        # Visage « Chagrin » : le dessin change sur l'écran et sur le téléphone, et l'emoji s'affiche.
        phone.get_by_role("button", name="Chagrin").click()
        expect(tv.locator(".lobby-head-emote", has_text="😞")).to_be_visible(timeout=5000)
        sad_tv = head_markup(tv, name)
        if sad_tv == rest_tv:
            failures.append("émotions : le visage n'a pas changé sur l'écran (Chagrin)")
        phone_pawn = phone.locator(".lobby-head", has_text=name).locator("svg")
        expect(phone_pawn.first).to_be_visible(timeout=5000)
        tv.screenshot(path=os.path.join(SHOTS_DIR, "tv-visage-chagrin.png"))
        tv.locator(".lobby-heads").screenshot(path=os.path.join(SHOTS_DIR, "tv-tete-chagrin.png"))
        phone.screenshot(path=os.path.join(SHOTS_DIR, "telephone-visage-chagrin.png"))

        # Visage « Rire », puis attitude « Joie » : chacun se voit, et le retour au visage habituel suit.
        phone.wait_for_timeout(3200)
        phone.get_by_role("button", name="Rire").click()
        expect(tv.locator(".lobby-head-emote", has_text="😂")).to_be_visible(timeout=5000)
        laugh_tv = head_markup(tv, name)
        if laugh_tv in (rest_tv, sad_tv):
            failures.append("émotions : le visage « Rire » ne se distingue pas")
        tv.screenshot(path=os.path.join(SHOTS_DIR, "tv-visage-rire.png"))
        tv.locator(".lobby-heads").screenshot(path=os.path.join(SHOTS_DIR, "tv-tete-rire.png"))

        phone.wait_for_timeout(3200)
        phone.get_by_role("button", name="Joie").click()
        expect(tv.locator(".lobby-head-emote", has_text="🎉")).to_be_visible(timeout=5000)
        tv.screenshot(path=os.path.join(SHOTS_DIR, "tv-attitude-joie.png"))

        # Au bout de quelques secondes, l'émotion s'efface et le visage habituel revient.
        expect(tv.locator(".lobby-head-emote")).to_have_count(0, timeout=8000)
        if head_markup(tv, name) != rest_tv:
            failures.append("émotions : le visage habituel n'est pas revenu après l'émotion")

        if tv_errors:
            failures.append("émotions (écran) : " + " | ".join(tv_errors[:3]))
        if phone_errors:
            failures.append("émotions (téléphone) : " + " | ".join(phone_errors[:3]))
        if overflow(phone) > 0:
            failures.append(f"émotions (téléphone) : débordement horizontal de {overflow(phone)} px")
        print(f"OK  émotions : visages et attitudes visibles sur l'écran (salle {code}), retour au repos")
    except Exception as exc:  # noqa: BLE001 - rapporté, pas interrompu
        failures.append(f"émotions : {exc}")
        print(f"ERR émotions : {exc}")
    finally:
        tv_ctx.close()
        phone_ctx.close()


def check_webcam(browser, token: str) -> None:
    context = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, permissions=["camera"]
    )
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)
    try:
        page.goto(BASE_URL + "/", wait_until="domcontentloaded")
        page.evaluate(f"() => localStorage.setItem('ph:profile', {json.dumps(token)})")
        page.goto(f"{BASE_URL}/profil", wait_until="networkidle", timeout=20000)
        expect(page.locator("#avatar-title")).to_be_visible(timeout=15000)
        page.get_by_role("button", name="Prendre une photo avec la webcam").click()
        expect(page.get_by_label("Aperçu de la webcam")).to_be_visible(timeout=15000)
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS_DIR, "webcam-apercu.png"))
        page.get_by_role("button", name="Prendre la photo").click()
        expect(page.get_by_label("Photo dans 3")).to_be_visible(timeout=5000)
        # Le compte à rebours se termine, la photo est envoyée et la caméra s'éteint.
        expect(page.get_by_label("Aperçu de la webcam")).to_have_count(0, timeout=12000)
        expect(page.get_by_role("button", name="Prendre une photo avec la webcam")).to_be_visible(timeout=10000)
        page.screenshot(path=os.path.join(SHOTS_DIR, "webcam-profil-apres.png"), full_page=False)

        profile = get_json("/api/profiles/me", token)["profile"]
        image = profile["avatar"].get("imageUrl")
        if not image:
            failures.append("webcam : la photo n'est pas enregistrée sur le profil")
        if errors:
            failures.append("webcam : " + " | ".join(errors[:3]))
        if overflow(page) > 0:
            failures.append(f"webcam : débordement horizontal de {overflow(page)} px")
        print(f"OK  webcam : photo prise, enregistrée et affichée sur le profil ({image or 'aucune'})")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"webcam : {exc}")
        print(f"ERR webcam : {exc}")
        try:
            page.screenshot(path=os.path.join(SHOTS_DIR, "webcam-echec.png"))
        except Exception:  # noqa: BLE001
            pass
    finally:
        context.close()


def main() -> int:
    stamp = uuid.uuid4().hex[:8]
    name = "Léa"
    reg = post_json("/api/profiles/register", {"username": f"visage{stamp}", "password": "motdepasse1", "displayName": name})
    token = reg["token"]
    print(f"Captures dans {SHOTS_DIR}")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROMIUM_PATH,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--proxy-server=direct://",
                "--proxy-bypass-list=*",
            ],
        )
        try:
            check_emotes(browser, token, name)
            check_webcam(browser, token)
        finally:
            browser.close()
    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nToutes les vérifications des émotions et de la webcam sont passées.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
