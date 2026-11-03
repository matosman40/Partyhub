#!/usr/bin/env python3
"""Convertit des images PNG ou JPEG en WebP après un recadrage centré façon cover.

Usage :
  python scripts/images-webp.py source.png destination.webp [--taille 1280x720] [--qualite 0.82]
  python scripts/images-webp.py source1.png destination1.webp source2.jpg destination2.webp
Variable facultative : CHROMIUM_PATH (navigateur Chromium à utiliser).
"""
import argparse
import base64
import os
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fichiers", nargs="+", help="paires source et destination WebP")
    parser.add_argument("--taille", default="1280x720", help="taille de sortie, par exemple 1280x720")
    parser.add_argument("--qualite", type=float, default=0.82, help="qualité WebP entre 0 et 1")
    args = parser.parse_args()
    if len(args.fichiers) % 2:
        parser.error("fournir un nombre pair de chemins (source, destination)")
    match = re.fullmatch(r"(\d+)x(\d+)", args.taille)
    if not match:
        parser.error("--taille doit être au format largeurxhauteur")
    width, height = map(int, match.groups())
    if width < 1 or height < 1 or not 0 <= args.qualite <= 1:
        parser.error("dimensions positives et qualité entre 0 et 1 requises")

    pairs = [(pathlib.Path(args.fichiers[i]), pathlib.Path(args.fichiers[i + 1]))
             for i in range(0, len(args.fichiers), 2)]
    with sync_playwright() as p:
        launch = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            launch["executable_path"] = CHROMIUM_PATH
        browser = p.chromium.launch(**launch)
        page = browser.new_page()
        try:
            for source, destination in pairs:
                if source.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
                    raise ValueError(f"format source non pris en charge : {source}")
                page.goto(source.resolve().as_uri())
                data_url = page.evaluate("""async ({w, h, q}) => {
                  const img = document.querySelector('img');
                  await img.decode();
                  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
                  const sw = w / scale, sh = h / scale;
                  const canvas = document.createElement('canvas');
                  canvas.width = w; canvas.height = h;
                  canvas.getContext('2d').drawImage(img,
                    (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh,
                    0, 0, w, h);
                  return canvas.toDataURL('image/webp', q);
                }""", {"w": width, "h": height, "q": args.qualite})
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
                size_kb = destination.stat().st_size / 1024
                print(f"{destination} : {width}×{height}, {size_kb:.1f} Ko" +
                      (" (objectif < 150 Ko atteint)" if size_kb < 150 else " (au-dessus de 150 Ko)"))
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
