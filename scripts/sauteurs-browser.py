#!/usr/bin/env python3
"""Test navigateur de la « Course des sauteurs » : écran principal en canvas, deux manettes de téléphone.

Dans de vrais navigateurs (écran principal 1920 × 1080, deux téléphones 844 × 390 en paysage, tactile) :
- une salle `sauteurs` s'ouvre ; deux téléphones y entrent ; le niveau est réglé sur 1 depuis le salon ;
- la télé affiche le canvas plein écran (1920 × 1080) et le compte à rebours ; le chronomètre du moteur ne démarre
  qu'au « GO » ;
- les manettes ont trois boutons nommés (≥ 64 px), aucun défilement ;
- tenir ▶ et SAUT en même temps (deux doigts, événements pointeur tactiles) fait avancer ET sauter le coureur ;
  l'autre coureur reste en place ; au relâchement le coureur s'arrête ;
- le repli clavier (flèches + espace) commande le premier joueur sur la télé ;
- la boucle tient ses 60 images par seconde ;
- aucune erreur JavaScript ni console ;
- avec FULL=1 : la course va jusqu'au temps écoulé, l'hôte envoie `level-result` (accepté par le serveur), puis le
  bilan et le podium s'affichent ;
- des captures sont écrites dans SHOTS.

Les attentes portent sur l'état exposé (attributs data-* du conteneur du canvas : tick, joueurs, x, anim), jamais
sur une durée fixe.

Usage : BASE_URL=http://127.0.0.1:8294 SHOTS=/chemin/captures python scripts/sauteurs-browser.py
Options : CHROMIUM_PATH=/chemin/vers/chrome ; FULL=1 pour aller jusqu'au bilan et au podium.
"""
import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8294").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS = os.environ.get("SHOTS", "shots")
FULL = os.environ.get("FULL") == "1"
LEVEL = os.environ.get("LEVEL", "1")
TOUR = int(os.environ.get("TOUR", "0"))

failures: list[str] = []
errors: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    if not ok:
        failures.append(f"{label}{(' : ' + detail) if detail else ''}")
    print(f"{'OK ' if ok else 'KO '} {label}{(' — ' + detail) if detail and not ok else ''}")


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def watch(page, name: str) -> None:
    page.on("pageerror", lambda exc: errors.append(f"{name} exception : {exc}"))
    page.on("console", lambda m: errors.append(f"{name} console : {m.text}") if m.type == "error" else None)


def attendre(condition, timeout: float = 8.0, pas: float = 0.05):
    fin = time.monotonic() + timeout
    while True:
        try:
            valeur = condition()
        except Exception:  # noqa: BLE001 - le DOM peut être en cours de rendu
            valeur = None
        if valeur:
            return valeur
        if time.monotonic() >= fin:
            return None
        time.sleep(pas)


def shot(page, nom: str) -> None:
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, nom))


RACE = '[data-testid="sauteurs-race"]'


