#!/usr/bin/env python3
"""Exporte les icônes PartyHub en PNG et ICO depuis leurs SVG avec Chromium.

Usage :
  python scripts/icones.py
  python scripts/icones.py --planche chemin/hors-du-depot/icone-planche.png

Variable facultative : CHROMIUM_PATH (navigateur Chromium à utiliser).
"""
import argparse
import base64
import os
import pathlib
import struct
import sys
import tempfile

from playwright.sync_api import sync_playwright

RACINE = pathlib.Path(__file__).resolve().parents[1]
ICONE_DIR = RACINE / "packages" / "web" / "public" / "icons"
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None


def rendre(page, source: pathlib.Path, destination: pathlib.Path, taille: int,
           fond_plein: bool = False) -> None:
    """Rend un SVG à la taille demandée, sans dépendance de traitement d'image."""
    svg = base64.b64encode(source.read_bytes()).decode("ascii")
    page.set_viewport_size({"width": taille, "height": taille})
    page.set_content(
        "<!doctype html><html><body style='margin:0;width:100vw;height:100vh;"
        + ("background:#14122E" if fond_plein else "background:transparent")
        + "'>"
        f"<img src='data:image/svg+xml;base64,{svg}' "
        f"style='display:block;width:{taille}px;height:{taille}px'></body></html>"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(destination), omit_background=not fond_plein)


def ecrire_ico(destination: pathlib.Path,
               images: tuple[tuple[int, pathlib.Path], ...]) -> None:
    """Écrit un conteneur ICO dont chaque entrée contient une image PNG."""
    donnees = [(taille, fichier.read_bytes()) for taille, fichier in images]
    decalage = 6 + 16 * len(donnees)
    entrees = []
    for taille, png in donnees:
        entrees.append(struct.pack(
            "<BBBBHHII", taille, taille, 0, 0, 1, 32, len(png), decalage
        ))
        decalage += len(png)
    destination.write_bytes(struct.pack("<HHH", 0, 1, len(images)) +
                            b"".join(entrees) + b"".join(png for _, png in donnees))


def data_url(fichier: pathlib.Path, mime: str) -> str:
    """Convertit un fichier local en URL de données pour la planche HTML."""
    contenu = base64.b64encode(fichier.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{contenu}"


def creer_planche(page, destination: pathlib.Path) -> None:
    """Crée une planche lisible des tailles courantes et de l'icône maskable."""
    svg_16 = data_url(ICONE_DIR / "icon.svg", "image/svg+xml")
    sources = {
        16: svg_16,
        32: data_url(ICONE_DIR / "favicon-32.png", "image/png"),
        64: data_url(ICONE_DIR / "favicon-64.png", "image/png"),
        180: data_url(ICONE_DIR / "apple-touch-icon.png", "image/png"),
        512: data_url(ICONE_DIR / "icon-512.png", "image/png"),
    }
    maskable = data_url(ICONE_DIR / "icon-maskable-512.png", "image/png")
    lignes = []
    for taille, source in sources.items():
        masque = (f"<div class='rond'><img src='{maskable}' width='512' height='512'></div>"
                  if taille == 512 else "<span>—</span>")
        lignes.append(
            f"<div class='taille'>{taille} px</div>"
            f"<div class='case clair'><img src='{source}' width='{taille}' height='{taille}'></div>"
            f"<div class='case sombre'><img src='{source}' width='{taille}' height='{taille}'></div>"
            f"<div class='case masque'>{masque}</div>"
        )
    html = """<!doctype html><html lang="fr"><meta charset="utf-8">
<title>Planche de contrôle — icônes PartyHub</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#25243a;color:#fff;
font:16px system-ui,sans-serif}h1{font-size:24px;margin:0 0 18px}.grille{display:grid;
grid-template-columns:100px 570px 570px 570px;gap:8px;align-items:stretch}
header{padding:12px;font-weight:700}.taille{display:flex;align-items:center;justify-content:center;
font-weight:700}.case{min-height:92px;display:flex;align-items:center;justify-content:center;
padding:16px;overflow:hidden}.clair{background:#eceae3;color:#14122e}.sombre{background:#090817}
.masque{background:#3247e0}.case img{object-fit:contain;image-rendering:auto}.rond{width:512px;height:512px;
border-radius:50%;overflow:hidden;line-height:0;outline:2px solid #eceae3}.rond img{display:block}
</style><h1>PartyHub — contrôle des icônes</h1><div class="grille">
<header>Taille</header><header>Fond clair</header><header>Fond sombre</header><header>Masque circulaire</header>
""" + "".join(lignes) + "</div></html>"
    page.set_viewport_size({"width": 1870, "height": 1200})
    page.set_content(html)
    destination.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(destination), full_page=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planche", type=pathlib.Path,
                        help="enregistre aussi une planche de contrôle à cet emplacement")
    args = parser.parse_args()

    exports = [
        ("icon.svg", "favicon-32.png", 32),
        ("icon.svg", "favicon-64.png", 64),
        ("icon.svg", "icon-192.png", 192),
        ("icon.svg", "icon-512.png", 512),
        ("icon.svg", "apple-touch-icon.png", 180),
        ("icon-maskable.svg", "icon-maskable-512.png", 512),
    ]
    with sync_playwright() as playwright:
        options = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            options["executable_path"] = CHROMIUM_PATH
        browser = playwright.chromium.launch(**options)
        page = browser.new_page()
        try:
            for svg, png, taille in exports:
                destination = ICONE_DIR / png
                rendre(page, ICONE_DIR / svg, destination, taille,
                       fond_plein=(png == "apple-touch-icon.png"))
                print(f"{destination} : {taille}×{taille}")
            with tempfile.TemporaryDirectory(prefix="partyhub-icones-") as temporaire:
                png_16 = pathlib.Path(temporaire) / "favicon-16.png"
                rendre(page, ICONE_DIR / "icon.svg", png_16, 16)
                ecrire_ico(ICONE_DIR / "favicon.ico", (
                    (16, png_16),
                    (32, ICONE_DIR / "favicon-32.png"),
                    (64, ICONE_DIR / "favicon-64.png"),
                ))
            print(f"{ICONE_DIR / 'favicon.ico'} : images PNG 16×16, 32×32 et 64×64")
            if args.planche:
                creer_planche(page, args.planche)
                print(f"Planche : {args.planche}")
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
