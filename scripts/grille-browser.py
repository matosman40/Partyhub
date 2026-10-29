#!/usr/bin/env python3
"""Test navigateur du plateau en grille (salon de test) : deux écrans, des téléphones qui jouent sur la grille.

Dans de vrais navigateurs (écran principal 1920 × 1080, téléphone 390 × 844) :
- une salle « Plateau de test » s'ouvre sur l'écran principal, et le téléphone y entre ;
- le plateau s'affiche sur les deux écrans, avec le personnage du téléphone, à la même case des deux côtés ;
- clavier (flèches) ET clic sur la croix de direction déplacent le personnage, qui reste dans la grille ;
- une plateforme ne se rejoint pas en marchant, on y monte (ou on franchit un obstacle) en sautant ;
- « Action » pousse une caisse ou un ballon ; sans rien devant, la bande de la manette le dit ;
- « Saluer » : le serveur confirme et l'écran principal voit l'attitude « salut » ;
- Entrée sur « Saluer » focalisé déclenche le salut, pas un saut ;
- un deuxième téléphone arrive : deux personnages, deux cases, sur les deux écrans ;
- paysage : toutes les commandes tiennent dans l'écran, le tiroir s'ouvre et le reste de la page est inerte ;
- aucune erreur JavaScript ni console, aucun défilement horizontal ;
- des captures sont écrites dans SHOTS.

Les attentes portent sur l'état affiché (position, attitude, message), jamais sur une durée fixe. Seul le rythme
des gestes est réglé : le clavier espace deux gestes de 150 ms et le serveur en accepte 12 par 3 s.

Usage : BASE_URL=http://127.0.0.1:8282 SHOTS=/chemin/captures python3 scripts/grille-browser.py
Options : CHROMIUM_PATH=/chemin/vers/chrome ; THEME=fete (défaut), un autre décor, ou THEME=all pour les sept.
"""
import json
import os
import re
import sys
import time
import urllib.request
from collections import deque

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
SHOTS = os.environ.get("SHOTS", "shots")
THEMES = ["fete", "arene", "banquise", "arene-ronde", "tennis", "escalade", "ile"]
THEME = os.environ.get("THEME", "fete")

DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
TOUCHE = {"up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight"}
LIBELLE = {"up": "haut", "down": "bas", "left": "gauche", "right": "droite"}

failures: list[str] = []
theme_courant = ""

JS_ETAT = """() => {
  const racine = document.querySelector('.grille-console');
  const d = racine.querySelector('.grille-decor');
  const style = getComputedStyle(d);
  const cols = style.gridTemplateColumns.split(' ').length;
  const rows = style.gridTemplateRows.split(' ').length;
  const cases = [...d.children].map((c) =>
    c.classList.contains('is-mur') ? '#' : c.classList.contains('is-plateforme') ? 'P' : '.');
  const decor = [];
  for (let y = 0; y < rows; y++) decor.push(cases.slice(y * cols, (y + 1) * cols).join(''));
  const pos = (el) => ({
    x: Math.round((parseFloat(el.style.left) / 100) * cols),
    y: Math.round((parseFloat(el.style.top) / 100) * rows),
  });
  const objets = [...racine.querySelectorAll('.grille-objet')].map((o) => ({
    nature: o.dataset.nature, porte: o.dataset.porte === 'oui', ...pos(o) }));
  const persos = [...racine.querySelectorAll('.grille-personnage')].map((p) => ({
    id: p.dataset.id, x: +p.dataset.x, y: +p.dataset.y, dir: p.dataset.dir,
    attitude: p.dataset.attitude, own: p.classList.contains('is-own') }));
  return { largeur: cols, hauteur: rows, decor, objets, persos };
}"""


def post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def check(label: str, ok: bool, detail: str = "") -> None:
    nom = f"[{theme_courant}] {label}" if theme_courant else label
    if not ok:
        failures.append(f"{nom}{(' : ' + detail) if detail else ''}")
    print(f"{'OK ' if ok else 'KO '} {nom}{(' — ' + detail) if detail and not ok else ''}")


def attendre(condition, timeout: float = 6.0, pas: float = 0.04):
    """Rappelle `condition` jusqu'à ce qu'elle rende une valeur vraie (renvoyée), ou None au bout de `timeout` s."""
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


