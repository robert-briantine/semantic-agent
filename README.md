# Semantic Agent Runtime
Prototype TypeScript / Express / SQLite (Node >= 22.13, module natif node:sqlite).

```sh
npm install
npm run build
npm test
npm start
```

Serveur local sur http://127.0.0.1:3000 ; MEMORY_DB, PORT et HOST configurables. L’interface et les API sont accessibles sans authentification.

| Endpoint | Usage |
|---|---|
| GET /api/library | Source `src/structure-langage-pour-ia.ts` |
| GET /api/examples | Traductions générées depuis le catalogue de scripts |
| GET /api/prompt | Prompt complet assemblé dynamiquement : instructions, URL d’exécution, librairie et exemples |
| POST /api/execute | Exécution de la console graphique, sans historique |
| POST /api/agent/execute | Exécution de l’agent avec `source`, `code`, `mode`, historisée |
| GET /api/agent/calls | Historique paginé (`limit`, `offset`) |
| GET /api/agent/calls/:id | Texte source, code traduit et réponse d’un appel |
| POST /api/database/reset | Vider la mémoire et l’historique en conservant les scripts (`confirm: "RAZ"`) |
| GET /api/scripts | Liste des scripts enregistrés |
| POST /api/scripts/clone | Cloner le code et le mode fournis avec un nom de copie disponible |
| POST /api/scripts | Enregistrer un nouveau script (`name`, `code`, `mode`) |
| GET /api/scripts/:id | Recharger un script |
| PUT /api/scripts/:id | Modifier ou renommer un script |
| GET /api/database/tables | Tables SQLite, colonnes et nombre de lignes |
| POST /api/database/query | Requête SQL de lecture (`sql`, `limit`, `offset`) |
| POST /api/refs/preview | Aperçu des faits liés à une sélection (`refIds`) |
| POST /api/refs/delete | Suppression groupée (`refIds`, `mode: "write"`) |
| GET /api/refs/:id | Nombre de compositions et phrases liées à une référence |
| DELETE /api/refs/:id | Supprimer tous les faits liés à une référence et nettoyer les répertoires |
| GET /health | Santé |

Les variables de `select`, `all` et `exists` peuvent être de type `"Ref"`, `"Phrase"`, `"Composition"`, `"string"`, `"number"`, `"boolean"` ou `"complements"`. Par exemple, `query(select({nom:"string"},composition(variable("nom"),"Nom",personne)))` renvoie les noms mémorisés pour une personne. Les domaines primitifs regroupent les valeurs utilisées comme arguments des faits (y compris dans les propositions imbriquées), sans les noms de prédicats ou de rôles. Les résultats conservent leurs types JavaScript. Les bases existantes sont mises à jour automatiquement au démarrage pour indexer ces valeurs ; les écritures transactionnelles et leurs annulations incluent cet index.

Une phrase a une représentation unique : `phrase(sujet, verbe, ...complements)` construit `["phrase", sujet, verbe, ...complements]`. `Phrase<T>` est le type du tuple ; il n’y a plus de constructeur `Phrase`, ni de primitive `fait`. `Element` et `ComplementElement` acceptent les phrases via `Expression`. Les scripts utilisateur doivent employer la nouvelle syntaxe.

`Composition<T>` utilise également une représentation unique : `["composition", ref, nom, of?]`, construite par `composition(ref, nom, of?)`. Ce tuple remplace la classe `Composition` et l’ancien opérateur/helper `est`. Il est utilisable comme expression, sujet ou complément d’une phrase, et comme argument d’une autre composition. `addMemoryComposition` renvoie le tuple enregistré. Les scripts utilisateur doivent remplacer `est(...)` et `new Composition(...)` par `composition(...)` ; les exemples intégrés sont actualisés automatiquement.

