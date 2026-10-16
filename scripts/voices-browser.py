#!/usr/bin/env python3
"""Test navigateur des voix de profil, de bout en bout.

1. Le joueur enregistre une voix au micro (faux micro du navigateur), puis en importe une depuis un fichier WAV.
2. Il entre dans une salle avec son profil, depuis un téléphone, et envoie une voix.
3. L'écran principal (TV) affiche le bandeau, télécharge le son et le joue, puis le bandeau disparaît.

Vérifie aussi : aucune erreur JavaScript, aucun défilement horizontal, et des captures d'écran
(profil, téléphone, écran principal) dans SHOTS_DIR pour contrôle visuel.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/voices-browser.py
Options : CHROMIUM_PATH (Chromium existant), SHOTS_DIR (dossier des captures).
"""
import io
import json
import math
import os
import struct
import sys
import tempfile
import urllib.request
import uuid
import wave

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS_DIR = os.environ.get("SHOTS_DIR") or tempfile.mkdtemp(prefix="voices-shots-")
os.makedirs(SHOTS_DIR, exist_ok=True)

failures: list[str] = []


def post_json(path: str, body: dict, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def wav_bytes(seconds: float = 1.0) -> bytes:
    """Un bref son (tonalité) au format WAV, 8 kHz, 16 bits, mono."""
    rate = 8000
    frames = bytearray()
    for i in range(int(rate * seconds)):
        value = int(12000 * math.sin(2 * math.pi * 440 * i / rate))
        frames += struct.pack("<h", value)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def check_profile_recording(browser, token: str) -> None:
    """Le profil enregistre une voix au micro, puis une voix importée depuis un fichier."""
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        permissions=["microphone"],
    )
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)
    try:
        page.goto(BASE_URL + "/", wait_until="domcontentloaded")
        page.evaluate(f"() => localStorage.setItem('ph:profile', {json.dumps(token)})")
        page.goto(f"{BASE_URL}/profil", wait_until="networkidle", timeout=20000)
        section = page.locator("#voices-title")
        expect(section).to_be_visible(timeout=15000)

        # 1. Enregistrement au micro (le faux micro produit un son), arrêté à la main.
        page.get_by_role("button", name="Enregistrer une voix").click()
        expect(page.get_by_text("Enregistrement…")).to_be_visible(timeout=10000)
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Arrêter").click()
        expect(page.get_by_label("Nom de la voix", exact=True)).to_be_visible(timeout=10000)
        page.get_by_label("Nom de la voix", exact=True).fill("Fanfare")
        page.screenshot(path=os.path.join(SHOTS_DIR, "profil-brouillon-telephone.png"), full_page=False)
        page.get_by_role("button", name="Enregistrer dans mon profil").click()
        expect(page.get_by_text("est enregistrée")).to_be_visible(timeout=10000)
        expect(page.get_by_label("Nom de la voix « Fanfare »")).to_be_visible(timeout=10000)

        # 2. Import d'un fichier : le nom proposé est le premier « Voix n » libre, puis on le renomme.
        wav_path = os.path.join(SHOTS_DIR, "bonjour.wav")
        with open(wav_path, "wb") as f:
            f.write(wav_bytes(1.0))
        page.locator('input[type=file][accept="audio/*"]').set_input_files(wav_path)
        expect(page.get_by_label("Nom de la voix", exact=True)).to_have_value("Voix 1", timeout=10000)
        page.get_by_label("Nom de la voix", exact=True).fill("Bonjour")
        page.get_by_role("button", name="Enregistrer dans mon profil").click()
        expect(page.get_by_label("Nom de la voix « Bonjour »")).to_be_visible(timeout=10000)

        # 3. Un fichier trop long est refusé (6 secondes).
        long_path = os.path.join(SHOTS_DIR, "long.wav")
        with open(long_path, "wb") as f:
            f.write(wav_bytes(6.0))
        page.locator('input[type=file][accept="audio/*"]').set_input_files(long_path)
        expect(page.get_by_text("5 secondes maximum")).to_be_visible(timeout=10000)
        # Refusé : aucun brouillon ne reste, la liste ne change pas.
        expect(page.get_by_label("Nom de la voix « Bonjour »")).to_be_visible()

        page.locator("#voices-title").scroll_into_view_if_needed()
        page.screenshot(path=os.path.join(SHOTS_DIR, "profil-voix-telephone.png"), full_page=True)
        if errors:
            failures.append("profil : " + " | ".join(errors[:3]))
        if overflow(page) > 0:
            failures.append(f"profil téléphone : débordement horizontal de {overflow(page)} px")
        print(f"OK  profil : enregistrement, import et refus d'un fichier trop long (débordement {overflow(page)} px)")
    except Exception as exc:  # noqa: BLE001 - un échec est rapporté, pas interrompu
        failures.append(f"profil : {exc}")
        print(f"ERR profil : {exc}")
    finally:
        context.close()


