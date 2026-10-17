#!/usr/bin/env python3
"""Cycle réel d'un paquet .phgame sur une instance démarrée.

Séquence : installation de la version 1.0.0, mise à jour vers 1.1.0, retour arrière vers 1.0.0,
téléchargement de la sauvegarde complète, suppression du paquet, restauration de la sauvegarde.
Le serveur doit tourner, avec un DATA_DIR qui ne contient pas encore ce paquet. D'autres paquets
peuvent être installés (la recette les installe avant ce cycle) : ils figurent dans la sauvegarde
et doivent être reconnus comme déjà présents à la seconde restauration.

Usage : python3 scripts/paquet-cycle-check.py [url]
Variables : ADMIN_PASSWORD (défaut : ci-admin-password-test). Le paquet est fabriqué à partir de
l'exemple du dépôt (examples/exemple-cartes), avec un autre identifiant. Nécessite
packages/server/dist (npm run build). Code de sortie 1 en cas d'échec.
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("URL", "http://127.0.0.1:8282")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "ci-admin-password-test")
PKG_ID = "cycle-verification"
CLI = ROOT / "packages" / "server" / "dist" / "cli" / "phgame.js"
failures = []


def check(label, ok, detail=""):
    print(("OK    " if ok else "ECHEC ") + label + ("" if ok or not detail else f" -- {detail}"))
    if not ok:
        failures.append(label)


def request(method, path, body=None, cookie=None, content_type="application/json"):
    headers = {}
    if cookie:
        headers["Cookie"] = cookie
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.headers, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read()


def as_json(raw):
    try:
        return json.loads(raw or b"null")
    except ValueError:
        return None


def make_pack(workdir, version):
    src = workdir / f"src-{version}"
    shutil.copytree(ROOT / "examples" / "exemple-cartes", src)
    manifest_path = src / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["id"] = PKG_ID
    manifest["version"] = version
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    out = workdir / f"{PKG_ID}-{version}.phgame"
    subprocess.run(["node", str(CLI), "pack", str(src), str(out)], check=True, capture_output=True)
    return out.read_bytes()


def login():
    status, headers, _ = request("POST", "/api/admin/login", {"password": PASSWORD})
    if status != 200:
        raise SystemExit(f"Connexion administrateur refusée (HTTP {status}).")
    return (headers.get("Set-Cookie") or "").split(";")[0]


def installed(cookie):
    status, _, raw = request("GET", f"/api/admin/packages/{PKG_ID}/versions", None, cookie)
    if status != 200:
        return []
    return as_json(raw).get("versions", [])


def active_version(cookie):
    return next((v["version"] for v in installed(cookie) if v.get("active")), None)


def archived_versions(data):
    """Nombre de versions de paquets (toutes versions de tous les paquets) listées dans la sauvegarde."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return len(json.loads(zf.read("packages.json")))


def main():
    cookie = login()
    with tempfile.TemporaryDirectory(prefix="cycle-paquet-") as tmp:
        workdir = Path(tmp)
        v1 = make_pack(workdir, "1.0.0")
        v2 = make_pack(workdir, "1.1.0")

        status, _, raw = request("POST", "/api/admin/packages", v1, cookie, "application/octet-stream")
        check("installation de la version 1.0.0", status == 201, raw[:200].decode("utf-8", "replace"))
        check("1.0.0 est active après l'installation", active_version(cookie) == "1.0.0")

        status, _, raw = request("POST", "/api/admin/packages", v2, cookie, "application/octet-stream")
        check("mise à jour vers 1.1.0", status == 201, raw[:200].decode("utf-8", "replace"))
        check("1.1.0 est active après la mise à jour", active_version(cookie) == "1.1.0")

        status, _, raw = request("POST", f"/api/admin/packages/{PKG_ID}/versions/1.0.0/activate", {}, cookie)
        check(
            "retour arrière vers 1.0.0",
            status == 200 and active_version(cookie) == "1.0.0",
            raw[:200].decode("utf-8", "replace"),
        )

        status, _, archive = request("GET", "/api/admin/backup/archive", None, cookie)
        check("sauvegarde complète téléchargée", status == 200 and archive[:2] == b"PK")

        status, _, raw = request("DELETE", f"/api/admin/packages/{PKG_ID}", None, cookie)
        check("suppression du paquet", status == 200, raw[:200].decode("utf-8", "replace"))
        check("le paquet n'est plus installé", installed(cookie) == [])

        status, _, raw = request("POST", "/api/admin/backup/archive", archive, cookie, "application/zip")
        body = as_json(raw) or {}
        summary = body.get("summary", {}) if status == 200 else {}
        check("restauration de la sauvegarde", status == 200, raw[:200].decode("utf-8", "replace"))
        check("les deux versions sont réinstallées", summary.get("packages") == 2, str(summary.get("packages")))
        check("la version active sauvegardée (1.0.0) est rétablie", active_version(cookie) == "1.0.0")
        check("aucun paquet non restauré", summary.get("skipped") == [], str(summary.get("skipped")))

        status, _, raw = request("POST", "/api/admin/backup/archive", archive, cookie, "application/zip")
        summary = (as_json(raw) or {}).get("summary", {})
        expected = archived_versions(archive)
        check(
            "une seconde restauration ne réinstalle rien",
            summary.get("packages") == 0 and summary.get("packagesPresent") == expected,
            f"attendu {expected} présents : {summary}",
        )

    if failures:
        print(f"\n{len(failures)} vérification(s) en échec.")
        sys.exit(1)
    print("\nCycle du paquet : toutes les vérifications passent.")


if __name__ == "__main__":
    main()
