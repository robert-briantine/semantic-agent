#!/usr/bin/env python3
"""Importer les verbes avec leurs formes fléchies et les noms de Lexique 4.15."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import unicodedata
from urllib.request import urlopen
import zipfile

URL = 'https://www.lexique.org/databases/Lexique/Lexique415.zip'
ROOT = Path(__file__).resolve().parents[1] / 'src' / 'lexicon'


def normalize(word):
    return unicodedata.normalize('NFC', word).strip().lower().replace('’', "'")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Archive locale ; sinon téléchargement depuis lexique.org')
    args = parser.parse_args()
    data = args.archive.read_bytes() if args.archive else urlopen(URL, timeout=60).read()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        source = archive.read('Lexique 415/Lexique4.15.txt')
        license_text = archive.read('Lexique 415/CC.BY.SA.txt')
        readme = archive.read('Lexique 415/README-Lexique.txt')
    rows = csv.DictReader(io.StringIO(source.decode('utf-8-sig')), delimiter='\t', quoting=csv.QUOTE_NONE)
    verbs, infinitives, nouns = set(), set(), set()
    for row in rows:
        lemma = normalize(row['4_Lemme'])
        if not lemma:
            continue
        if row['5_Cgram'] in ('VER', 'AUX'):
            verbs.add(lemma)
            infinitives.add(lemma)
            form = normalize(row['1_Mot'])
            if form:
                verbs.add(form)
        if row['5_Cgram'] == 'NOM' and row['8_Nombre'] in ('s', 'i', ''):
            nouns.add(lemma)
    ROOT.mkdir(exist_ok=True)
    result = {'version': 'lexique-4.15-conjugaisons-1', 'source': URL, 'sha256': hashlib.sha256(source).hexdigest(),
              'nombreInfinitifs': len(infinitives),
              'verbes': sorted(verbs), 'nomsCommuns': sorted(nouns)}
    (ROOT / 'french.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'LICENSE-Lexique.txt').write_bytes(license_text)
    (ROOT / 'README-Lexique.txt').write_bytes(readme)
    print(f'{len(verbs)} formes verbales, dont {len(infinitives)} infinitifs ; {len(nouns)} noms communs.')


if __name__ == '__main__':
    main()