Les variables de type `"Composition"` parcourent toutes les compositions stockées, y compris les contenus imbriqués. Par exemple, `addMemoryPhrase(alice, "pense", composition(bob, "personne"))` rend ce contenu accessible par `select({c:"Composition"},phrase(alice,"pense",variable("c")))`, sans rendre vraie la condition indépendante `composition(bob,"personne")`. Les colonnes `compositions.owner_type` et `owner_id` conservent ce contexte, comme pour `phrases`. `memoryComposition()` retourne les affirmations indépendantes. La migration convertit les anciens objets `$composition` et tuples `["est", ...]` dans une seule transaction, en conservant les faits, identifiants et contextes ; les réouvertures ne créent pas de doublons.

`addMemoryPhrase` enregistre une affirmation indépendante et crée les lignes des phrases imbriquées. Les phrases contenues dans les compositions sont également stockées. `phrases.owner_type` et `owner_id` les rattachent au fait contenant ; leur présence en base ne les transforme pas en affirmations indépendantes. Ainsi `addMemoryPhrase(alice, "pense", phrase(bob, "dort"))` enregistre deux lignes, mais `query(select({}, phrase(bob, "dort")))` reste vide tant que ce sommeil n’est pas affirmé séparément. Le domaine `"Phrase"` inclut tous les tuples stockés ; `memoryRelation()` retourne les affirmations indépendantes. La migration des anciens objets et tuples conserve les identifiants et les contenus, dans une transaction, sans purge des faits ni des index.

Une variable de type `"complements"` parcourt les listes ordonnées de compléments des phrases mémorisées, y compris les listes vides et les listes imbriquées. `phrase(sujet, verbe, variable("c"))` lie toute la liste lorsque `c` est de ce type. Avec les autres types, le dernier argument reste un complément unique. `contient(variable("c"), ["à", destinataire])` vérifie la présence du couple exact ; `contient(variable("c"), valeur)` cherche un élément nu. Les compléments supplémentaires et leur position n’empêchent pas ce filtre. Les listes renvoyées gardent leur ordre et leurs doublons.

Les chaînes sont interdites comme valeurs de complément, seules ou dans un couple : `"rapport"` et `["objet", "rapport"]` sont refusés. Utiliser une entité typée : `const objet = new Ref(); addMemoryComposition(objet, "Rapport"); addMemoryPhrase(auteur, "envoie", objet);`. Pour la rechercher, lier `objet: "Ref"` avec `contient(variable("c"), variable("objet"))` et `composition(variable("objet"), "Rapport")`. Une variable `string` ne peut pas servir de complément. La règle est vérifiée dans les constructions, les requêtes et les insertions, y compris les expressions imbriquées. Les mots-clés restent des chaînes et les nombres, booléens, phrases et propositions restent autorisés. Pour un texte descriptif, utiliser une composition, par exemple `addMemoryComposition("Rapport annuel", "Titre", objet)`.

```ts
print(query(select({ sujet: "Ref", c: "complements", destinataire: "Ref" }, and(
    phrase(variable("sujet"), "donne", variable("c")),
    contient(variable("c"), ["à", variable("destinataire")])
))));
```

Les tuples `['phrase', sujet, verbe, ['var', 'c']]` et `['contient', ['var', 'c'], ['à', destinataire]]` sont également acceptés. `contient` accepte aussi une liste littérale, par exemple `contient([42, ["à", personne]], 42)`.

Un complément direct, notamment le COD, s’écrit sans mot-clé : « envoie un rapport à Clara » devient `phrase(auteur, "envoie", rapport, ["à", clara])`. Les couples conservent les prépositions et locutions du texte, comme `à`, `sur`, `pour`, `avec`, `depuis` ou `à côté de` ; ne pas ajouter de rôle artificiel `"objet"`. Les types `Verbe`, `NomCommun`, `Qualificatif` et `Preposition` sont des chaînes documentées ; le moteur contrôle les verbes, noms communs et mots de liaison dans trois tables de vocabulaire. Le guide de l’agent détaille ce repérage grammatical et les ambiguïtés à préserver. Le script **12. Prépositions** recherche les actions d’après « sur la table », « pour Clara avec Bruno » et « depuis le bureau ».

