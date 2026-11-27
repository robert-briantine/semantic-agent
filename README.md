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
| GET /api/examples | Source `src/lg-exemple executable.ts` |
| GET /api/prompt | Prompt complet assemblé dynamiquement : instructions, URL d’exécution, librairie et exemples |
| POST /api/execute | Exécution de la console graphique, sans historique |
| POST /api/agent/execute | Exécution de l’agent avec `source`, `code`, `mode`, historisée |
| GET /api/agent/calls | Historique paginé (`limit`, `offset`) |
| GET /api/agent/calls/:id | Texte source, code traduit et réponse d’un appel |
| POST /api/database/reset | Vider toutes les tables (`confirm: "RAZ"`) |
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

Les variables de `select`, `all` et `exists` peuvent être de type `"Ref"`, `"Phrase"`, `"string"`, `"number"`, `"boolean"` ou `"complements"`. Par exemple, `query(select({nom:"string"},est(variable("nom"),"Nom",personne)))` renvoie les noms mémorisés pour une personne. Les domaines primitifs regroupent les valeurs utilisées comme arguments des faits (y compris dans les propositions imbriquées), sans les noms de prédicats ou de rôles. Les résultats conservent leurs types JavaScript. Les bases existantes sont mises à jour automatiquement au démarrage pour indexer ces valeurs ; les écritures transactionnelles et leurs annulations incluent cet index.

Une variable de type `"complements"` parcourt les listes ordonnées de compléments des phrases mémorisées, y compris les listes vides. `fait(sujet, verbe, variable("c"))` lie toute la liste lorsque `c` est de ce type. Avec les autres types, le dernier argument reste un complément unique. `contient(variable("c"), ["à", destinataire])` vérifie la présence du couple exact ; `contient(variable("c"), valeur)` cherche un élément nu. Les compléments supplémentaires et leur position n’empêchent pas ce filtre. Les listes renvoyées gardent leur ordre et leurs doublons.

```ts
print(query(select({ sujet: "Ref", c: "complements", destinataire: "Ref" }, and(
    fait(variable("sujet"), "donne", variable("c")),
    contient(variable("c"), ["à", variable("destinataire")])
))));
```

Les tuples `['fait', sujet, verbe, ['var', 'c']]` et `['contient', ['var', 'c'], ['à', destinataire]]` sont également acceptés. `contient` accepte aussi une liste littérale, par exemple `contient([42, ["à", personne]], 42)`.

La table `Complement(idPhrase, ordre, motClef, Element)` indexe chaque complément d’une phrase. `ordre` commence à 0, `motClef` vaut SQL NULL pour un élément nu et `Element` contient sa valeur JSON. La clé primaire est `(idPhrase, ordre)` ; l’index `(idPhrase, motClef, Element)` sert aux recherches `contient`. Les anciennes phrases sont indexées automatiquement à l’ouverture. Les insertions, annulations et suppressions mettent à jour cette table dans la même transaction que les faits.

Dans `select`, une variable déclarée mais absente des occurrences libres de la condition vaut `undefined` dans chaque résultat. Son domaine n’est pas parcouru : `select({p:"Ref",n:"string"},est(variable("p"),"Personne"))` renvoie les personnes avec `n: undefined`, même si aucune chaîne n’est enregistrée. Une variable utilisée uniquement sous un quantificateur qui redéclare son nom reste inutilisée dans le `select` extérieur. Les variables réellement utilisées continuent à imposer leurs conditions : chercher aussi un `Nom` ne renvoie que les personnes ayant ce nom enregistré.

Cette règle s’applique aussi aux conditions constantes : `query(select({n:"string"},true))` renvoie `[{n:undefined}]`. Pour énumérer toutes les valeurs d’un domaine, utiliser explicitement la variable, par exemple `query(select({n:"string"},eq(variable("n"),variable("n"))))`. Les domaines des variables locales de `all` et `exists` conservent leur sémantique habituelle. Les types TypeScript distinguent les variables utilisées et inutilisées lorsque l’expression est connue ; une expression dynamique ou un objet de phrase conserve un type pouvant inclure `undefined`.

