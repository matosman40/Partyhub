#!/usr/bin/env python3
"""Vérifie que le son sort bien sur l'écran principal (TV) et sur le téléphone, dans un vrai navigateur.

Le contexte audio est instrumenté avant le chargement des pages : on compte les sources sonores démarrées,
et un analyseur branché sur la sortie mesure le niveau réellement rendu. Personne n'écoute : la mesure
prouve que le signal existe et atteint la sortie, pas sa qualité.

Scénarios, pour un jeu en salle d'entraînement (les robots jouent) :
- écran principal : un clic sur « Lancer la partie » doit faire sonner le départ ;
- téléphone : un premier toucher, avant toute vue de jeu, doit débloquer le son ; ensuite le jeu doit
  faire sonner le téléphone pendant la partie.

Usage : BASE_URL=http://127.0.0.1:8323 python3 scripts/audio-check-browser.py [identifiant ...]
Option : PEAK_MIN (niveau minimum pour compter un son, 0.005 par défaut).
Code de sortie : 1 si un scénario ne produit pas de son.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
PEAK_MIN = float(os.environ.get("PEAK_MIN", "0.005"))
DEFAULT_GAMES = ["president"]
WAIT_AFTER_START_MS = 12000

# Exécuté avant chaque page : enregistre les contextes audio, les sources démarrées et le niveau de sortie.
PROBE_JS = """
(() => {
  const OrigAC = window.AudioContext || window.webkitAudioContext;
  const probe = { contexts: 0, starts: 0, current: null, taps: new WeakMap(), samples: [] };
  window.__phAudio = probe;
  if (!OrigAC) return;
  const origConnect = AudioNode.prototype.connect;
  function Wrapped(...args) {
    const ctx = new OrigAC(...args);
    probe.contexts += 1;
    probe.current = ctx;
    const tap = ctx.createAnalyser();
    tap.fftSize = 1024;
    origConnect.call(tap, ctx.destination);
    probe.taps.set(ctx, tap);
    return ctx;
  }
  Wrapped.prototype = OrigAC.prototype;
  window.AudioContext = Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    const tap = dest instanceof AudioDestinationNode ? probe.taps.get(this.context) : undefined;
    if (tap && tap !== this) origConnect.call(this, tap);
    return result;
  };
  const oscStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    probe.starts += 1;
    return oscStart.apply(this, a);
  };
  const bufStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    probe.starts += 1;
    return bufStart.apply(this, a);
  };
  setInterval(() => {
    const ctx = probe.current;
    const tap = ctx && probe.taps.get(ctx);
    if (!tap) return;
    const data = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    probe.samples.push([performance.now(), peak, ctx.state]);
    if (probe.samples.length > 4000) probe.samples.splice(0, 1000);
  }, 40);
})();
"""


def get_json(path: str):
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=15) as res:
        return json.loads(res.read())


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def probe(page) -> dict:
    snap = page.evaluate(
        "() => { const p = window.__phAudio; return p && { contexts: p.contexts, starts: p.starts,"
        " state: p.current ? p.current.state : null, samples: p.samples.slice(-3000) }; }"
    )
    return snap or {"contexts": 0, "starts": 0, "state": None, "samples": []}


def sound_since(page, t0: float, starts0: int) -> dict:
    snap = probe(page)
    peak = max([s[1] for s in snap["samples"] if s[0] >= t0] or [0.0])
    return {
        "contexts": snap["contexts"],
        "state": snap["state"],
        "starts": snap["starts"] - starts0,
        "peak": round(peak, 4),
        "sound": peak >= PEAK_MIN,
    }


def describe(label: str, result: dict) -> str:
    verdict = "son audible en sortie" if result["sound"] else "AUCUN SON en sortie"
    return (
        f"     {label} : {verdict} (niveau {result['peak']}, sources démarrées {result['starts']}, "
        f"contextes {result['contexts']}, état {result['state']})"
    )


def unlock_state(page) -> str | None:
    """État du contexte audio : « running » une fois le son débloqué, None s'il n'a jamais été créé."""
    return probe(page)["state"]


def join_phone(page, code: str) -> str | None:
    """Le téléphone rejoint la salle avec un nom, puis se déclare prêt.

    Renvoie l'état audio juste après le premier toucher, avant toute vue de jeu.
    """
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    name = page.get_by_label("Votre nom", exact=False)
    if name.count():
        name.first.fill("Son")
        page.get_by_role("button", name="Continuer").first.click()
    page.wait_for_timeout(300)
    unlocked = unlock_state(page)
    enter = page.get_by_role("button", name=re.compile("entrer dans la salle", re.I))
    enter.first.wait_for(timeout=15000)
    enter.first.click()
    ready = page.get_by_role("button", name=re.compile("Je suis prêt", re.I))
    ready.first.wait_for(timeout=15000)
    ready.first.click()
    return unlocked


def check_game(browser, game: dict) -> bool:
    print(f"{game['name']} ({game['id']})")
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code, token = room["code"], room["hostToken"]
    ok = True

    tv_context = browser.new_context(viewport={"width": 1920, "height": 1080}, bypass_csp=True)
    phone_context = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True
    )
    tv_context.add_init_script(PROBE_JS)
    phone_context.add_init_script(PROBE_JS)
    tv = tv_context.new_page()
    phone = phone_context.new_page()
    try:
        tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)

        unlocked = join_phone(phone, code)
        if unlocked == "running":
            print("     téléphone : son débloqué au premier toucher")
        else:
            print(f"     téléphone : son NON débloqué au premier toucher (état {unlocked})")
            ok = False

        for _ in range(60):
            if start.is_enabled():
                break
            tv.wait_for_timeout(250)
        if not start.is_enabled():
            print("     écran principal : la partie ne peut pas démarrer")
            return False

        tv_before = probe(tv)
        phone_before = probe(phone)
        t0_tv = tv.evaluate("() => performance.now()")
        t0_phone = phone.evaluate("() => performance.now()")
        start.click()
        tv.wait_for_timeout(WAIT_AFTER_START_MS)

        tv_result = sound_since(tv, t0_tv, tv_before["starts"])
        phone_result = sound_since(phone, t0_phone, phone_before["starts"])
        print(describe("écran principal (départ et tours des robots)", tv_result))
        print(describe("téléphone (pendant la partie)", phone_result))
        ok = ok and tv_result["sound"] and phone_result["sound"]
    except Exception as exc:  # noqa: BLE001 - un jeu en échec n'arrête pas les autres
        print(f"     erreur : {exc}")
        ok = False
    finally:
        tv_context.close()
        phone_context.close()
    return ok


def main() -> int:
    wanted = set(sys.argv[1:]) or set(DEFAULT_GAMES)
    catalog = get_json("/api/catalog")
    games = catalog["games"] if isinstance(catalog, dict) else catalog
    games = [g for g in games if g["id"] in wanted]
    if not games:
        print("Aucun jeu demandé dans le catalogue.")
        return 2

    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        try:
            for game in games:
                results.append(check_game(browser, game))
        finally:
            browser.close()

    failed = results.count(False)
    print(f"\n{len(results)} jeu(x) vérifié(s), {failed} sans son sur un écran ou au déblocage.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
