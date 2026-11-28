# Vocabulaire français embarqué

`french.json` est une extraction de **Lexique 4.15**, téléchargé depuis
[lexique.org](https://www.lexique.org/) :
https://www.lexique.org/databases/Lexique/Lexique415.zip.

Auteurs : Boris New, Christophe Pallier et les contributeurs de Lexique.
Référence : New, Pallier, Schalchli, Bourgin et Gimenes (2026), *Lexique 4: a major
upgrade of the “Lexique” French lexical database*, Behavior Research Methods.

Les données dérivées sont distribuées sous **CC BY-SA 4.0**. Le texte intégral
est dans `LICENSE-Lexique.txt` et la notice amont dans `README-Lexique.txt`.
Le code de l'application n'est pas une extraction du dictionnaire. La licence
de données s'applique aux fichiers de vocabulaire dérivés.

## Extraction

- Verbes : formes orthographiques et lemmes des catégories `VER` et `AUX`, soit
  88 811 formes connues, dont 7 334 infinitifs. Les conjugaisons, participes et
  auxiliaires présents dans la source sont inclus.
- Noms communs : lemmes `NOM` rencontrés au singulier, invariables ou sans
  indication de nombre (`s`, `i`, vide), soit 43 654 entrées.
- Normalisation : Unicode NFC, minuscules, apostrophe ASCII, espaces externes retirés.
- Les accents sont conservés. Les formes fléchies sont importées pour les verbes ;
  les noms restent des lemmes singuliers ou invariables.

Les phrases utilisent la forme conjuguée du passage source. Aucune conjugaison
ni lemmatisation n'est appliquée implicitement aux faits ou aux requêtes :
`mange`, `mangent` et `manger` restent des prédicats distincts. Seules les formes
présentes dans la source sont importées, sans génération de conjugaisons ou de
temps composés supplémentaires. La version `lexique-4.15-conjugaisons-1` déclenche
la mise à jour automatique des anciennes bases limitées aux infinitifs.

Le fichier indique la version, l'URL et le SHA-256 du fichier source.
Il s'agit d'un vocabulaire fini : un mot français rare ou récent peut manquer.
Les noms propres et les valeurs textuelles des faits ne sont pas contrôlés
par ces listes. Les qualificatifs restent libres : aucune quatrième table
d'adjectifs/adverbes n'est créée.

`prepositions.json` conserve les 140 prépositions et locutions proposées dans
le projet. Les 8 conjonctions déjà utilisées pour les propositions imbriquées
sont conservées séparément dans ce fichier et identifiées par
`nature = 'conjonction'` dans `lexique_prepositions`.

## Régénérer

```sh
python3 scripts/import-lexicon.py
# Ou depuis une archive déjà téléchargée :
python3 scripts/import-lexicon.py --archive /chemin/Lexique415.zip
npm run build
```

Le téléchargement est réservé à cet import explicite. L'application charge les
JSON inclus dans le dépôt ; aucune connexion réseau n'est nécessaire au démarrage.
Une nouvelle version des données doit changer `version` pour être intégrée aux
tables existantes. Les mots supplémentaires saisis dans une table ne sont pas
supprimés par cet import. Les trois tables sont exclues de la RAZ.