Le runtime renvoie de vrais `undefined`. Dans le JSON de `POST /api/execute`, les propriétés `undefined` sont représentées par `{"$undefined":true}` pour conserver les colonnes ; la console affiche ce marqueur comme `undefined`. Le JSON brut reste un JSON valide avec ce marqueur explicite.

```sh
curl -s http://127.0.0.1:3000/api/prompt
curl -s http://127.0.0.1:3000/api/execute -H 'Content-Type: application/json' -d '{"mode":"write","code":"const p = new Ref(); addMemoryComposition(\"Jean\", \"Nom\", p); print(p);"}'
curl -s http://127.0.0.1:3000/api/execute -H 'Content-Type: application/json' -d '{"code":"print(query(select({p:\"Ref\"},est(\"Jean\",\"Nom\",variable(\"p\")))));"}'
```

`GET /api/prompt` fournit un seul texte prêt à transmettre à l’agent. À chaque requête, le serveur relit `docs/agent-prompt.md`, `src/structure-langage-pour-ia.ts` et `src/lg-exemple executable.ts`, puis les assemble en instructions et annexes. La réponse est du texte UTF-8 avec `Cache-Control: no-store`. Les endpoints `/api/library` et `/api/examples` restent disponibles pour les usages séparés et la console.

Le prompt inclut l’URL absolue de `POST /api/agent/execute`, construite depuis le protocole et l’hôte de la requête reçue (port compris). Pour un service accessible derrière un proxy HTTPS ou sous un préfixe, définir par exemple `PUBLIC_URL=https://memoire.example/agent/` : l’URL insérée sera `https://memoire.example/agent/api/agent/execute`. Les en-têtes de proxy ne sont pas utilisés automatiquement. Sans cette option, charger le prompt à l’adresse par laquelle l’agent accède au service.

Les instructions expliquent le corps JSON `{source, mode, code}`, les primitives injectées, les modes de lecture et d’acquisition, le format de `output`, les erreurs et les limites. Les trois exemples JSON du guide sont directement exécutables ; les exemples TypeScript de l’annexe sont conservés tels quels et doivent être adaptés (suppression de l’import, remplacement de `console.log` par `print`). Le guide distingue la mémoire RAM de référence du runtime SQLite persistant et rappelle que les variables JavaScript ne survivent pas entre deux appels.

La console graphique utilise `POST /api/execute` avec `{code, mode}` ; cet endpoint n’ajoute aucune ligne à l’historique. L’agent utilise `POST /api/agent/execute` avec `{source, code, mode}` : `source` est le texte naturel de la demande ou du fragment de document traduit, et `code` sa traduction TypeScript. Chaque champ texte est limité à 60000 caractères, dans un corps JSON de 128 Ko maximum. Le mode vaut `read` par défaut. Le serveur n’effectue pas lui-même la traduction.

```json
{"source":"Quelles personnes sont enregistrées ?","mode":"read","code":"print(query(select({p:\"Ref\"},est(variable(\"p\"),\"Personne\"))));"}
```

Un appel agent accepté est inscrit dans `agent_calls` avant l’exécution. Son identifiant est renvoyé dans `callId`, y compris en cas d’erreur d’exécution. La table conserve `id`, `created_at`, `completed_at`, `source`, `code`, `mode`, `status` (`running`, `succeeded`, `failed`), `http_status`, `duration_ms` et `response` (JSON). Les erreurs et les délais dépassés sont historisés ; une annulation des écritures du script ne supprime pas l’historique. Les requêtes invalides et les refus HTTP 429 n’étant pas exécutés, ils ne créent pas de ligne. Les anciennes bases reçoivent automatiquement cette table au démarrage.