class Rythme:
    """Espace les gestes d'un téléphone : 250 ms au moins entre deux (le clavier en ignore deux à moins de 150 ms d’intervalle, latence comprise), et pas plus de 10 par 3,2 s."""

    def __init__(self) -> None:
        self.instants: list[float] = []

    def tour(self) -> None:
        maintenant = time.monotonic()
        self.instants = [t for t in self.instants if maintenant - t < 3.2]
        attente = 0.0
        if self.instants:
            attente = max(0.0, 0.25 - (maintenant - self.instants[-1]))
            if len(self.instants) >= 10:
                attente = max(attente, 3.2 - (maintenant - self.instants[0]))
        if attente > 0:
            time.sleep(attente)
        self.instants.append(time.monotonic())


def etat(page) -> dict:
    return page.evaluate(JS_ETAT)


def moi(e: dict) -> dict | None:
    return next((p for p in e["persos"] if p["own"]), None)


def case_libre(e: dict, x: int, y: int, depuis: tuple[int, int] | None = None) -> bool:
    """Vrai si on peut marcher sur (x, y) : du sol sans obstacle ; la plateforme ne se rejoint pas depuis le sol."""
    if not (0 <= x < e["largeur"] and 0 <= y < e["hauteur"]):
        return False
    c = e["decor"][y][x]
    if c == "#":
        return False
    if c == "P" and depuis and e["decor"][depuis[1]][depuis[0]] == ".":
        return False
    if any(p["x"] == x and p["y"] == y for p in e["persos"]):
        return False
    return not any(o["x"] == x and o["y"] == y and not o["porte"] for o in e["objets"])


def cellule(page) -> tuple[int, int, str, str] | None:
    p = moi(etat(page))
    return (p["x"], p["y"], p["dir"], p["attitude"]) if p else None


def pas(rythme: Rythme, page, direction: str, via: str) -> bool:
    """Un pas (clavier ou clic sur la croix). Vrai si l'état affiché devient celui qu'on attend."""
    e = etat(page)
    a = moi(e)
    dx, dy = DELTA[direction]
    cible = (a["x"] + dx, a["y"] + dy)
    attendu = (cible if case_libre(e, *cible, depuis=(a["x"], a["y"])) else (a["x"], a["y"])) + (direction,)
    rythme.tour()
    if via == "clavier":
        page.keyboard.press(TOUCHE[direction])
    else:
        page.get_by_role("button", name=f"Aller vers {LIBELLE[direction]}", exact=True).click()
    ok = bool(attendre(lambda: (lambda c: c is not None and c[:3] == attendu)(cellule(page))))
    if not ok:
        print(f"   pas {direction} ({via}) : attendu {attendu}, obtenu {cellule(page)}")
    return ok


def itineraire(e: dict, depart: tuple[int, int]) -> dict:
    """Parcours en largeur sur le sol libre : pour chaque case atteignable, la liste des directions depuis `depart`."""
    chemins = {depart: []}
    file = deque([depart])
    while file:
        x, y = file.popleft()
        for d, (dx, dy) in DELTA.items():
            n = (x + dx, y + dy)
            # Une plateforme se traverse à pied depuis une plateforme (et se quitte vers le sol) ; case_libre refuse
            # seulement de la rejoindre depuis le sol, comme la règle du jeu.
            if n in chemins or not case_libre(e, *n, depuis=(x, y)):
                continue
            chemins[n] = chemins[(x, y)] + [d]
            file.append(n)
    return chemins


def aller(rythme: Rythme, page, directions: list[str]) -> bool:
    return all(pas(rythme, page, d, "clavier") for d in directions)


def planifier_poussee(e: dict):
    """La caisse ou le ballon le plus proche qu'on peut pousser : (chemin jusqu'à la case de poussée, direction, objet)."""
    a = moi(e)
    chemins = itineraire(e, (a["x"], a["y"]))
    meilleur = None
    for o in e["objets"]:
        if o["porte"] or o["nature"] not in ("caisse", "ballon"):
            continue
        for d, (dx, dy) in DELTA.items():
            depart = (o["x"] - dx, o["y"] - dy)
            derriere = (o["x"] + dx, o["y"] + dy)
            if depart not in chemins or e["decor"][derriere[1]][derriere[0]] != ".":
                continue
            if not case_libre(e, *derriere, depuis=(o["x"], o["y"])):
                continue
            if meilleur is None or len(chemins[depart]) < len(meilleur[0]):
                meilleur = (chemins[depart], d, o)
    return meilleur


