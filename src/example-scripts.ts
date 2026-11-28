// Les helpers de ce fichier assemblent le catalogue à la compilation.
// Les scripts distribués ne définissent aucune fonction et sont autonomes.
type Scenario = { refs: string[]; setup: string };

const conditional: Scenario = {
    refs: ["jeu","alice","bob","chloe","denis"],
    setup: `addMemoryComposition(alice, "exemple", jeu);
addMemoryComposition(alice, "personne");
addMemoryComposition("Alice", "Nom", alice);
addMemoryComposition(bob, "exemple", jeu);
addMemoryComposition(bob, "personne");
addMemoryComposition("Bob", "Nom", bob);
addMemoryComposition(chloe, "exemple", jeu);
addMemoryComposition(chloe, "personne");
addMemoryComposition("Chloé", "Nom", chloe);
addMemoryComposition(denis, "exemple", jeu);
addMemoryComposition(denis, "personne");
addMemoryComposition("Denis", "Nom", denis);
addMemoryComposition(alice, "Actif");
addMemoryComposition(alice, "exclusion");
addMemoryComposition(bob, "Actif");
addMemoryComposition(chloe, "Invité");`
};

const general: Scenario = {
    refs: ["jeu","anaExemple","brunoExemple","claraExemple","objetExemple","tableExemple","bureauExemple"],
    setup: `addMemoryComposition(anaExemple, "exemple", jeu);
addMemoryComposition(anaExemple, "Responsable");
addMemoryComposition("Ana", "Nom", anaExemple);
addMemoryComposition(brunoExemple, "exemple", jeu);
addMemoryComposition(brunoExemple, "Membre");
addMemoryComposition("Bruno", "Nom", brunoExemple);
addMemoryComposition(claraExemple, "exemple", jeu);
addMemoryComposition(claraExemple, "Invité");
addMemoryComposition("Clara", "Nom", claraExemple);
addMemoryComposition(anaExemple, "Actif");
addMemoryComposition(brunoExemple, "Actif");
addMemoryComposition(objetExemple, "Rapport");
addMemoryComposition("Rapport pédagogique", "Nom", objetExemple);
addMemoryComposition(tableExemple, "Table");
addMemoryComposition("Table pédagogique", "Nom", tableExemple);
addMemoryComposition(bureauExemple, "Bureau");
addMemoryComposition("Bureau pédagogique", "Nom", bureauExemple);
addMemoryPhrase(anaExemple, "salue");
addMemoryPhrase(anaExemple, "aide", brunoExemple);
addMemoryPhrase(brunoExemple, "envoie", objetExemple, ["à", claraExemple]);
addMemoryPhrase(anaExemple, "pose", objetExemple, ["sur", tableExemple]);
addMemoryPhrase(anaExemple, "prépare", objetExemple, ["pour", claraExemple], ["avec", brunoExemple]);
addMemoryPhrase(brunoExemple, "transmet", objetExemple, ["depuis", bureauExemple]);`
};