Les dictionnaires sont chargés à l’ouverture de la base depuis les fichiers du dépôt : `lexique_verbes` (88 811 formes verbales, dont les conjugaisons), `lexique_noms_communs` (43 654 noms singuliers ou invariables), `lexique_prepositions` (140 prépositions/locutions et 8 conjonctions). Les colonnes sont `mot` (clé primaire), `source` et `nature`. Les deux premières listes sont extraites de [Lexique 4.15](https://www.lexique.org/) sous CC BY-SA 4.0 ; la licence et la provenance sont conservées dans [src/lexicon/README.md](src/lexicon/README.md). Le vocabulaire est fini et n’est pas exhaustif.

Les insertions, les requêtes et les expressions imbriquées refusent un mot inconnu ou une mauvaise catégorie. Dans les phrases, privilégier la forme conjuguée du texte : « Ana mange » devient `phrase(ana, "mange")`, « Ana travaillait » utilise `"travaillait"`. Les insertions et requêtes conservent et comparent exactement ces formes ; aucune lemmatisation implicite n’est appliquée. Pour les noms communs, utiliser `composition(p, "personne")`, jamais `composition(p, "les personnes")`. L’API renvoie HTTP 400 avec le mot et la table concernée ; une erreur annule les écritures de l’appel. La reconnaissance lexicale normalise Unicode, casse et apostrophes, sans modifier les noms stockés ni la comparaison exacte des faits. Les valeurs textuelles et les noms propres restent libres ; les qualificatifs n’ont pas de dictionnaire dédié. La RAZ conserve les trois dictionnaires. Pour régénérer les données : `python3 scripts/import-lexicon.py`, puis `npm run build`. Aucun téléchargement n’a lieu à l’initialisation de l’application.

La table `Complement(idPhrase, ordre, motClef, Element)` indexe chaque complément d’une phrase. `ordre` commence à 0, `motClef` vaut SQL NULL pour un élément nu et `Element` contient sa valeur JSON. La clé primaire est `(idPhrase, ordre)` ; l’index `(idPhrase, motClef, Element)` sert aux recherches `contient`. Les anciennes phrases sont indexées automatiquement à l’ouverture. Les insertions, annulations et suppressions mettent à jour cette table dans la même transaction que les faits.

Dans `select`, une variable déclarée mais absente des occurrences libres de la condition vaut `undefined` dans chaque résultat. Son domaine n’est pas parcouru : `select({p:"Ref",n:"string"},composition(variable("p"),"Personne"))` renvoie les personnes avec `n: undefined`, même si aucune chaîne n’est enregistrée. Une variable utilisée uniquement sous un quantificateur qui redéclare son nom reste inutilisée dans le `select` extérieur. Les variables réellement utilisées continuent à imposer leurs conditions : chercher aussi un `Nom` ne renvoie que les personnes ayant ce nom enregistré.

Cette règle s’applique aussi aux conditions constantes : `query(select({n:"string"},true))` renvoie `[{n:undefined}]`. Pour énumérer toutes les valeurs d’un domaine, utiliser explicitement la variable, par exemple `query(select({n:"string"},eq(variable("n"),variable("n"))))`. Les domaines des variables locales de `all` et `exists` conservent leur sémantique habituelle. Les types TypeScript distinguent les variables utilisées et inutilisées lorsque l’expression est connue ; une expression dynamique ou un objet de phrase conserve un type pouvant inclure `undefined`.

Le runtime renvoie de vrais `undefined`. Dans le JSON de `POST /api/execute`, les propriétés `undefined` sont représentées par `{"$undefined":true}` pour conserver les colonnes ; la console affiche ce marqueur comme `undefined`. Le JSON brut reste un JSON valide avec ce marqueur explicite.

```sh
curl -s http://127.0.0.1:3000/api/prompt
curl -s http://127.0.0.1:3000/api/execute -H 'Content-Type: application/json' -d '{"mode":"write","code":"const p = new Ref(); addMemoryComposition(\"Jean\", \"Nom\", p); print(p);"}'
curl -s http://127.0.0.1:3000/api/execute -H 'Content-Type: application/json' -d '{"code":"print(query(select({p:\"Ref\"},composition(\"Jean\",\"Nom\",variable(\"p\")))));"}'
```

`GET /api/prompt` fournit un seul texte prêt à transmettre à l’agent. À chaque requête, le serveur relit `docs/agent-prompt.md`, `src/structure-langage-pour-ia.ts` et `src/lg-exemple executable.ts`, puis les assemble en instructions et annexes. La réponse est du texte UTF-8 avec `Cache-Control: no-store`. Les endpoints `/api/library` et `/api/examples` restent disponibles pour les usages séparés et la console.

Le prompt inclut l’URL absolue de `POST /api/agent/execute`, construite depuis le protocole et l’hôte de la requête reçue (port compris). Pour un service accessible derrière un proxy HTTPS ou sous un préfixe, définir par exemple `PUBLIC_URL=https://memoire.example/agent/` : l’URL insérée sera `https://memoire.example/agent/api/agent/execute`. Les en-têtes de proxy ne sont pas utilisés automatiquement. Sans cette option, charger le prompt à l’adresse par laquelle l’agent accède au service.

Les instructions expliquent le corps JSON `{source, mode, code}`, les primitives injectées, les modes de lecture et d’acquisition, le format de `output`, les erreurs et les limites. Les trois exemples JSON du guide sont directement exécutables. Les traductions TypeScript de l’annexe proviennent du catalogue `src/example-scripts.ts`, identique à l’onglet **Exemple** : chaque bloc indique son mode et les scénarios complexes détaillent texte naturel, explication et résultat attendu. Retirer l’import pour exécuter un bloc dans l’API, puis adapter ses références à la demande réelle. Le guide distingue la mémoire RAM de référence du runtime SQLite persistant et rappelle que les variables JavaScript ne survivent pas entre deux appels.

La console graphique utilise `POST /api/execute` avec `{code, mode}` ; cet endpoint n’ajoute aucune ligne à l’historique. L’agent utilise `POST /api/agent/execute` avec `{source, code, mode}` : `source` est le texte naturel de la demande ou du fragment de document traduit, et `code` sa traduction TypeScript. Chaque champ texte est limité à 60000 caractères, dans un corps JSON de 128 Ko maximum. Le mode vaut `read` par défaut. Le serveur n’effectue pas lui-même la traduction.

```json
{"source":"Quelles personnes sont enregistrées ?","mode":"read","code":"print(query(select({p:\"Ref\"},composition(variable(\"p\"),\"Personne\"))));"}
```

Un appel agent accepté est inscrit dans `agent_calls` avant l’exécution. Son identifiant est renvoyé dans `callId`, y compris en cas d’erreur d’exécution. La table conserve `id`, `created_at`, `completed_at`, `source`, `code`, `mode`, `status` (`running`, `succeeded`, `failed`), `http_status`, `duration_ms` et `response` (JSON). Les erreurs et les délais dépassés sont historisés ; une annulation des écritures du script ne supprime pas l’historique. Les requêtes invalides et les refus HTTP 429 n’étant pas exécutés, ils ne créent pas de ligne. Les anciennes bases reçoivent automatiquement cette table au démarrage.

L’onglet **Historique agent** (`/#history`) affiche les appels récents, avec pagination et actualisation. Sélectionner une entrée montre le texte naturel complet, le code et la réponse. La table est aussi consultable dans **Base SQLite**. `GET /api/agent/calls?limit=25&offset=0` renvoie `{ok, calls, limit, offset, hasMore}` avec un aperçu de la source (limite maximale de 100 appels) ; `GET /api/agent/calls/:id` renvoie `{ok, call}`, avec `call: null` si l’identifiant est absent.

Le bouton **RAZ**, accessible en haut de la console, demande confirmation avant de vider les tables de mémoire (faits, références, compléments et index de valeurs) et l’historique des appels de l’agent. Les tables de dictionnaire sont conservées, comme `saved_scripts`. Cette dernière est exclue de la RAZ : les scripts enregistrés dans l’interface web conservent leur nom, leur code, leur mode et leur identifiant. L’API correspondante est `POST /api/database/reset` avec `{"confirm":"RAZ"}`. La suppression est une seule transaction ; une erreur annule l’ensemble. Le schéma et ses index sont conservés. La RAZ est refusée pendant une exécution ou une autre modification (HTTP 429). Le script chargé, sa sélection et ses modifications non enregistrées dans Monaco sont conservés ; les résultats et l’historique affichés sont effacés, et les compteurs des tables sont actualisés. Les scripts conservés peuvent être rechargés, modifiés et exécutés après la RAZ. Ajouter le bouton ne déclenche aucune suppression automatique.

## Profils GitHub Copilot et Qwen Code

L’agent porte le nom `semantic-agent`. Son prompt complet (`GET /api/prompt`) commence par un en-tête YAML avec `name` et `description`. Deux fichiers de démarrage utilisent ce même nom et conservent les deux modes Documents et Questions :

| Client | Fichier du projet |
|---|---|
| GitHub Copilot, notamment dans VS Code | [.github/agents/semantic-agent.agent.md](.github/agents/semantic-agent.agent.md) |
| Qwen Code | [.qwen/agents/semantic-agent.md](.qwen/agents/semantic-agent.md) |

Ces emplacements et les métadonnées suivent les formats documentés par [GitHub Copilot](https://docs.github.com/en/copilot/reference/custom-agents-configuration), [VS Code](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference) et [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/). Les profils laissent le client choisir son modèle et ses outils disponibles, en conservant ses permissions.

Démarrer le service avec `npm start`, puis sélectionner `semantic-agent` dans les agents Copilot. Dans Qwen Code, vérifier sa présence avec `/agents manage`, puis demander par exemple « Utilise l’agent semantic-agent pour répondre à cette question… ».

Chaque profil charge le prompt actuel depuis `http://127.0.0.1:3000/api/prompt` avant de traiter la demande. Pour une autre instance, fournir son adresse à l’agent ou définir `SEMANTIC_AGENT_URL` dans l’environnement du client, par exemple `https://memoire.example/agent`. Le serveur doit être joignable depuis la machine qui exécute Copilot ou Qwen ; un client exécuté dans le cloud a besoin d’une instance accessible depuis son environnement. `SEMANTIC_AGENT_URL` règle l’adresse côté client, tandis que `PUBLIC_URL` règle l’URL publique annoncée par le serveur.

Les profils restent courts et chargent les instructions, la librairie et les exemples dynamiquement. Cela respecte notamment la limite de 30000 caractères des profils Copilot et évite de figer une copie des sources dans chaque configuration. Pour installer l’agent dans un autre projet, copier le fichier de démarrage dans le dossier correspondant du client. Le prompt complet téléchargeable sert de contenu de référence ; utiliser les fichiers de démarrage ci-dessus comme profils à installer.

## Architecture
`structure-langage.ts` : types/helpers ; `runtime.ts` : compilateur SQL paramétré, stockage SQLite et hydratation ; `structure-langage-runtime.ts` : façade persistante ; `execute.ts` : interpréteur AST à liste blanche ; `server.ts` : API. Les identités sont des UUID ; comparer les IDs, pas l'identité JS après hydratation. Les programmes ne voient pas les tables. Les index SQL portent sur les prédicats et leurs arguments sérialisés. Les requêtes ne chargent pas toute la base en RAM, mais les domaines multiples peuvent encore produire des produits cartésiens ; optimiser le planificateur et mesurer sur un gros corpus. `not` = monde fermé. Comparaison structurelle exacte, sans alpha-équivalence ni inférence automatique. Pas de fusion batch ni d'index d'intervalles dans ce lot. Les getters globaux sont destinés au diagnostic, pas aux requêtes à grande échelle. Les exports mémoire globale sont des fonctions de lecture dans le runtime, et non des tableaux mutables. L'API exécute un sous-ensemble de TS (pas du code arbitraire). Le prompt permet au harnais externe de lire et traduire les documents ; aucun fournisseur LLM ni parseur PDF n'est intégré. L'agent appelle l'API depuis son propre harnais. Les transactions sont utilisées par l'API ; pour des écritures directes, utiliser transaction().

## Docker

```sh
docker build -t semantic-agent .
docker run --rm -p 127.0.0.1:3000:3000 -v semantic-memory:/app/data semantic-agent
```

## Console web

La page **Stockage SQLite**, accessible depuis la documentation ou à l’adresse `/docs/storage.html`, décrit les onze tables (`refs`, `compositions`, `phrases`, `Complement`, `primitive_values`, `fact_arguments`, `saved_scripts`, `agent_calls`, `lexique_verbes`, `lexique_noms_communs`, `lexique_prepositions`), leurs colonnes et index, le format JSON et les transactions. Un exemple montre comment une information est enregistrée puis retrouvée.

L’onglet **Base SQLite** de la console (`/#database`) permet de consulter chaque table avec ses colonnes et son nombre de lignes. Cliquer sur une table prépare et exécute une requête de lecture. Le champ SQL accepte les requêtes `SELECT` et `WITH`, les filtres, jointures et fonctions JSON SQLite ; Ctrl+Entrée / Cmd+Entrée lance la requête. Les résultats sont paginés et copiables en JSON. **Actualiser** recharge les compteurs et les résultats après une acquisition. Le script TypeScript est conservé pendant les changements d’onglet.

Dans `compositions` et `phrases`, `name` est du texte brut : `WHERE name = 'Personne'` fonctionne directement. Les noms qualifiés sont séparés en `name` et `qualifier` (texte brut, ou SQL NULL pour un nom simple). Le runtime compare les deux colonnes pour préserver la distinction entre noms simples et qualifiés. Les arguments et les objets complets restent en JSON. Les anciennes bases sont migrées automatiquement à l’ouverture, en conservant les faits et leurs identifiants.

`POST /api/database/query` accepte par exemple `{"sql":"SELECT * FROM compositions;","limit":50,"offset":0}` et renvoie `columns`, `rows`, `limit`, `offset` et `hasMore`. La limite par défaut est de 100 lignes, avec un maximum de 1000. Les requêtes s’exécutent dans un processus séparé sur une connexion SQLite en lecture seule, avec un délai de 5 secondes et une taille de réponse limitée à 4 Mo. Les entiers hors de la plage exacte de JavaScript sont renvoyés sous forme de chaînes, et les BLOB en hexadécimal. Les onze tables sont initialisées au démarrage du serveur.

La page **Documentation API**, accessible depuis la console ou à l’adresse `/docs/`, affiche en lecture seule la source `structure-langage-pour-ia.ts` (`GET /api/library`), le prompt complet assemblé dynamiquement (`GET /api/prompt`) et les exemples (`GET /api/examples`). Les documents sont chargés directement depuis l’API et peuvent être actualisés, copiés ou téléchargés. Les liens `/docs/#library`, `/docs/#prompt` et `/docs/#examples` ouvrent directement le document choisi. Le lien de la console ouvre la documentation dans un nouvel onglet pour conserver le script en cours.

Ouvrir http://127.0.0.1:3000/ après le démarrage. L’éditeur permet d’exécuter les scripts sans import, en lecture seule (par défaut) ou en écriture (confirmation). Les sorties `print()` sont affichées séparément : tableaux pour les objets et collections homogènes, texte/JSON formaté sinon. Le JSON brut est consultable et copiable. Charger les scripts de démonstration depuis l’onglet **Exemple**. La même collection est fournie à l’agent et dans la documentation par `/api/examples` et `/api/prompt`. Ctrl+Entrée ou Cmd+Entrée lance le script.

Des cases à cocher accompagnent les références `{"$ref":"…"}` affichées dans la console, même imbriquées dans un objet ou une chaîne JSON, ainsi que les références `{"id":"…"}` retournées par l’exécuteur. Les commandes **Tout sélectionner**, **Tout désélectionner** et **Supprimer la sélection** agissent sur les références de la sortie courante. Les occurrences d’une même référence partagent leur sélection et sont comptées une seule fois. La sélection et la suppression sont désactivées en lecture seule. Revenir en lecture seule, effacer les résultats ou lancer une nouvelle exécution réinitialise la sélection et annule tout aperçu en attente.

Un aperçu compte les compositions et phrases concernées avant confirmation, sans doubler les faits partagés entre plusieurs références sélectionnées. La suppression groupée est une seule transaction : une erreur annule toute la sélection. L’index `fact_arguments` couvre les sujets, les arguments des compositions, les compléments et propositions imbriquées ; les références et valeurs devenues inutilisées sont ensuite nettoyées. Les autres faits et les scripts enregistrés sont conservés. Les compteurs de l’onglet SQLite sont actualisés ; le transcript reste une copie historique jusqu’à la prochaine lecture.

`POST /api/refs/preview` accepte `{"refIds":["id-1","id-2"]}`. `POST /api/refs/delete` exige `{"refIds":["id-1","id-2"],"mode":"write"}` ; un mode absent ou différent de `write` renvoie HTTP 403. Les routes individuelles `GET /api/refs/:id` et `DELETE /api/refs/:id` restent disponibles ; cette dernière exige également `{"mode":"write"}`.

`fact_arguments` contient un lien par fait et par référence ou valeur primitive distincte. Sa clé primaire `(type,value,fact_type,fact_id)` et l’index `(fact_type,fact_id,type,value)` évitent une recherche par sous-chaîne ou un parcours intégral des JSON lors des suppressions. Une migration construit automatiquement cet index pour les anciennes bases ; les écritures et suppressions restent transactionnelles.

Les scripts peuvent définir des fonctions synchrones avec `function`, des expressions `function` ou des fonctions fléchées. Les paramètres peuvent être typés, avoir une valeur par défaut ou utiliser `...rest`. Les fonctions acceptent `return`, `if/else`, les variables locales et les fermetures lexicales ; les opérations arithmétiques, comparaisons, conditions ternaires et affectations simples aux variables `let` sont disponibles. Par exemple :

```ts
function personnes() {
    return query(select({p: "Ref"}, composition(variable("p"), "Personne")));
}
print(personnes());
```

L’exécuteur interprète ces fonctions et conserve les contrôles de lecture/écriture et les transactions, même lors d’appels par alias ou paramètre. Une erreur annule toutes les écritures de l’exécution. Le budget commun reste de 10000 instructions, avec une profondeur maximale de 128 appels. Les fonctions asynchrones, générateurs, boucles, paramètres déstructurés et méthodes natives arbitraires ne font pas partie de ce sous-ensemble TypeScript.

La console utilise toute la largeur de la fenêtre et l’éditeur Monaco prend la hauteur disponible sous ses commandes. Les boutons **Masquer / Afficher la sortie** et **Masquer / Afficher l’éditeur** contrôlent les deux panneaux indépendamment. Le panneau visible récupère toute la largeur lorsque l’autre est masqué ; le code, les résultats et l’onglet de fichier choisi sont conservés. Sur petit écran, les panneaux s’affichent verticalement.

L’éditeur utilise Monaco avec coloration, autocomplétion, signatures et diagnostics TypeScript. L’onglet `structure-langage-pour-ia.ts` affiche le fichier source en lecture seule et conserve le script lors des changements d’onglet. Les définitions de types du runtime persistant et celles des fonctions injectées (`query`, `print`, etc.) sont chargées dans les libs de Monaco pour une utilisation sans import. Monaco et ses workers sont servis localement, sans CDN. `npm run build` prépare aussi les fichiers de l’éditeur et génère les types depuis la librairie ; relancer cette commande après une modification de celle-ci.

Les suggestions s’ouvrent aussi dans les chaînes : les déclarations de `select`, `all` et `exists` proposent `"Ref"`, `"Phrase"`, `"Composition"`, `"string"`, `"number"`, `"boolean"` et `"complements"`. Dans `variable("…")`, l’éditeur propose les noms déclarés dans la portée courante, y compris ceux des quantificateurs englobants. Ctrl+Espace permet de rouvrir les suggestions manuellement.

Pour réutiliser un script, renseigner son nom puis cliquer sur **Enregistrer** (ou Ctrl+S / Cmd+S). Son nom, son code et son mode sont conservés sur le serveur dans la base `MEMORY_DB`, y compris après un redémarrage. Sélectionner un script dans **Scripts enregistrés**, cliquer sur **Charger**, puis sur **Exécuter le script** pour le rejouer. Charger ou enregistrer un script ne l’exécute pas ; un script en mode écriture demande toujours confirmation avant son exécution. **Enregistrer** met à jour le script chargé, y compris son nom ; **Nouveau** prépare un autre script. Un nom déjà utilisé par un autre script est refusé sans écraser son contenu. Les changements non enregistrés sont signalés avant de remplacer un script ou de quitter la page.

Le bouton **Cloner** enregistre une copie indépendante du script courant, avec son code (y compris les modifications non enregistrées) et son mode, puis la charge dans l’éditeur. Un nouveau nom est choisi automatiquement : « Nom — copie », « Nom — copie 2 », etc. Le script d’origine reste conservé. Un script sans nom est copié sous « Script — copie ». Le clonage n’exécute aucun code. Si vous modifiez le script pendant la création de la copie, ces nouvelles modifications restent dans l’éditeur et la copie est disponible dans la liste des scripts enregistrés.

Le gestionnaire propose deux onglets : **Script** affiche uniquement les scripts utilisateur, **Exemple** les scripts préinstallés de type `exemple`. Changer d’onglet conserve le code courant. Charger un exemple permet de l’exécuter en gardant son nom et son code en lecture seule ; **Cloner** crée une copie modifiable de type `utilisateur` et ouvre l’onglet **Script**. Les scripts utilisateur peuvent être supprimés après confirmation. Les exemples ne peuvent être ni écrasés ni supprimés, y compris par l’API (`DELETE /api/scripts/:id` renvoie HTTP 403 pour un exemple).

L’onglet **Exemple** contient 25 scripts couvrant tous les types d’expression : booléens, `est`, `phrase`, `eq`, `not`, `and`, `or`, `implies`, `contient`, `all`, `exists` et `switchCase`. Chaque script est autonome, sans définition de fonction ni préparation préalable : il crée ses données privées, affiche son résultat puis supprime toutes ses références dans `finally`. Les exemples avec données temporaires utilisent le mode écriture ; les booléens seuls restent en lecture. Deux exécutions donnent les mêmes résultats sans laisser de faits, de compléments, de références ou de valeurs orphelines. Les données préexistantes, même homonymes, sont préservées.

Les **10 scripts de traductions complexes** présentent une insertion et neuf recherches : relatives avec jointures, compléments multiples et cause, croyances et provenance documentaire, deux lectures de « tous les collaborateurs », portée de `all/exists`, absence et négation attribuée, exceptions prioritaires, propriétés typées avec zéro et `false`, et distinction des temps verbaux. Ils peuvent être exécutés dans n’importe quel ordre. Les données Nora/Omar/Léa/Zoé/Hugo et leurs projets sont fictives et recréées temporairement dans chaque script.

`npm run build` génère automatiquement `src/lg-exemple executable.ts` depuis le catalogue avec `scripts/build-examples.cjs`, puis compile le catalogue et les scripts générés. Modifier le catalogue, pas le fichier généré. Le prompt continue à relire les instructions, la librairie et la source des exemples à chaque requête ; reconstruire après une modification du catalogue. Chaque bloc représente un appel indépendant. L’agent doit sélectionner et adapter une traduction, sans insérer automatiquement le jeu fictif ni exécuter toute l’annexe.

Pour `switchCase`, **Exemple switchCase — 1. Insertion** affiche Alice, Bob, Chloé et Denis avant nettoyage. **2. Requête** prépare lui-même ces personnes et ne retient que Bob et Chloé, selon la priorité des cas et le résultat par défaut, puis nettoie ses données. La primitive `deleteReferences([ref1, ref2, ...])` est disponible en écriture et supprime les faits mentionnant ces Ref, y compris dans les contenus imbriqués. Une erreur annule la transaction entière. Les exemples sont conservés après une RAZ et ne sont pas exécutés lors de leur installation. Les anciens scripts sont migrés vers le type `utilisateur` sans changer leur contenu.