L’onglet **Historique agent** (`/#history`) affiche les appels récents, avec pagination et actualisation. Sélectionner une entrée montre le texte naturel complet, le code et la réponse. La table est aussi consultable dans **Base SQLite**. `GET /api/agent/calls?limit=25&offset=0` renvoie `{ok, calls, limit, offset, hasMore}` avec un aperçu de la source (limite maximale de 100 appels) ; `GET /api/agent/calls/:id` renvoie `{ok, call}`, avec `call: null` si l’identifiant est absent.

Le bouton **RAZ**, accessible en haut de la console, demande confirmation avant de vider **toutes les tables applicatives**, y compris les faits, références, compléments, index de valeurs, scripts enregistrés et appels de l’agent. L’API correspondante est `POST /api/database/reset` avec `{"confirm":"RAZ"}`. La suppression est une seule transaction ; une erreur annule l’ensemble. Le schéma et ses index sont conservés. La RAZ est refusée pendant une exécution ou une autre modification (HTTP 429). Le code encore ouvert dans Monaco est conservé comme brouillon ; les résultats, la liste des scripts et l’historique affichés sont actualisés. Ajouter le bouton ne déclenche aucune suppression automatique.

## Architecture
`structure-langage.ts` : types/helpers ; `runtime.ts` : compilateur SQL paramétré, stockage SQLite et hydratation ; `structure-langage-runtime.ts` : façade persistante ; `execute.ts` : interpréteur AST à liste blanche ; `server.ts` : API. Les identités sont des UUID ; comparer les IDs, pas l'identité JS après hydratation. Les programmes ne voient pas les tables. Les index SQL portent sur les prédicats et leurs arguments sérialisés. Les requêtes ne chargent pas toute la base en RAM, mais les domaines multiples peuvent encore produire des produits cartésiens ; optimiser le planificateur et mesurer sur un gros corpus. `not` = monde fermé. Comparaison structurelle exacte, sans alpha-équivalence ni inférence automatique. Pas de fusion batch ni d'index d'intervalles dans ce lot. Les getters globaux sont destinés au diagnostic, pas aux requêtes à grande échelle. Les exports mémoire globale sont des fonctions de lecture dans le runtime, et non des tableaux mutables. L'API exécute un sous-ensemble de TS (pas du code arbitraire). Le prompt permet au harnais externe de lire et traduire les documents ; aucun fournisseur LLM ni parseur PDF n'est intégré. L'agent appelle l'API depuis son propre harnais. Les transactions sont utilisées par l'API ; pour des écritures directes, utiliser transaction().

## Docker

```sh
docker build -t semantic-agent .
docker run --rm -p 127.0.0.1:3000:3000 -v semantic-memory:/app/data semantic-agent
```

## Console web

La page **Stockage SQLite**, accessible depuis la documentation ou à l’adresse `/docs/storage.html`, décrit les huit tables (`refs`, `compositions`, `phrases`, `Complement`, `primitive_values`, `fact_arguments`, `saved_scripts`, `agent_calls`), leurs colonnes et index, le format JSON et les transactions. Un exemple montre comment une information est enregistrée puis retrouvée.

L’onglet **Base SQLite** de la console (`/#database`) permet de consulter chaque table avec ses colonnes et son nombre de lignes. Cliquer sur une table prépare et exécute une requête de lecture. Le champ SQL accepte les requêtes `SELECT` et `WITH`, les filtres, jointures et fonctions JSON SQLite ; Ctrl+Entrée / Cmd+Entrée lance la requête. Les résultats sont paginés et copiables en JSON. **Actualiser** recharge les compteurs et les résultats après une acquisition. Le script TypeScript est conservé pendant les changements d’onglet.

Dans `compositions` et `phrases`, `name` est du texte brut : `WHERE name = 'Personne'` fonctionne directement. Les noms qualifiés sont séparés en `name` et `qualifier` (texte brut, ou SQL NULL pour un nom simple). Le runtime compare les deux colonnes pour préserver la distinction entre noms simples et qualifiés. Les arguments et les objets complets restent en JSON. Les anciennes bases sont migrées automatiquement à l’ouverture, en conservant les faits et leurs identifiants.

