#!/usr/bin/env python3
"""Lecture et écriture des fichiers d’état de la mise à jour (appelé par partyhub-update.sh).

Sans dépendance hors de la bibliothèque standard. Les fichiers sont dans DATA_DIR/update :
la version de l’application les écrit et les lit aussi (voir packages/server/src/update/service.ts).

Commandes :
  get FICHIER CLÉ                          imprime la valeur (vide si absente)
  busy FICHIER SECONDES                    imprime les parties en cours, si le signal de vie est récent (sinon 0)
  version-live FICHIER VERSION SECONDES    code 0 si ce serveur répond en VERSION (vide = toute version)
  seen FICHIER                             écrit le signal de présence de l’installeur
  status FICHIER ÉTAT VERSION DEPUIS MSG   écrit le résultat de la tentative
"""

import json
import os
import sys
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc)


def iso(moment):
    return moment.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def parse_iso(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def read(path):
    try:
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write(path, data):
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    os.replace(tmp, path)


def age_seconds(data):
    moment = parse_iso(data.get('updatedAt'))
    if moment is None:
        return None
    return (now() - moment).total_seconds()


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    command, path = argv[1], argv[2]

    if command == 'get':
        value = read(path).get(argv[3])
        print('' if value is None else value)
        return 0

    if command == 'busy':
        data = read(path)
        age = age_seconds(data)
        in_game = data.get('inGame')
        fresh = age is not None and age < int(argv[3])
        print(in_game if fresh and isinstance(in_game, int) else 0)
        return 0

    if command == 'version-live':
        data = read(path)
        age = age_seconds(data)
        wanted = argv[3]
        same = wanted == '' or data.get('version') == wanted
        fresh = age is not None and age < int(argv[4])
        return 0 if same and fresh else 1

    if command == 'seen':
        write(path, {'seenAt': iso(now())})
        return 0

    if command == 'status':
        write(
            path,
            {
                'state': argv[3],
                'version': argv[4] or None,
                'from': argv[5] or None,
                'message': argv[6],
                'at': iso(now()),
            },
        )
        return 0

    print(f'Commande inconnue : {command}', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