const complex: Scenario = {
    refs: ["jeu","nora","omar","lea","zoe","hugo","atlas","boreal","avancement","budget","bureau","document"],
    setup: `addMemoryComposition(nora, "exemple", jeu);
addMemoryComposition(nora, "personne");
addMemoryComposition("Nora", "nom", nora);
addMemoryComposition(omar, "exemple", jeu);
addMemoryComposition(omar, "personne");
addMemoryComposition("Omar", "nom", omar);
addMemoryComposition(lea, "exemple", jeu);
addMemoryComposition(lea, "personne");
addMemoryComposition("Léa", "nom", lea);
addMemoryComposition(zoe, "exemple", jeu);
addMemoryComposition(zoe, "personne");
addMemoryComposition("Zoé", "nom", zoe);
addMemoryComposition(hugo, "exemple", jeu);
addMemoryComposition(hugo, "personne");
addMemoryComposition("Hugo", "nom", hugo);
addMemoryComposition(nora, "responsable");
addMemoryComposition(omar, "collaborateur");
addMemoryComposition(lea, "collaborateur");
addMemoryComposition(zoe, "invité");
addMemoryComposition(hugo, "invité");
addMemoryComposition(zoe, "exclusion");
addMemoryComposition(42, "âge", omar);
addMemoryComposition(0, "retard", omar);
addMemoryComposition(false, "disponibilité", omar);
addMemoryComposition(3, "retard", lea);
addMemoryComposition(true, "disponibilité", lea);
addMemoryComposition(atlas, "exemple", jeu);
addMemoryComposition(atlas, "projet");
addMemoryComposition("Atlas", "nom", atlas);
addMemoryComposition(boreal, "exemple", jeu);
addMemoryComposition(boreal, "projet");
addMemoryComposition("Boréal", "nom", boreal);
addMemoryComposition(avancement, "exemple", jeu);
addMemoryComposition(avancement, "rapport");
addMemoryComposition("Avancement", "nom", avancement);
addMemoryComposition(budget, "exemple", jeu);
addMemoryComposition(budget, "rapport");
addMemoryComposition("Budget", "nom", budget);
addMemoryComposition(bureau, "exemple", jeu);
addMemoryComposition(bureau, "bureau");
addMemoryComposition("Lyon", "nom", bureau);
addMemoryComposition(document, "exemple", jeu);
addMemoryComposition(document, "document");
addMemoryComposition("Pilotage", "nom", document);
addMemoryPhrase(nora, "dirige", omar);
addMemoryPhrase(nora, "dirige", lea);
addMemoryPhrase(omar, "rédige", avancement);
addMemoryPhrase(lea, "rédige", budget);
addMemoryPhrase(avancement, "concerne", atlas);
addMemoryPhrase(budget, "concerne", boreal);
addMemoryPhrase(nora, "valide", avancement);
addMemoryPhrase(omar, "participe", ["à", atlas]);
addMemoryPhrase(lea, "participe", ["à", boreal]);
addMemoryPhrase(nora, "préparait", budget);
addMemoryPhrase(nora, "prépare", avancement, ["pour", omar], ["avec", lea], ["depuis", bureau],
    ["parce que", phrase(omar, "demande", avancement)]);
addMemoryPhrase(omar, "pense", phrase(nora, "valide", budget), ["dans", document]);
addMemoryPhrase(zoe, "affirme", not(phrase(nora, "valide", budget)), ["dans", document]);`
};

function autonomous(scenario: Scenario | undefined, description: string, query: string): string {
    const header = '// Script autonome et idempotent : aucune préparation préalable.\n' + description;
    if (!scenario) return header + '\n' + query;
    return header + '\n// Le jeu privé isole la démonstration des données déjà présentes.\n'
        + scenario.refs.map(ref => 'const ' + ref + ' = new Ref();').join('\n')
        + '\ntry {\n' + (scenario.setup + '\n\n// Afficher le résultat avant de nettoyer.\n' + query).split('\n').map(line => line ? '    ' + line : '').join('\n')
        + '\n} finally {\n    // Nettoyer uniquement les références créées par ce script, même en cas d’erreur.\n    deleteReferences([' + scenario.refs.join(', ') + ']);\n}';
}

