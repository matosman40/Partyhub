#!/usr/bin/env python3
"""Audit d'accessibilité des vues de jeu (axe-core, WCAG 2 niveaux A et AA), pour chaque jeu du catalogue.

Pour chaque jeu, une salle d'entraînement (les robots jouent) reçoit un téléphone joueur. L'audit porte sur :
- l'écran TV du salon, puis l'écran TV à plusieurs moments de la partie ;
- le téléphone du joueur, dans le salon puis à plusieurs moments de la partie.

Les violations sont regroupées par règle et par jeu. Une violation « critique » ou « grave » fait échouer
le test ; les « modérées » et « mineures » sont listées pour suivi. Une erreur JavaScript fait échouer le test.

Usage : BASE_URL=http://127.0.0.1:8282 python3 scripts/a11y-games-browser.py [identifiant ...]
Options : CHROMIUM_PATH (navigateur à utiliser), SAMPLE_SECONDS (moments de la partie, « 2,5,9,14 » par défaut).
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8282").rstrip("/")
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or None
AXE = Path(__file__).resolve().parent.parent / "node_modules" / "axe-core" / "axe.min.js"
BLOCKING = {"critical", "serious"}
SAMPLES = [float(s) for s in os.environ.get("SAMPLE_SECONDS", "2,5,9,14").split(",") if s.strip()]
START_WAIT_MS = 12000

AXE_RUN = """async () => {
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  return {
    passes: r.passes.reduce((n, p) => n + p.nodes.length, 0),
    review: r.incomplete.map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 2).map((n) => n.target.join(' ')),
      html: v.nodes.slice(0, 1).map((n) => n.html.slice(0, 140)),
    })),
  };
}"""


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


class Report:
    """Violations d'un jeu, regroupées par règle, avec les écrans où elles apparaissent."""

    def __init__(self, game_id: str, name: str):
        self.game_id = game_id
        self.name = name
        self.rules: dict[str, dict] = {}
        self.errors: list[str] = []
        self.audits = 0
        self.checked = 0
        self.review: dict[str, list[str]] = {}

    def add(self, scope: str, result: dict) -> None:
        self.audits += 1
        self.checked += result["passes"]
        for item in result["review"]:
            targets = self.review.setdefault(item["id"], [])
            for target in item["targets"]:
                if target not in targets and len(targets) < 3:
                    targets.append(target)
        for v in result["violations"]:
            rule = self.rules.setdefault(
                v["id"],
                {"impact": v["impact"], "help": v["help"], "scopes": set(), "targets": [], "html": []},
            )
            rule["scopes"].add(scope)
            for target in v["targets"]:
                if target not in rule["targets"] and len(rule["targets"]) < 4:
                    rule["targets"].append(target)
            for html in v["html"]:
                if html not in rule["html"] and len(rule["html"]) < 2:
                    rule["html"].append(html)

    def blocking(self) -> list[str]:
        return [rule_id for rule_id, r in self.rules.items() if r["impact"] in BLOCKING]


def audit(page, report: Report, scope: str) -> None:
    page.add_script_tag(path=str(AXE))
    report.add(scope, page.evaluate(AXE_RUN))


def watch(page, report: Report) -> None:
    page.on("pageerror", lambda exc: report.errors.append(f"exception : {exc}"))
    page.on("console", lambda m: report.errors.append(f"console : {m.text}") if m.type == "error" else None)


def join_phone(page, code: str) -> None:
    """Le téléphone rejoint la salle avec un nom, puis se déclare prêt."""
    page.goto(f"{BASE_URL}/j/{code}", wait_until="networkidle", timeout=20000)
    name = page.get_by_label("Votre nom", exact=False)
    if name.count():
        name.first.fill("Audit")
        page.get_by_role("button", name="Continuer").first.click()
    enter = page.get_by_role("button", name=re.compile("entrer dans la salle", re.I))
    enter.first.wait_for(timeout=15000)
    enter.first.click()
    ready = page.get_by_role("button", name=re.compile("Je suis prêt", re.I))
    ready.first.wait_for(timeout=15000)
    ready.first.click()


