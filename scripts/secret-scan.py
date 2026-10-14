#!/usr/bin/env python3
"""Contrôle des secrets dans les fichiers suivis par Git.

Cherche des motifs connus (clés cloud, jetons GitHub, clés privées) et des affectations de mot de
passe ou de jeton avec une valeur en dur. Les valeurs de test explicites (contenant « test »,
« exemple » ou « changeme ») et les fichiers de test sont ignorés. Sort avec le code 1 si un
secret est trouvé.

Usage : python3 scripts/secret-scan.py
"""
import re
import subprocess
import sys

PATTERNS = {
    "clé d'accès AWS": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "jeton GitHub": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b"),
    "clé privée": re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----"),
    "jeton Slack": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    "mot de passe en dur": re.compile(
        r"""(?i)\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']([^"'\s]{8,})["']"""
    ),
}
SAFE_VALUE = re.compile(r"(?i)test|exemple|example|changeme|placeholder|xxxx|\$\{|process\.env")
SKIPPED_PATHS = re.compile(r"(__tests__|\.test\.|/tests?/|\.md$|package-lock\.json$)")
BINARY_HINT = re.compile(r"\.(png|jpe?g|gif|webp|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|zip|ico)$", re.I)


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line]


def scan(path: str) -> list[str]:
    findings: list[str] = []
    try:
        text = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        return findings
    for number, line in enumerate(text.splitlines(), start=1):
        for label, pattern in PATTERNS.items():
            match = pattern.search(line)
            if not match:
                continue
            if label == "mot de passe en dur" and SAFE_VALUE.search(match.group(2)):
                continue
            findings.append(f"{path}:{number} : {label}")
    return findings


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        if SKIPPED_PATHS.search(path) or BINARY_HINT.search(path):
            continue
        findings.extend(scan(path))
    if findings:
        print("Secrets possibles trouvés :")
        for line in findings:
            print(f"  - {line}")
        return 1
    print("Aucun secret détecté dans les fichiers suivis.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