def planifier_saut(e: dict):
    """Un saut dont la case du milieu bloque la marche : une plateforme (de préférence), un mur ou un objet."""
    a = moi(e)
    chemins = itineraire(e, (a["x"], a["y"]))
    meilleur = None
    for (x, y), chemin in chemins.items():
        for d, (dx, dy) in DELTA.items():
            milieu = (x + dx, y + dy)
            arrivee = (x + 2 * dx, y + 2 * dy)
            if not (0 <= arrivee[0] < e["largeur"] and 0 <= arrivee[1] < e["hauteur"]):
                continue
            if case_libre(e, *milieu, depuis=(x, y)) or e["decor"][arrivee[1]][arrivee[0]] == "#":
                continue
            if not case_libre(e, *arrivee, depuis=(milieu[0], milieu[1])) and e["decor"][arrivee[1]][arrivee[0]] != "P":
                continue
            if any(p["x"] == arrivee[0] and p["y"] == arrivee[1] for p in e["persos"]):
                continue
            if any(o["x"] == arrivee[0] and o["y"] == arrivee[1] and not o["porte"] for o in e["objets"]):
                continue
            plateforme = e["decor"][milieu[1]][milieu[0]] == "P"
            cle = (0 if plateforme else 1, len(chemin))
            if meilleur is None or cle < meilleur[0]:
                meilleur = (cle, chemin, d, arrivee, plateforme)
    return meilleur


def rejoindre(browser, code: str, nom: str, erreurs: list[str]):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    watch(page, erreurs)
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    page.get_by_label(re.compile("votre nom", re.I)).first.fill(nom)
    page.get_by_role("button", name=re.compile("continuer", re.I)).first.click()
    page.get_by_role("button", name=re.compile("entrer dans la salle", re.I)).first.click()
    page.locator(".grille-console").first.wait_for(timeout=30000)
    return ctx, page


def figure_tv(tv, identifiant: str):
    """(x, y, attitude) du personnage `identifiant` sur l'écran principal, ou None."""
    loc = tv.locator(f'.grille3d-figure[data-id="{identifiant}"]').first
    if loc.count() == 0:
        return None
    return int(loc.get_attribute("data-x")), int(loc.get_attribute("data-y")), loc.get_attribute("data-attitude")