`POST /api/database/query` accepte par exemple `{"sql":"SELECT * FROM compositions;","limit":50,"offset":0}` et renvoie `columns`, `rows`, `limit`, `offset` et `hasMore`. La limite par défaut est de 100 lignes, avec un maximum de 1000. Les requêtes s’exécutent dans un processus séparé sur une connexion SQLite en lecture seule, avec un délai de 5 secondes et une taille de réponse limitée à 4 Mo. Les entiers hors de la plage exacte de JavaScript sont renvoyés sous forme de chaînes, et les BLOB en hexadécimal. Les huit tables sont initialisées au démarrage du serveur.

La page **Documentation API**, accessible depuis la console ou à l’adresse `/docs/`, affiche en lecture seule la source `structure-langage-pour-ia.ts` (`GET /api/library`), le prompt complet assemblé dynamiquement (`GET /api/prompt`) et les exemples (`GET /api/examples`). Les documents sont chargés directement depuis l’API et peuvent être actualisés, copiés ou téléchargés. Les liens `/docs/#library`, `/docs/#prompt` et `/docs/#examples` ouvrent directement le document choisi. Le lien de la console ouvre la documentation dans un nouvel onglet pour conserver le script en cours.

Ouvrir http://127.0.0.1:3000/ après le démarrage. L’éditeur permet d’exécuter les scripts sans import, en lecture seule (par défaut) ou en écriture (confirmation). Les sorties `print()` sont affichées séparément : tableaux pour les objets et collections homogènes, texte/JSON formaté sinon. Le JSON brut est consultable et copiable. Les exemples de l’API (`lg-exemple executable.ts`) sont chargeables dans l’éditeur : le chargement retire l’import et remplace `console.log` par `print` pour les primitives injectées. Ctrl+Entrée ou Cmd+Entrée lance le script.

Des cases à cocher accompagnent les références `{"$ref":"…"}` affichées dans la console, même imbriquées dans un objet ou une chaîne JSON, ainsi que les références `{"id":"…"}` retournées par l’exécuteur. Les commandes **Tout sélectionner**, **Tout désélectionner** et **Supprimer la sélection** agissent sur les références de la sortie courante. Les occurrences d’une même référence partagent leur sélection et sont comptées une seule fois. La sélection et la suppression sont désactivées en lecture seule. Revenir en lecture seule, effacer les résultats ou lancer une nouvelle exécution réinitialise la sélection et annule tout aperçu en attente.

Un aperçu compte les compositions et phrases concernées avant confirmation, sans doubler les faits partagés entre plusieurs références sélectionnées. La suppression groupée est une seule transaction : une erreur annule toute la sélection. L’index `fact_arguments` couvre les sujets, les arguments des compositions, les compléments et propositions imbriquées ; les références et valeurs devenues inutilisées sont ensuite nettoyées. Les autres faits et les scripts enregistrés sont conservés. Les compteurs de l’onglet SQLite sont actualisés ; le transcript reste une copie historique jusqu’à la prochaine lecture.

`POST /api/refs/preview` accepte `{"refIds":["id-1","id-2"]}`. `POST /api/refs/delete` exige `{"refIds":["id-1","id-2"],"mode":"write"}` ; un mode absent ou différent de `write` renvoie HTTP 403. Les routes individuelles `GET /api/refs/:id` et `DELETE /api/refs/:id` restent disponibles ; cette dernière exige également `{"mode":"write"}`.

`fact_arguments` contient un lien par fait et par référence ou valeur primitive distincte. Sa clé primaire `(type,value,fact_type,fact_id)` et l’index `(fact_type,fact_id,type,value)` évitent une recherche par sous-chaîne ou un parcours intégral des JSON lors des suppressions. Une migration construit automatiquement cet index pour les anciennes bases ; les écritures et suppressions restent transactionnelles.