def audit_game(browser, game: dict) -> Report:
    report = Report(game["id"], game["name"])
    room = post_json("/api/rooms", {"gameId": game["id"], "practice": True})
    code, token = room["code"], room["hostToken"]

    tv_context = browser.new_context(viewport={"width": 1920, "height": 1080}, bypass_csp=True)
    phone_context = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True
    )
    tv = tv_context.new_page()
    phone = phone_context.new_page()
    watch(tv, report)
    watch(phone, report)
    try:
        tv.goto(BASE_URL + "/", wait_until="domcontentloaded")
        tv.evaluate(f"() => sessionStorage.setItem('ph:host:{code}', {json.dumps(token)})")
        tv.goto(f"{BASE_URL}/tv/{code}", wait_until="networkidle", timeout=20000)
        start = tv.get_by_role("button", name=re.compile("Lancer la partie")).first
        start.wait_for(timeout=15000)
        join_phone(phone, code)
        tv.wait_for_timeout(600)
        audit(tv, report, "TV salon")
        audit(phone, report, "téléphone salon")

        for _ in range(START_WAIT_MS // 250):
            if start.is_enabled():
                break
            tv.wait_for_timeout(250)
        if not start.is_enabled():
            report.errors.append("la partie ne peut pas démarrer (bouton « Lancer la partie » inactif)")
            return report
        start.click()

        began = time.monotonic()
        for at in SAMPLES:
            wait = at - (time.monotonic() - began)
            if wait > 0:
                tv.wait_for_timeout(int(wait * 1000))
            audit(tv, report, f"TV partie {at:g} s")
            audit(phone, report, f"téléphone partie {at:g} s")
    except Exception as exc:  # noqa: BLE001 - un jeu en échec n'arrête pas les autres
        report.errors.append(f"parcours interrompu : {exc}")
    finally:
        tv_context.close()
        phone_context.close()
    return report


def print_report(report: Report) -> None:
    blocking = report.blocking()
    status = "ERR" if blocking or report.errors else "OK "
    print(
        f"{status} {report.name} : {report.audits} audit(s), {report.checked} contrôle(s) réussi(s), "
        f"{len(report.rules)} règle(s) touchée(s), {len(blocking)} grave(s) ou critique(s)"
    )
    for rule_id, r in sorted(report.rules.items(), key=lambda kv: kv[1]["impact"] not in BLOCKING):
        scopes = ", ".join(sorted(r["scopes"]))
        print(f"     [{r['impact']}] {rule_id} : {r['help']}")
        print(f"            écrans : {scopes}")
        print(f"            exemples : {' ; '.join(r['targets'][:2])}")
    for rule_id, targets in sorted(report.review.items()):
        print(f"     à vérifier à la main : {rule_id} → {' ; '.join(targets)}")
    for err in report.errors[:3]:
        print(f"     erreur : {err}")


def main() -> int:
    wanted = set(sys.argv[1:])
    catalog = get_json("/api/catalog")
    games = catalog["games"] if isinstance(catalog, dict) else catalog
    games = [g for g in games if not wanted or g["id"] in wanted]
    if wanted and len(games) != len(wanted):
        unknown = sorted(wanted - {g["id"] for g in games})
        print(f"Jeux inconnus ou non proposés : {', '.join(unknown)}")
        return 2
    if not games:
        print("Catalogue vide : aucun jeu à tester.")
        return 1

    reports: list[Report] = []
    with sync_playwright() as p:
        launch = {"args": ["--no-sandbox"]}
        if CHROMIUM_PATH:
            launch["executable_path"] = CHROMIUM_PATH
        browser = p.chromium.launch(**launch)
        try:
            for game in games:
                report = audit_game(browser, game)
                print_report(report)
                reports.append(report)
        finally:
            browser.close()

    failing = [r for r in reports if r.blocking() or r.errors]
    minor = sum(len(r.rules) - len(r.blocking()) for r in reports)
    print(
        f"\n{len(reports)} jeu(x) audité(s), {len(failing)} avec une violation grave, critique ou une erreur. "
        f"{minor} règle(s) modérée(s) ou mineure(s) à suivre."
    )
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
