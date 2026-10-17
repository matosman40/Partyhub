#!/usr/bin/env python3
"""Parcours au clavier seul : la touche Tab atteint-elle les commandes, et chacune montre-t-elle le focus ?

Pour chaque page (accueil, salle sur l'écran principal, page de jointure du téléphone), on appuie sur Tab
plusieurs fois et on relève chaque élément reçu : son rôle, son nom et si un indicateur de focus visible
l'entoure (contour ou ombre). Ce n'est pas un lecteur d'écran : le nom accessible est une approximation.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/keyboard-check-browser.py
Code de sortie : 1 si un élément interactif reçoit le focus sans indicateur visible.
"""
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
TAB_STOPS = 45

# Élément actuellement focalisé : rôle, nom approximatif, et présence d'un indicateur visible.
FOCUS_JS = """
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const shadow = cs.boxShadow !== 'none' && cs.boxShadow !== '';
  // Les lecteurs d’écran ignorent le contenu aria-hidden : on fait pareil, sinon le nom est répété.
  const copy = el.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  const name = el.getAttribute('aria-label') || copy.textContent || el.getAttribute('title') || el.value || '';
  const label = name.trim().replace(/\\s+/g, ' ');
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    name: label.slice(0, 60),
    visible: outline || shadow,
    key: el.id ? '#' + el.id : el.tagName + ':' + label.slice(0, 30),
  };
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


def pass_name(page, name: str) -> None:
    """Les pages d’entrée demandent d’abord un pseudo : on le saisit, puis on passe à « Continuer » avec Tab."""
    field = page.get_by_label("Votre nom", exact=False)
    if not field.count():
        return
    field.first.click()
    page.keyboard.type(name)
    page.get_by_role("button", name="Continuer").first.wait_for(timeout=5000)
    page.keyboard.press("Tab")
    focused = page.evaluate(FOCUS_JS)
    if not focused or focused["name"] != "Continuer":
        print(f"     ! Tab depuis le pseudo ne mène pas à « Continuer » (trouvé : {focused and focused['name']})")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)


def walk(page, label: str) -> bool:
    """Parcourt la page avec Tab et renvoie vrai si tous les arrêts distincts ont un focus visible."""
    stops: dict[str, dict] = {}
    order: list[str] = []
    for _ in range(TAB_STOPS):
        page.keyboard.press("Tab")
        page.wait_for_timeout(60)
        item = page.evaluate(FOCUS_JS)
        if item is None:
            continue
        if item["key"] not in stops:
            stops[item["key"]] = item
            order.append(item["key"])
    missing = [stops[k] for k in order if not stops[k]["visible"]]
    print(f"  {label} : {len(order)} arrêts distincts au clavier")
    for key in order[:14]:
        s = stops[key]
        mark = "  " if s["visible"] else "!!"
        role = f" [{s['role']}]" if s["role"] else ""
        print(f"     {mark} {s['tag']}{role} « {s['name'] or '—'} »")
    if len(order) > 14:
        print(f"     … {len(order) - 14} autres arrêts")
    if missing:
        print(f"     ÉCHEC : {len(missing)} arrêt(s) sans indicateur de focus visible")
    return not missing


def main() -> int:
    room = post_json("/api/rooms", {"gameId": "quiz-party", "practice": True})
    code, token = room["code"], room["hostToken"]
    ok = True
    print(f"Parcours au clavier, salle {code}")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        try:
            print("Accueil (catalogue)")
            page.goto(BASE_URL + "/", wait_until="networkidle", timeout=20000)
            pass_name(page, "Clavier")
            ok &= walk(page, "accueil (catalogue, après le pseudo)")

            print("Page de jointure (téléphone, mêmes touches)")
            phone = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            pp = phone.new_page()
            pp.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
            pass_name(pp, "Clavier")
            ok &= walk(pp, "jointure (après le pseudo)")
            phone.close()

            print("Écran principal (salle, hôte connecté)")
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            page.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
            page.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
            page.get_by_role("button", name=re.compile("Lancer la partie")).first.wait_for(timeout=15000)
            ok &= walk(page, "salle")
        finally:
            browser.close()

    print("Clavier : tous les arrêts montrent le focus." if ok else "Clavier : des arrêts n’ont pas de focus visible.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