Les scripts peuvent définir des fonctions synchrones avec `function`, des expressions `function` ou des fonctions fléchées. Les paramètres peuvent être typés, avoir une valeur par défaut ou utiliser `...rest`. Les fonctions acceptent `return`, `if/else`, les variables locales et les fermetures lexicales ; les opérations arithmétiques, comparaisons, conditions ternaires et affectations simples aux variables `let` sont disponibles. Par exemple :

```ts
function personnes() {
    return query(select({p: "Ref"}, est(variable("p"), "Personne")));
}
print(personnes());
```

L’exécuteur interprète ces fonctions et conserve les contrôles de lecture/écriture et les transactions, même lors d’appels par alias ou paramètre. Une erreur annule toutes les écritures de l’exécution. Le budget commun reste de 10000 instructions, avec une profondeur maximale de 128 appels. Les fonctions asynchrones, générateurs, boucles, paramètres déstructurés et méthodes natives arbitraires ne font pas partie de ce sous-ensemble TypeScript.

La console utilise toute la largeur de la fenêtre et l’éditeur Monaco prend la hauteur disponible sous ses commandes. Les boutons **Masquer / Afficher la sortie** et **Masquer / Afficher l’éditeur** contrôlent les deux panneaux indépendamment. Le panneau visible récupère toute la largeur lorsque l’autre est masqué ; le code, les résultats et l’onglet de fichier choisi sont conservés. Sur petit écran, les panneaux s’affichent verticalement.

L’éditeur utilise Monaco avec coloration, autocomplétion, signatures et diagnostics TypeScript. L’onglet `structure-langage-pour-ia.ts` affiche le fichier source en lecture seule et conserve le script lors des changements d’onglet. Les définitions de types du runtime persistant et celles des fonctions injectées (`query`, `print`, etc.) sont chargées dans les libs de Monaco pour une utilisation sans import. Monaco et ses workers sont servis localement, sans CDN. `npm run build` prépare aussi les fichiers de l’éditeur et génère les types depuis la librairie ; relancer cette commande après une modification de celle-ci.

Les suggestions s’ouvrent aussi dans les chaînes : les déclarations de `select`, `all` et `exists` proposent `"Ref"`, `"Phrase"`, `"string"`, `"number"`, `"boolean"` et `"complements"`. Dans `variable("…")`, l’éditeur propose les noms déclarés dans la portée courante, y compris ceux des quantificateurs englobants. Ctrl+Espace permet de rouvrir les suggestions manuellement.

Pour réutiliser un script, renseigner son nom puis cliquer sur **Enregistrer** (ou Ctrl+S / Cmd+S). Son nom, son code et son mode sont conservés sur le serveur dans la base `MEMORY_DB`, y compris après un redémarrage. Sélectionner un script dans **Scripts enregistrés**, cliquer sur **Charger**, puis sur **Exécuter le script** pour le rejouer. Charger ou enregistrer un script ne l’exécute pas ; un script en mode écriture demande toujours confirmation avant son exécution. **Enregistrer** met à jour le script chargé, y compris son nom ; **Nouveau** prépare un autre script. Un nom déjà utilisé par un autre script est refusé sans écraser son contenu. Les changements non enregistrés sont signalés avant de remplacer un script ou de quitter la page.

Le bouton **Cloner** enregistre une copie indépendante du script courant, avec son code (y compris les modifications non enregistrées) et son mode, puis la charge dans l’éditeur. Un nouveau nom est choisi automatiquement : « Nom — copie », « Nom — copie 2 », etc. Le script d’origine reste conservé. Un script sans nom est copié sous « Script — copie ». Le clonage n’exécute aucun code. Si vous modifiez le script pendant la création de la copie, ces nouvelles modifications restent dans l’éditeur et la copie est disponible dans la liste des scripts enregistrés.