// Identifiants stables : les redémarrages mettent à jour les exemples sans les dupliquer.
export const exampleScripts = [
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f001",
        name: "Exemple switchCase — 1. Insertion",
        mode: "write",
        code: autonomous(conditional, `// Résultat attendu : Alice, Bob, Chloé et Denis.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f002",
        name: "Exemple switchCase — 2. Requête",
        mode: "write",
        code: autonomous(conditional, `// Résultat attendu : Bob et Chloé (l'ordre des lignes peut varier).
// Alice est exclue dès le premier cas : false ne passe pas au cas suivant.
// Chloé et Denis atteignent le défaut : seul le statut Invité les départage.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), switchCase([
    implies(composition(variable("p"), "exclusion"), false),
    implies(composition(variable("p"), "Actif"), true)
], composition(variable("p"), "Invité")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f003",
        name: "Exemple expressions — 00. Insertion",
        mode: "write",
        code: autonomous(general, `// Source fictive : Ana est active et responsable, Bruno actif et membre, Clara invitée.
// Traductions : « Ana salue. » et « Ana aide Bruno. »
// Source : « Bruno envoie un rapport à Clara. »
// Le rapport est direct ; seule la préposition « à » introduit le destinataire.
// Source : « Ana pose le rapport sur une table. »
// Source : « Ana prépare le rapport pour Clara avec Bruno. »
// Source : « Bruno transmet le rapport depuis un bureau. »`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), true)))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f004",
        name: "Exemple expressions — 01. Booléens",
        mode: "read",
        code: autonomous(undefined, `// Sans données requises : true renvoie [{}] et false renvoie [].`, `print(query(select({}, true)));
print(query(select({}, false)));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f005",
        name: "Exemple expressions — 02. composition — compositions",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana et Bruno, qui sont Actif. Nom relie une chaîne à une personne.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), composition(variable("p"), "Actif"))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f006",
        name: "Exemple expressions — 03. phrase — phrases",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana, qui salue (phrase sans complément).`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), phrase(variable("p"), "salue"))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f007",
        name: "Exemple expressions — 04. eq — égalité",
        mode: "write",
        code: autonomous(general, `// Résultats attendus : Ana, puis [{}] (42 = 42), puis [] (false ≠ true).`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), eq(variable("nom"), "Ana"))))));