def check_send_and_play(browser, token: str) -> None:
    """Un téléphone avec ce profil envoie « Fanfare » ; l'écran principal la joue."""
    room = post_json("/api/rooms", {"gameId": "quiz-party"})
    code, host_token = room["code"], room["hostToken"]

    tv_context = browser.new_context(viewport={"width": 1920, "height": 1080})
    tv = tv_context.new_page()
    tv_errors: list[str] = []
    watch(tv, tv_errors)
    voice_requests: list[int] = []
    tv.on("response", lambda r: voice_requests.append(r.status) if "/api/voices/" in r.url else None)

    phone_context = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True
    )
    phone = phone_context.new_page()
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
        voices_bar = phone.get_by_label("Mes voix")
        expect(voices_bar).to_be_visible(timeout=15000)
        phone.screenshot(path=os.path.join(SHOTS_DIR, "telephone-mes-voix.png"), full_page=False)

        phone.get_by_role("button", name="Fanfare", exact=True).click()
        expect(phone.get_by_text("envoyée à l’écran")).to_be_visible(timeout=10000)

        # L'écran principal affiche le bandeau. Si le navigateur bloque le son, il propose de l'activer.
        banner = tv.locator(".voice-banner")
        expect(banner).to_be_visible(timeout=10000)
        expect(banner).to_contain_text("« Fanfare »")
        activate = banner.get_by_role("button", name="Activer le son")
        if activate.count() > 0:
            print("    (le navigateur bloque le son : le bouton « Activer le son » est proposé)")
            activate.click()
        tv.screenshot(path=os.path.join(SHOTS_DIR, "tv-voix.png"), full_page=False)
        # Le bandeau disparaît une fois la voix terminée.
        expect(banner).to_have_count(0, timeout=12000)

        # 200 (son entier) ou 206 (plage d’octets, demandée par le navigateur) : le son est servi.
        if not any(code in (200, 206) for code in voice_requests):
            failures.append(f"écran principal : son non téléchargé (statuts {voice_requests})")
        if tv_errors:
            failures.append("écran principal : " + " | ".join(tv_errors[:3]))
        if phone_errors:
            failures.append("téléphone : " + " | ".join(phone_errors[:3]))
        if overflow(phone) > 0:
            failures.append(f"téléphone : débordement horizontal de {overflow(phone)} px")
        print(f"OK  envoi depuis le téléphone, lecture sur l'écran principal (salle {code}, son {voice_requests})")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"envoi et lecture : {exc}")
        print(f"ERR envoi et lecture : {exc}")
        try:
            tv.screenshot(path=os.path.join(SHOTS_DIR, "tv-echec.png"))
        except Exception:  # noqa: BLE001
            pass
    finally:
        tv_context.close()
        phone_context.close()


def main() -> int:
    stamp = uuid.uuid4().hex[:8]
    username = f"voix{stamp}"
    reg = post_json(
        "/api/profiles/register",
        {"username": username, "password": "motdepasse1", "displayName": "Léa"},
    )
    token = reg["token"]
    print(f"Captures dans {SHOTS_DIR}")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROMIUM_PATH,
            args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        )
        try:
            check_profile_recording(browser, token)
            check_send_and_play(browser, token)
        finally:
            browser.close()
    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nToutes les vérifications des voix sont passées.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