def jouer_theme(browser, theme: str) -> None:
    room = post_json("/api/rooms", {"gameId": "plateau-test", "practice": False, "theme": theme})
    code, token = room["code"], room["hostToken"]
    tv_ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    tv = tv_ctx.new_page()
    tv_errors: list[str] = []
    watch(tv, tv_errors)
    phone_errors: list[str] = []
    phone_ctx = phone = phone2_ctx = None
    try:
        tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        phone_ctx, phone = rejoindre(browser, code, "Testeur", phone_errors)
        rythme = Rythme()

        # L'écran principal : un plateau 3D (canevas WebGL) et les personnages posés dessus.
        canevas = tv.locator(".grille3d canvas").first
        canevas.wait_for(timeout=60000)
        check("l'écran principal affiche le plateau en 3D", canevas.is_visible())
        tv.locator(".grille3d-figure").first.wait_for(state="attached", timeout=60000)

        # Le téléphone : le plateau et la manette, par-dessus.
        manette = phone.locator(".grille-console").first
        check("le téléphone affiche le plateau et la manette", manette.is_visible())
        check(
            "le téléphone a la croix de direction et les trois boutons",
            phone.get_by_role("button", name=re.compile("Aller vers haut")).count() == 1
            and phone.get_by_role("button", name=re.compile("^Action$")).count() == 1,
        )
        attendre(lambda: moi(etat(phone)))
        depart = moi(etat(phone))
        check("le personnage du téléphone est posé sur la grille", depart is not None, "aucun personnage « à moi »")
        if depart is None:
            return
        mon_id = depart["id"]
        grille0 = etat(phone)
        largeur, hauteur = grille0["largeur"], grille0["hauteur"]
        check("la grille fait 21 × 15", (largeur, hauteur) == (21, 15), f"{largeur} × {hauteur}")

        vu_tv = attendre(lambda: figure_tv(tv, mon_id))
        check(
            "l'écran principal voit le personnage à la même case que le téléphone",
            vu_tv is not None and vu_tv[:2] == (depart["x"], depart["y"]),
            f"TV {vu_tv}, téléphone {(depart['x'], depart['y'])}",
        )

        # Action sans rien devant (au départ, la zone est dégagée) : la bande le dit, rien n'est envoyé.
        phone.get_by_role("button", name=re.compile("^Action$")).first.click()
        alerte = phone.locator(".grille-bande-message").first
        alerte.wait_for(timeout=5000)
        check("Action sans rien devant : la bande le dit", "Rien à faire ici" in alerte.inner_text(), alerte.inner_text())

        # Clavier : un parcours, avec attente de la nouvelle case à chaque pas.
        visites = {(depart["x"], depart["y"])}
        parcours = ["right"] * 3 + ["down"] * 3 + ["left"] * 2 + ["up"] * 2
        tous_ok = True
        for d in parcours:
            tous_ok &= pas(rythme, phone, d, "clavier")
            c = cellule(phone)
            if c:
                visites.add(c[:2])
        check("les flèches déplacent le personnage comme prévu à chaque pas", tous_ok)
        check("au moins trois cases visitées au clavier", len(visites) >= 3, f"cases : {sorted(visites)}")
        hors = [c for c in visites if not (0 <= c[0] < largeur and 0 <= c[1] < hauteur)]
        check("le personnage reste dans la grille", not hors, f"hors grille : {hors}")

        # Croix de direction : un clic dans une direction libre, puis un clic contre un obstacle (il se tourne seulement).
        e = etat(phone)
        a = moi(e)
        libre = next((d for d, (dx, dy) in DELTA.items() if case_libre(e, a["x"] + dx, a["y"] + dy, depuis=(a["x"], a["y"]))), None)
        check("un clic sur la croix déplace le personnage", libre is not None and pas(rythme, phone, libre, "croix"))
        e = etat(phone)
        a = moi(e)
        bloque = next((d for d, (dx, dy) in DELTA.items() if d != a["dir"] and e["decor"][a["y"] + dy][a["x"] + dx] == "#"), None)
        if bloque:
            avant = (a["x"], a["y"])
            ok = pas(rythme, phone, bloque, "croix")
            apres = cellule(phone)
            check("un clic contre un mur tourne le personnage sans le déplacer", ok and apres[:2] == avant and apres[2] == bloque)

        # Saut : sur une plateforme (qu'on ne rejoint pas en marchant) ou par-dessus un obstacle.
        saut = planifier_saut(etat(phone))
        check("un saut est possible sur ce plateau", saut is not None)
        if saut:
            _, chemin, d, arrivee, plateforme = saut
            check("trajet jusqu'au point de saut", aller(rythme, phone, chemin))
            check("la case devant bloque la marche, le personnage se tourne seulement", pas(rythme, phone, d, "clavier"))
            rythme.tour()
            phone.get_by_role("button", name="Sauter", exact=False).first.click()
            c = attendre(lambda: (lambda c: c if c and c[:2] == arrivee else None)(cellule(phone)))
            check(
                "sauter atterrit deux cases plus loin" + (" (sur une plateforme)" if plateforme else " (par-dessus un obstacle)"),
                c is not None and c[3] == "saut",
                f"état {cellule(phone)}, attendu {arrivee}",
            )

        # Poussée : « Action » face à une caisse ou un ballon la pousse d'une case.
        plan = planifier_poussee(etat(phone))
        check("une caisse ou un ballon est poussable", plan is not None)
        if plan:
            chemin, d, objet = plan
            # Depuis une plateforme, on redescend d'abord au sol : le plan part de la position actuelle.
            check("trajet jusqu'à l'objet à pousser", aller(rythme, phone, chemin))
            check("face à l'objet, le personnage se tourne vers lui", pas(rythme, phone, d, "clavier"))
            rythme.tour()
            phone.get_by_role("button", name=re.compile("^Action$")).first.click()
            dx, dy = DELTA[d]
            nouveau = (objet["x"] + dx, objet["y"] + dy)

            def pousse():
                s = etat(phone)
                a2 = moi(s)
                bouge = any(o["nature"] == objet["nature"] and (o["x"], o["y"]) == nouveau for o in s["objets"])
                return bouge and (a2["x"], a2["y"]) == (objet["x"], objet["y"]) and a2["attitude"] == "pousse"

            check(f"Action pousse {'la caisse' if objet['nature'] == 'caisse' else 'le ballon'} d'une case", bool(attendre(pousse)))

        # Salut au bouton : le serveur confirme, l'écran principal voit l'attitude « salut ».
        # Le bouton de la manette (et non l'émotion « Saluer » du salon, qui a le même nom).
        rythme.tour()
        phone.locator(".grille-b-saluer").click()
        salut_vu = attendre(lambda: (figure_tv(tv, mon_id) or (0, 0, ""))[2] == "salut", timeout=30)
        check("saluer : l'écran principal voit l'attitude « salut »", bool(salut_vu))

        # Entrée sur « Saluer » focalisé : le bouton garde son sens natif (salut), la manette ne saute pas.
        e = etat(phone)
        a = moi(e)
        # Un vrai pas (case libre) : un geste sans effet ne change pas l'attitude.
        libre = next((d for d, (dx, dy) in DELTA.items() if case_libre(e, a["x"] + dx, a["y"] + dy, depuis=(a["x"], a["y"]))), None)
        if libre:
            pas(rythme, phone, libre, "croix")
        avant = cellule(phone)
        check("un pas remet le personnage au repos", avant is not None and avant[3] == "repos", str(avant))
        phone.locator(".grille-b-saluer").focus()
        rythme.tour()
        phone.keyboard.press("Enter")
        attitudes: list[str] = []

        def attitude_apres_entree():
            c = cellule(phone)
            if c and c[3] != "repos":
                attitudes.append(c[3])
            return c is not None and c[3] != "repos"

        attendre(attitude_apres_entree)
        apres = cellule(phone)
        check(
            "Entrée sur « Saluer » focalisé déclenche le salut, pas un saut",
            attitudes[:1] == ["salut"] and apres is not None and avant is not None and apres[:2] == avant[:2],
            f"attitudes {attitudes}, avant {avant}, après {apres}",
        )

        # Les deux écrans s'accordent sur la case du personnage.
        c = cellule(phone)
        accord = attendre(lambda: (figure_tv(tv, mon_id) or (None,))[:2] == c[:2], timeout=10)
        check(
            "l'écran principal voit le personnage à sa nouvelle case (même case que le téléphone)",
            bool(accord),
            f"TV {figure_tv(tv, mon_id)}, téléphone {c}",
        )

        # Un deuxième joueur arrive : deux personnages, deux cases, sur les deux écrans.
        phone2_ctx, phone2 = rejoindre(browser, code, "Second", phone_errors)
        deux = attendre(lambda: len(etat(phone)["persos"]) == 2 and len(etat(phone2)["persos"]) == 2)
        check("un 2e joueur arrive : le plateau de chaque téléphone montre deux personnages", bool(deux))
        e1, e2 = etat(phone), etat(phone2)
        cases = {(p["x"], p["y"]) for p in e1["persos"]}
        check("les deux personnages sont sur deux cases distinctes", len(cases) == 2, str(cases))
        autre = moi(e2)
        check(
            "chaque téléphone se reconnaît : deux identifiants différents",
            autre is not None and autre["id"] != mon_id and sum(p["own"] for p in e1["persos"]) == 1,
        )
        tv_deux = attendre(lambda: tv.locator(".grille3d-figure").count() == 2)
        check("l'écran principal montre deux personnages", bool(tv_deux))
        check(
            "les deux écrans voient le 2e joueur à la même case",
            autre is not None and attendre(lambda: (figure_tv(tv, autre["id"]) or (None,))[:2] == (autre["x"], autre["y"])) is not None,
        )

        tv.screenshot(path=os.path.join(SHOTS, f"grille-tv-{theme}.png"))
        phone.screenshot(path=os.path.join(SHOTS, f"grille-telephone-{theme}.png"))

        # Paysage : le téléphone tourné ; toute la manette tient dans l'écran, et le tiroir s'ouvre.
        phone.set_viewport_size({"width": 844, "height": 390})
        selecteur = ".grille-croix-up, .grille-croix-down, .grille-croix-left, .grille-croix-right, .grille-b-action, .grille-b-sauter, .grille-b-saluer"

        def commandes_dans_lecran():
            boites = [c.bounding_box() for c in phone.locator(selecteur).all()]
            if len(boites) != 7:
                return None
            if any(not b or b["x"] < 0 or b["y"] < 0 or b["x"] + b["width"] > 844 or b["y"] + b["height"] > 390 for b in boites):
                return None
            return True

        check("paysage : toutes les commandes tiennent dans l'écran (7 commandes)", bool(attendre(commandes_dans_lecran)))
        phone.screenshot(path=os.path.join(SHOTS, f"grille-telephone-paysage-{theme}.png"))

        poignee = phone.locator(".grille-tiroir-poignee").first
        tiroir = phone.locator(".grille-tiroir").first
        check(
            "paysage : le tiroir est fermé au départ (inerte)",
            poignee.get_attribute("aria-expanded") == "false" and tiroir.evaluate("el => el.inert"),
        )
        identifiant = tiroir.get_attribute("id")
        check("la poignée désigne le tiroir par son identifiant", poignee.get_attribute("aria-controls") == identifiant and bool(identifiant))
        check(
            "le reste de la page est inerte pendant la manette",
            phone.evaluate("() => { const r = document.querySelector('.grille-console'); return [...document.querySelectorAll('[inert]')].some((n) => !r.contains(n) && !n.contains(r)); }"),
        )
        poignee.click()
        ouvert = attendre(
            lambda: poignee.get_attribute("aria-expanded") == "true"
            and phone.locator(".grille-console.is-ouvert").count() == 1
            and not tiroir.evaluate("el => el.inert")
            and phone.locator(".grille-tiroir .emote-bar").first.is_visible()
        )
        check("paysage : le tiroir s'ouvre et montre les réactions", bool(ouvert))
        phone.screenshot(path=os.path.join(SHOTS, f"grille-telephone-tiroir-{theme}.png"))
        poignee.click()
        check("le tiroir se referme", bool(attendre(lambda: poignee.get_attribute("aria-expanded") == "false")))

        over_tv, over_phone = overflow(tv), overflow(phone)
        check("pas de défilement horizontal (écran principal)", over_tv <= 1, f"{over_tv} px")
        check("pas de défilement horizontal (téléphone)", over_phone <= 1, f"{over_phone} px")
        check("aucune erreur JavaScript ni console (écran principal)", not tv_errors, "; ".join(tv_errors[:3]))
        check("aucune erreur JavaScript ni console (téléphones)", not phone_errors, "; ".join(phone_errors[:3]))
    except Exception as exc:  # noqa: BLE001 - le test se termine proprement et signale l'erreur
        check("le parcours s'est déroulé jusqu'au bout", False, str(exc))
        try:
            tv.screenshot(path=os.path.join(SHOTS, f"grille-erreur-tv-{theme}.png"))
            if phone:
                phone.screenshot(path=os.path.join(SHOTS, f"grille-erreur-telephone-{theme}.png"))
        except Exception:  # noqa: BLE001
            pass
    finally:
        for ctx in (phone2_ctx, phone_ctx, tv_ctx):
            if ctx:
                ctx.close()


def main() -> int:
    global theme_courant
    os.makedirs(SHOTS, exist_ok=True)
    themes = THEMES if THEME == "all" else [THEME]
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM_PATH, args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            for theme in themes:
                theme_courant = theme if len(themes) > 1 else ""
                print(f"\n== décor « {theme} »")
                jouer_theme(browser, theme)
        finally:
            browser.close()

    if failures:
        print("\nÉchecs :")
        for f in failures:
            print(f" - {f}")
        return 1
    print("\nTous les contrôles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