print(query(select({}, eq(42, 42))));
print(query(select({}, eq(false, true))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f008",
        name: "Exemple expressions — 05. not — négation",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Clara. not est vrai si le phrase Actif est absent (monde fermé).`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), not(composition(variable("p"), "Actif")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f009",
        name: "Exemple expressions — 06. and — conjonction",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana. Les deux conditions doivent être vraies.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), and(composition(variable("p"), "Actif"), composition(variable("p"), "Responsable")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f010",
        name: "Exemple expressions — 07. or — disjonction",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana et Clara. Au moins une des deux conditions doit être vraie.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), or(composition(variable("p"), "Responsable"), composition(variable("p"), "Invité")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f011",
        name: "Exemple expressions — 08. implies — implication",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana et Clara. Actif implique Responsable ; Clara est retenue car non active.
// Une implication teste une proposition ; elle ne crée aucun phrase en mémoire.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), implies(composition(variable("p"), "Actif"), composition(variable("p"), "Responsable")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f012",
        name: "Exemple expressions — 09. contient — compléments",
        mode: "write",
        code: autonomous(general, `// Question : « Qui envoie un rapport, et à qui ? » Résultat : Bruno, le rapport et Clara.`, `print(query(select({ nom: "string", objet: "string", destinataire: "string" }, exists({ p: "Ref", c: "complements", rapport: "Ref", personne: "Ref" }, and(
    composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")),
    phrase(variable("p"), "envoie", variable("c")), contient(variable("c"), variable("rapport")),
    composition(variable("rapport"), "Rapport"), composition(variable("objet"), "Nom", variable("rapport")),
    contient(variable("c"), ["à", variable("personne")]), composition(variable("destinataire"), "Nom", variable("personne"))
)))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f013",
        name: "Exemple expressions — 10. all — pour tout",
        mode: "write",
        code: autonomous(general, `// Résultats attendus : [{}] (tous actifs ou invités), puis [] (Clara n’est pas active).
// p est une variable locale au quantificateur. Sur un domaine vide, all est vrai.`, `print(query(select({}, all({ p: "Ref" }, implies(composition(variable("p"), "exemple", jeu), or(composition(variable("p"), "Actif"), composition(variable("p"), "Invité")))))));
print(query(select({}, all({ p: "Ref" }, implies(composition(variable("p"), "exemple", jeu), composition(variable("p"), "Actif"))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f014",
        name: "Exemple expressions — 11. exists — il existe",
        mode: "write",
        code: autonomous(general, `// Résultat attendu : Ana, qui aide au moins une autre personne de l’exemple.
// autre est locale à exists : elle n’apparaît pas dans les colonnes du résultat.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), exists({ autre: "Ref" }, and(composition(variable("autre"), "exemple", jeu), phrase(variable("p"), "aide", variable("autre")))))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f015",
        name: "Exemple expressions — 12. Prépositions — sur, pour, avec, depuis",
        mode: "write",
        code: autonomous(general, `// Questions : « Qui pose un rapport sur une table ? Qui le prépare pour Clara avec Bruno ? Qui le transmet depuis un bureau ? » Résultats : Ana, Ana, Bruno.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), exists({ rapport: "Ref", table: "Ref" }, and(composition(variable("rapport"), "Rapport"), composition(variable("table"), "Table"), phrase(variable("p"), "pose", variable("rapport"), ["sur", variable("table")]))))))));
print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), exists({ rapport: "Ref", destinataire: "Ref", compagnon: "Ref" }, and(composition(variable("rapport"), "Rapport"), composition("Clara", "Nom", variable("destinataire")), composition("Bruno", "Nom", variable("compagnon")), phrase(variable("p"), "prépare", variable("rapport"), ["pour", variable("destinataire")], ["avec", variable("compagnon")]))))))));
print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "Nom", variable("p")), exists({ rapport: "Ref", bureau: "Ref" }, and(composition(variable("rapport"), "Rapport"), composition(variable("bureau"), "Bureau"), phrase(variable("p"), "transmet", variable("rapport"), ["depuis", variable("bureau")]))))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f016",
        name: "Exemple traductions complexes — 00. Insertion",
        mode: "write",
        code: autonomous(complex, `// « Nora est responsable ; Omar et Léa sont collaborateurs ; Zoé et Hugo sont invités. »
// « Zoé est exclue. Omar a 42 ans, aucun retard et n'est pas disponible. Léa est disponible et son retard vaut 3. »
// « Nora dirige Omar et Léa. Omar rédige Avancement, qui concerne Atlas.
// Léa rédige Budget, qui concerne Boréal. Nora valide Avancement. »
// « Omar participe au projet Atlas ; Léa participe au projet Boréal. » au → à.
// « Nora préparait Budget. Elle prépare maintenant Avancement pour Omar,
// avec Léa, depuis le bureau de Lyon, parce qu'Omar demande Avancement. »
// Le rapport est direct ; les liens naturels sont conservés ; le temps verbal reste distinct.
// « Le document Pilotage rapporte qu'Omar pense que Nora valide Budget,
// tandis que Zoé affirme que Nora ne valide pas Budget. »
// Conserver auteur et provenance. Ces contenus ne deviennent pas des faits indépendants.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f017",
        name: "Exemple traductions complexes — 01. Jointures et relatives",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Qui dirige une personne qui rédige un rapport concernant le projet Atlas ?
// Traduction : Les deux relatives partagent leurs références : responsable → collaborateur → rapport → projet.
// Résultat attendu : Nora.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")), exists({ collaborateur: "Ref", rapport: "Ref" }, and(phrase(variable("p"), "dirige", variable("collaborateur")), phrase(variable("collaborateur"), "rédige", variable("rapport")), composition(variable("rapport"), "rapport"), phrase(variable("rapport"), "concerne", atlas))))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f018",
        name: "Exemple traductions complexes — 02. Compléments multiples et cause",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Qui prépare Avancement pour Omar, avec Léa, depuis le bureau de Lyon, parce qu’Omar le demande ? La demande est-elle aussi mémorisée séparément ?
// Traduction : Lier la liste complète puis filtrer chaque complément. La cause est une proposition imbriquée.
// Résultat attendu : Nora, puis [] : la demande imbriquée est stockée dans son contexte, sans affirmation indépendante.`, `const rapport = avancement;
print(query(select({ nom: "string" }, exists({ p: "Ref", c: "complements" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "nom", variable("p")), phrase(variable("p"), "prépare", variable("c")), contient(variable("c"), rapport), contient(variable("c"), ["pour", omar]), contient(variable("c"), ["avec", lea]), contient(variable("c"), ["depuis", bureau]), contient(variable("c"), ["parce que", phrase(omar, "demande", rapport)]))))));
print(query(select({}, phrase(omar, "demande", rapport))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f019",
        name: "Exemple traductions complexes — 03. Croyances et provenance",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : D’après Pilotage, qui pense que Nora valide Budget ? Qui affirme le contraire ? La validation est-elle établie ?
// Traduction : Chercher les contenus attribués, la négation et la Ref du document ; ne pas confondre croyance et phrase.
// Résultat attendu : Omar, puis Zoé, puis [] pour la validation indépendante.`, `print(query(select({ nom: "string" }, exists({ p: "Ref", c: "complements" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "nom", variable("p")), phrase(variable("p"), "pense", variable("c")), contient(variable("c"), phrase(nora, "valide", budget)), contient(variable("c"), ["dans", document]))))));
print(query(select({ nom: "string" }, exists({ p: "Ref", c: "complements" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "nom", variable("p")), phrase(variable("p"), "affirme", variable("c")), contient(variable("c"), not(phrase(nora, "valide", budget))), contient(variable("c"), ["dans", document]))))));
print(query(select({}, phrase(nora, "valide", budget))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f020",
        name: "Exemple traductions complexes — 04. Tous les collaborateurs ou un seul",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Quels responsables valident tous les rapports de tous leurs collaborateurs ? Lesquels ont au moins un collaborateur dont tous les rapports sont validés ?
// Traduction : Placer exists et all à la bonne portée ; exiger un collaborateur et un rapport pour éviter une vérité sur un domaine vide.
// Résultat attendu : [], puis Nora : le rapport d’Omar est validé, celui de Léa ne l’est pas.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")), and(composition(variable("p"), "responsable"), exists({ c: "Ref", r: "Ref" }, and(composition(variable("c"), "collaborateur"), composition(variable("r"), "rapport"), phrase(variable("p"), "dirige", variable("c")), phrase(variable("c"), "rédige", variable("r")))), all({ c: "Ref", r: "Ref" }, implies(and(composition(variable("c"), "collaborateur"), composition(variable("r"), "rapport"), phrase(variable("p"), "dirige", variable("c")), phrase(variable("c"), "rédige", variable("r"))), phrase(variable("p"), "valide", variable("r"))))))))));
print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")), and(composition(variable("p"), "responsable"), exists({ c: "Ref" }, and(composition(variable("c"), "collaborateur"), phrase(variable("p"), "dirige", variable("c")), exists({ r: "Ref" }, and(composition(variable("r"), "rapport"), phrase(variable("c"), "rédige", variable("r")))), all({ r: "Ref" }, implies(and(composition(variable("r"), "rapport"), phrase(variable("c"), "rédige", variable("r"))), phrase(variable("p"), "valide", variable("r"))))))))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f021",
        name: "Exemple traductions complexes — 05. Portée de pour tout et il existe",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Chaque collaborateur participe-t-il à un projet ? Existe-t-il un même projet auquel tous participent ?
// Traduction : Chaque personne peut avoir son propre projet (all puis exists), ce qui diffère d’un projet partagé (exists puis all).
// Résultat attendu : [{}], puis [] : Omar participe à Atlas et Léa à Boréal.`, `print(query(select({}, and(exists({ c: "Ref" }, and(composition(variable("c"), "exemple", jeu), composition(variable("c"), "collaborateur"))), all({ c: "Ref" }, implies(and(composition(variable("c"), "exemple", jeu), composition(variable("c"), "collaborateur")), exists({ projet: "Ref" }, and(composition(variable("projet"), "projet"), phrase(variable("c"), "participe", ["à", variable("projet")])))))))));
print(query(select({}, exists({ projet: "Ref" }, and(composition(variable("projet"), "projet"), all({ c: "Ref" }, implies(and(composition(variable("c"), "exemple", jeu), composition(variable("c"), "collaborateur")), phrase(variable("c"), "participe", ["à", variable("projet")]))))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f022",
        name: "Exemple traductions complexes — 06. Absence et négation attribuée",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Quels rapports n’ont pas de validation enregistrée par Nora ? Qui affirme que Nora ne valide pas Budget ?
// Traduction : not applique le monde fermé ; l’affirmation négative de Zoé est un autre phrase, attribué à son auteur.
// Résultat attendu : Budget, puis Zoé. L’absence de validation ne prouve pas une négation dans le monde réel.`, `print(query(select({ nom: "string" }, exists({ rapport: "Ref" }, and(composition(variable("rapport"), "exemple", jeu), composition(variable("rapport"), "rapport"), composition(variable("nom"), "nom", variable("rapport")), not(phrase(nora, "valide", variable("rapport"))))))));
print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")), phrase(variable("p"), "affirme", not(phrase(nora, "valide", budget)), ["dans", document]))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f023",
        name: "Exemple traductions complexes — 07. Décision avec exceptions prioritaires",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Les exclus sont refusés. Les responsables sont acceptés. Les collaborateurs doivent être disponibles et sans retard. Sinon seuls les invités sont acceptés.
// Traduction : L’exclusion est le premier cas ; un résultat false arrête le switch. Le défaut traite les invités.
// Résultat attendu : Hugo et Nora. Zoé est exclue ; Omar est indisponible ; Léa a un retard.`, `print(query(select({ nom: "string" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("p"), "personne"), composition(variable("nom"), "nom", variable("p")), switchCase([
    implies(composition(variable("p"), "exclusion"), false),
    implies(composition(variable("p"), "responsable"), true),
    implies(composition(variable("p"), "collaborateur"), and(composition(true, "disponibilité", variable("p")), composition(0, "retard", variable("p"))))
], composition(variable("p"), "invité")))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f024",
        name: "Exemple traductions complexes — 08. Propriétés typées, zéro et false",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Qui a 42 ans, zéro retard et une disponibilité égale à false ?
// Traduction : Les chaînes descriptives et valeurs primitives sont des compositions ; zéro et false sont des valeurs, pas des absences.
// Résultat attendu : Omar avec âge 42, retard 0 et disponibilité false.`, `print(query(select({ nom: "string", age: "number", retard: "number", disponible: "boolean" }, exists({ p: "Ref" }, and(composition(variable("p"), "exemple", jeu), composition(variable("nom"), "nom", variable("p")), composition(variable("age"), "âge", variable("p")), eq(variable("age"), 42), composition(variable("retard"), "retard", variable("p")), eq(variable("retard"), 0), composition(variable("disponible"), "disponibilité", variable("p")), eq(variable("disponible"), false))))));`)
    },
    {
        id: "34051f3e-b387-4adb-928d-d0d384a1f025",
        name: "Exemple traductions complexes — 09. Conserver le temps verbal",
        mode: "write",
        code: autonomous(complex, `// Texte naturel : Quel rapport Nora préparait-elle ? Quel rapport prépare-t-elle maintenant ?
// Traduction : Conserver préparait et prépare. Les noms de prédicats sont comparés exactement, sans changement de temps implicite.
// Résultat attendu : Budget pour préparait, puis Avancement pour prépare.`, `print(query(select({ nom: "string" }, exists({ rapport: "Ref" }, and(composition(variable("rapport"), "rapport"), composition(variable("nom"), "nom", variable("rapport")), phrase(nora, "préparait", variable("rapport")))))));
print(query(select({ nom: "string" }, exists({ rapport: "Ref", c: "complements" }, and(composition(variable("rapport"), "rapport"), composition(variable("nom"), "nom", variable("rapport")), phrase(nora, "prépare", variable("c")), contient(variable("c"), variable("rapport")))))));`)
    },
] as const;

// La console et l’agent reçoivent exactement les mêmes scripts autonomes.
export function renderExampleScripts(): string {
    const imports = 'import { Ref, variable, composition, phrase, contient, all, exists, and, or, not, implies, switchCase, eq, select, query, addMemoryPhrase, addMemoryComposition, deleteReferences, print } from "./structure-langage-pour-ia";';
    const sections = exampleScripts.map(script => '// ' + script.name + '\n// Mode : ' + script.mode + '. Chaque bloc représente un appel indépendant.\n{\n' + script.code + '\n}');
    return '// Fichier généré depuis src/example-scripts.ts par scripts/build-examples.cjs.\n'
        + '// Chaque exemple prépare ses données, affiche son résultat puis supprime ses données.\n'
        + '// Données fictives : choisir un bloc et adapter la traduction à la demande réelle.\n'
        + imports + '\n\n' + sections.join('\n\n') + '\n';
}
