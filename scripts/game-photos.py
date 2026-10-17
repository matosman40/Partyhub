#!/usr/bin/env python3
"""Captures des jeux : une salle d'entraînement par jeu, avec les robots seulement.

Pour chaque jeu du catalogue activé, le script ouvre l'écran TV d'une salle d'entraînement et
prend deux images : l'écran de salle (lobby.jpg), puis, si la partie peut démarrer avec les
robots, l'écran de jeu (partie.jpg). Les images vont dans packages/web/public/game-photos/<id>/,
et index.json liste les fichiers de chaque jeu : la fiche du jeu les lit.

Aucun téléphone ni joueur réel n'intervient : les images ne contiennent pas de données de joueur.
Un jeu qui échoue garde ses anciennes images. Un jeu réussi remplace les siennes.

Usage :
  BASE_URL=http://127.0.0.1:8282 python3 scripts/game-photos.py            # tous les jeux
  BASE_URL=http://127.0.0.1:8282 python3 scripts/game-photos.py quiz-party  # un ou plusieurs jeux
Variables facultatives : CHROMIUM_PATH (navigateur à utiliser), OUT_DIR (dossier de sortie).
"""
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = pathlib.Path(os.environ.get("OUT_DIR") or ROOT / "packages" / "web" / "public" / "game-photos")
VIEWPORT = {"width": 1280, "height": 720}
JPEG_QUALITY = 72
START_WAIT_MS = 10000  # le bouton « Lancer la partie » peut attendre que les robots soient prêts
PLAY_WAIT_MS = 6000  # les robots jouent quelques instants : l'écran de jeu est alors affiché

failures: list[str] = []


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


def watch(page, errors: list[str]) -> None:
    page.on("pageerror", lambda exc: errors.append(f"exception : {exc}"))
    page.on("console", lambda m: errors.append(f"console : {m.text}") if m.type == "error" else None)


def shoot(page, path: pathlib.Path) -> None:
    page.wait_for_timeout(800)  # laisse finir les transitions avant la capture
    page.screenshot(path=str(path), type="jpeg", quality=JPEG_QUALITY)


def capture_game(browser, game: dict) -> list[str]:
    """Renvoie les noms des images produites (un jeu sans image lève une exception)."""
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code, token = room["code"], room["hostToken"]
    context = browser.new_context(viewport=VIEWPORT)
    page = context.new_page()
    errors: list[str] = []
    watch(page, errors)
    staged = OUT_DIR / f".staging-{game['id']}"
    staged.mkdir(parents=True, exist_ok=True)
    produced: list[str] = []
    try:
        page.goto(BASE_URL + "/", wait_until="domcontentloaded")
        page.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        page.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        start = page.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)
        shoot(page, staged / "lobby.jpg")
        produced.append("lobby.jpg")

        for _ in range(START_WAIT_MS // 250):
            if start.is_enabled():
                break
            page.wait_for_timeout(250)
        if start.is_enabled():
            start.click()
            page.wait_for_timeout(PLAY_WAIT_MS)
            if errors:
                failures.append(f"{game['name']} : {errors[0]}")
            else:
                shoot(page, staged / "partie.jpg")
                produced.append("partie.jpg")
        elif errors:
            failures.append(f"{game['name']} : {errors[0]}")
        return produced
    finally:
        context.close()


def publish(game_id: str, produced: list[str]) -> None:
    """Remplace les images du jeu par celles de ce passage (un jeu réussi uniquement)."""
    target = OUT_DIR / game_id
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("*.jpg"):
        old.unlink()
    staged = OUT_DIR / f".staging-{game_id}"
    for name in produced:
        (staged / name).replace(target / name)
    for leftover in staged.glob("*"):
        leftover.unlink()
    staged.rmdir()


def read_index() -> dict:
    path = OUT_DIR / "index.json"
    if not path.exists():
        return {"games": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data.get("games"), dict) else {"games": {}}
    except (OSError, ValueError):
        return {"games": {}}


def write_index(games: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    body = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "games": dict(sorted(games.items())),
    }
    (OUT_DIR / "index.json").write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    wanted = set(sys.argv[1:])
    catalog = get_json("/api/catalog")["games"]
    games = [g for g in catalog if not wanted or g["id"] in wanted]
    if wanted and len(games) != len(wanted):
        unknown = sorted(wanted - {g["id"] for g in games})
        print(f"Jeux inconnus ou non proposés : {', '.join(unknown)}")
        return 2

    index = read_index()
    results: list[str] = []
    with sync_playwright() as p:
        launch = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            launch["executable_path"] = CHROMIUM_PATH
        browser = p.chromium.launch(**launch)
        for game in games:
            try:
                produced = capture_game(browser, game)
                publish(game["id"], produced)
                index["games"][game["id"]] = produced
                results.append(f"OK  {game['name']} : {', '.join(produced)}")
            except Exception as exc:  # noqa: BLE001 - un jeu en échec n'arrête pas les autres
                failures.append(f"{game['name']} : {exc}")
                results.append(f"KO  {game['name']} : {exc}")
                staged = OUT_DIR / f".staging-{game['id']}"
                for leftover in staged.glob("*") if staged.exists() else []:
                    leftover.unlink()
                if staged.exists():
                    staged.rmdir()
        browser.close()

    # Un jeu absent de ce passage garde son entrée ; un jeu sans image n'a plus d'entrée.
    index["games"] = {k: v for k, v in index["games"].items() if v}
    write_index(index["games"])
    print("\n".join(results))
    if failures:
        print("\nÉchecs :")
        for item in failures:
            print(f"- {item}")
        return 1
    print(f"\n{len(games)} jeu(x) traité(s), captures dans {OUT_DIR}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