def etat_tv(tv) -> dict | None:
    """Attributs data-* du conteneur du canvas : tick, fps, joueurs."""
    return tv.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return { tick: +el.dataset.tick, fps: +el.dataset.fps, over: el.dataset.over === 'true',
                   send: el.dataset.send, workMs: +el.dataset.workMs, scale: +el.dataset.scale, players: JSON.parse(el.dataset.players || '[]') };
        }""",
        RACE,
    )


def joueur(tv, nom: str) -> dict | None:
    e = etat_tv(tv)
    return next((p for p in e["players"] if p["name"] == nom), None) if e else None


def rejoindre(browser, code: str, nom: str):
    ctx = browser.new_context(viewport={"width": 844, "height": 390}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    watch(page, f"tel-{nom}")
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    page.get_by_label(re.compile("votre nom", re.I)).first.fill(nom)
    page.get_by_role("button", name=re.compile("continuer", re.I)).first.click()
    page.get_by_role("button", name=re.compile("entrer dans la salle", re.I)).first.click()
    return ctx, page


class Doigts:
    """Doigts virtuels (CDP) : plusieurs contacts à la fois sur un même téléphone."""

    def __init__(self, ctx, page) -> None:
        self.cdp = ctx.new_cdp_session(page)
        self.points: dict[int, tuple[float, float]] = {}

    def _envoyer(self, type_: str) -> None:
        pts = [{"x": x, "y": y, "id": i} for i, (x, y) in self.points.items()]
        self.cdp.send("Input.dispatchTouchEvent", {"type": type_, "touchPoints": pts})

    def poser(self, ident: int, centre: tuple[float, float]) -> None:
        self.points[ident] = centre
        self._envoyer("touchStart")

    def lever(self, ident: int) -> None:
        pts = [{"x": x, "y": y, "id": i} for i, (x, y) in self.points.items()]
        del self.points[ident]
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [p for p in pts if p["id"] != ident]})

    def tout_lever(self) -> None:
        for ident in list(self.points):
            self.lever(ident)


def centre(page, label: str) -> tuple[float, float]:
    box = page.get_by_role("button", name=label).first.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROMIUM_PATH, args=["--autoplay-policy=no-user-gesture-required"])
        room = post_json("/api/rooms", {"gameId": "sauteurs", "practice": False})
        code, token = room["code"], room["hostToken"]
        print(f"salle {code}")
        tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        tv = tv_ctx.new_page()
        watch(tv, "tv")
        ctxs = [tv_ctx]
        try:
            tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
            tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
            tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)

            ctx_a, ana = rejoindre(browser, code, "Ana")
            ctxs.append(ctx_a)
            ctx_b, bob = rejoindre(browser, code, "Bob")
            ctxs.append(ctx_b)
            for page in (ana, bob):
                prêt = page.get_by_role("button", name=re.compile("Je suis prêt", re.I)).first
                if attendre(lambda p=prêt: p.is_visible(), 15):
                    prêt.click()

            # Réglages du salon : un seul niveau (sauf FULL, qui joue tout de même un niveau complet).
            tv.get_by_role("button", name="Menu").first.click()
            champ = tv.locator('input[type="number"]').first
            check("le salon propose le réglage du nombre de niveaux", bool(attendre(lambda: champ.is_visible(), 15)))
            champ.fill("1")
            champ.press("Enter")
            champ.blur()
            if LEVEL != "1":
                niveau = tv.locator('input[type="number"]').nth(1)
                niveau.fill(LEVEL)
                niveau.press("Enter")
                niveau.blur()
            time.sleep(0.4)
            tv.get_by_role("button", name="Fermer le menu").first.click()

            start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
            start.wait_for(timeout=15000)
            attendre(lambda: start.is_enabled(), 15)
            start.click()

            # --- Compte à rebours -------------------------------------------------------------------
            tv.locator(RACE).wait_for(timeout=20000)
            canvas = tv.locator(f"{RACE} canvas")
            dims = tv.evaluate("(s) => { const c = document.querySelector(s); return [c.width, c.height]; }", f"{RACE} canvas")
            check("le canvas de la télé fait 1920 × 1080", dims == [1920, 1080], str(dims))
            e0 = etat_tv(tv)
            check("avant le GO le moteur est à l'arrêt (tick 0)", e0 is not None and e0["tick"] == 0, str(e0 and e0["tick"]))
            check("les deux coureurs sont dans le monde", e0 is not None and sorted(p["name"] for p in e0["players"]) == ["Ana", "Bob"])
            time.sleep(1.2)
            shot(tv, "tele-decompte.png")
            shot(ana, "telephone-decompte.png")

            # --- Manette --------------------------------------------------------------------------
            for page, nom in ((ana, "Ana"), (bob, "Bob")):
                labels = ["Courir à gauche", "Courir à droite", "Sauter"]
                for label in labels:
                    loc = page.get_by_role("button", name=re.compile(label))
                    ok = bool(attendre(lambda l=loc: l.count() == 1 and l.first.is_visible(), 10))
                    check(f"{nom} : bouton « {label} » présent", ok)
                    if ok:
                        box = loc.first.bounding_box()
                        check(f"{nom} : « {label} » ≥ 64 px", box["width"] >= 64 and box["height"] >= 64, f"{box['width']:.0f}×{box['height']:.0f}")
                debord = page.evaluate(
                    "() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]"
                )
                check(f"{nom} : aucun défilement", debord[0] <= 1 and debord[1] <= 1, str(debord))
                ta = page.evaluate("() => getComputedStyle(document.querySelector('.sau-pad')).touchAction")
                check(f"{nom} : touch-action none", ta == "none", ta)

            # --- Départ ---------------------------------------------------------------------------
            started = attendre(lambda: (etat_tv(tv) or {}).get("tick", 0) > 5, 12)
            check("le GO lance le moteur (tick > 5)", bool(started))
            shot(ana, "telephone-course.png")
            sprite = ana.evaluate(
                """() => { const c = document.querySelector('.sau-pad-runner canvas'); if (!c) return null;
                  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
                  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
                  const r = c.getBoundingClientRect(); return { n, w: r.width, h: r.height, x: r.x, y: r.y }; }"""
            )
            check("la manette affiche le sprite du joueur (pixels dessinés)", bool(sprite and sprite["n"] > 100), str(sprite))

            a0 = joueur(tv, "Ana")
            b0 = joueur(tv, "Bob")
            doigts = Doigts(ctx_a, ana)
            droite = centre(ana, "Courir à droite")
            saut = centre(ana, "Sauter")
            sols = [a0["y"]]
            # Tenir ▶ et SAUT en même temps.
            doigts.poser(1, droite)
            doigts.poser(2, saut)
            ys: list[float] = []
            anims: set[str] = set()
            t_fin = time.monotonic() + 2.4
            while time.monotonic() < t_fin:
                p = joueur(tv, "Ana")
                if p:
                    ys.append(p["y"])
                    anims.add(p["anim"])
                time.sleep(0.04)
            shot(tv, "tele-course.png")
            a1 = joueur(tv, "Ana")
            check("▶ tenu : Ana avance", a1["x"] > a0["x"] + 3, f"{a0['x']} -> {a1['x']}")
            check("SAUT tenu : Ana quitte le sol", min(ys) < sols[0] - 0.8, f"y mini {min(ys):.2f} pour un sol à {sols[0]:.2f}")
            check("l'animation passe par le saut ou la chute", bool(anims & {"jump", "fall"}), str(sorted(anims)))
            check("Ana est vue en course (animation « run »)", "run" in anims, str(sorted(anims)))
            b1 = joueur(tv, "Bob")
            check("Bob, qui ne touche rien, reste en place", abs(b1["x"] - b0["x"]) < 0.05, f"{b0['x']} -> {b1['x']}")

            # Relâchement : un échantillon de repos arrête le coureur.
            doigts.tout_lever()
            time.sleep(0.9)
            x_arret = joueur(tv, "Ana")["x"]
            time.sleep(0.5)
            x_apres = joueur(tv, "Ana")["x"]
            check("au relâchement Ana s'arrête", abs(x_apres - x_arret) < 0.02, f"{x_arret} -> {x_apres}")

            # ◀ ramène Ana en arrière.
            gauche = centre(ana, "Courir à gauche")
            doigts.poser(3, gauche)
            time.sleep(0.8)
            doigts.tout_lever()
            time.sleep(0.5)
            x_gauche = joueur(tv, "Ana")["x"]
            check("◀ tenu : Ana recule", x_gauche < x_apres - 0.5, f"{x_apres} -> {x_gauche}")

            # Bob court (sans sauter) pendant qu'on regarde l'écran.
            doigts_b = Doigts(ctx_b, bob)
            doigts_b.poser(1, centre(bob, "Courir à droite"))
            bx0 = joueur(tv, "Bob")["x"]
            time.sleep(1.5)
            shot(tv, "tele-deux-coureurs.png")
            shot(bob, "telephone-bob.png")
            check("Bob avance quand on tient ▶", joueur(tv, "Bob")["x"] > bx0 + 2)
            doigts_b.tout_lever()

            # --- Clavier (repli hôte) -------------------------------------------------------------
            kx0 = joueur(tv, "Ana")["x"]
            tv.keyboard.down("ArrowRight")
            tv.keyboard.down("Space")
            time.sleep(1.0)
            tv.keyboard.up("Space")
            tv.keyboard.up("ArrowRight")
            kx1 = joueur(tv, "Ana")["x"]
            check("repli clavier : les flèches et l'espace commandent le premier joueur", kx1 > kx0 + 2, f"{kx0} -> {kx1}")

            # --- Fluidité -------------------------------------------------------------------------
            frames = tv.evaluate(
                """() => new Promise((resolve) => {
                  let n = 0; const t0 = performance.now(); let worst = 0; let last = t0;
                  const tick = (t) => { n++; worst = Math.max(worst, t - last); last = t;
                    if (t - t0 >= 3000) resolve({ fps: n * 1000 / (t - t0), worst }); else requestAnimationFrame(tick); };
                  requestAnimationFrame(tick);
                })"""
            )
            e = etat_tv(tv)
            print(f"images par seconde (rAF mesuré sur 3 s) : {frames['fps']:.1f}, pire image : {frames['worst']:.1f} ms ; boucle : {e['fps']} i/s ; travail par image : {e['workMs']} ms")
            check("la page tient au moins 50 images par seconde", frames["fps"] >= 50, f"{frames['fps']:.1f}")

            # --- Parcours (option) : Ana court et saute un moment, captures régulières ----------------
            if TOUR:
                print(f"parcours de {TOUR} s…")
                doigts = Doigts(ctx_a, ana)
                doigts.poser(1, centre(ana, "Courir à droite"))
                debut = time.monotonic()
                n = 0
                prochaine = debut + 3
                while time.monotonic() - debut < TOUR:
                    doigts.poser(2, centre(ana, "Sauter"))
                    time.sleep(0.42)
                    doigts.lever(2)
                    time.sleep(0.25)
                    if time.monotonic() >= prochaine:
                        shot(tv, f"tele-parcours-{n:02d}.png")
                        p = joueur(tv, "Ana")
                        print(f"  parcours {n}: x={p['x']} y={p['y']} morts={p['deaths']} pièces={p['coins']}")
                        n += 1
                        prochaine += 3
                doigts.tout_lever()

            # --- Fin de niveau (option) -----------------------------------------------------------
            if FULL:
                print("attente du temps écoulé (FULL=1)…")
                ok = attendre(lambda: (etat_tv(tv) or {}).get("over"), 140)
                check("le niveau se termine (temps écoulé)", bool(ok))
                t_fin = time.monotonic()
                titre = tv.locator(".sau-title", has_text=re.compile("terminé"))
                # Le serveur n'ouvre le bilan avant sa marge de 10 s que si l'hôte a envoyé `level-result` et qu'il est accepté.
                ok = attendre(lambda: titre.count() > 0 and titre.first.is_visible(), 25)
                delai = time.monotonic() - t_fin
                check("le bilan du niveau s'affiche", bool(ok))
                check("l'hôte a envoyé level-result et le serveur l'a accepté (bilan avant la marge de 10 s)", bool(ok) and delai < 8, f"{delai:.1f} s")
                shot(tv, "tele-bilan.png")
                shot(ana, "telephone-bilan.png")
                podium = tv.get_by_text("Podium").first
                check("le podium final s'affiche", bool(attendre(lambda: podium.is_visible(), 30)))
                shot(tv, "tele-podium.png")
                shot(ana, "telephone-fin.png")

            check("aucune erreur JavaScript ni console", not errors, "; ".join(errors[:3]))
        finally:
            for c in ctxs:
                c.close()
            browser.close()
    print("\nRÉSULTAT :", "tout est bon" if not failures else f"{len(failures)} échec(s)")
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
