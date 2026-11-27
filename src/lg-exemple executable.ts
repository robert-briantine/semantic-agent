import {
    addMemoryComposition,
    addMemoryPhrase,
    Ref,
    quantification,
    query,
    select,
    and,
    est,
    variable,
    all,
    implies,
    fait,
    Phrase,
    not,
    eq,
    exists,
    Expression
} from "./structure-langage-pour-ia"


// Tous les hommes sont mortels

addMemoryPhrase(undefined, "pense", quantification([
    "all", { h2: "Ref" },
    ["=>",
        ["est", ["var", "h2"], "Homme"],
        ["est", ["var", "h2"], "Mortel"]
    ]
]))


// Il existe des hommes qui sont mortels

const newRef = new Ref()
addMemoryComposition(newRef, "Homme")
addMemoryComposition(newRef, "Mortel")


// Une voiture roule sur l'autoroute à côté de chez moi

const v = new Ref()
const a = new Ref()
const cm = new Ref()
const moi = new Ref()

addMemoryComposition(v, "Voiture")
addMemoryComposition(a, ["Autoroute", "à cote"], cm)
addMemoryComposition(cm, "Habitation", moi)

addMemoryPhrase(v, "roule", ["sur", a])


// Jean pense que tous les chats aiment dormir

const p = new Ref()
const action = new Ref()

addMemoryComposition("Jean", "Nom", p)
addMemoryComposition(action, "Action")
addMemoryComposition("dormir", "Nom", action)

addMemoryPhrase(p, "pense", quantification([
    "all", { c: "Ref" },
    ["=>",
        ["est", ["var", "c"], "Chat"],
        ["fait", ["var", "c"], "aime", action]
    ]
]))


// Le président de la France est Toto le Buc

const pr = new Ref()
const pays = new Ref()

addMemoryComposition(pays, "Pays")
addMemoryComposition("France", "Nom", pays)
addMemoryComposition(pr, "President", pays)
addMemoryComposition("Toto le Buc", "Nom", pr)


// Toutes les voitures qui roulent sur cette autoroute
// roulent très vite

const autoroute = new Ref()
const m = new Ref()

addMemoryComposition(autoroute, "Autoroute")

addMemoryPhrase(m, "pense", quantification([
    "all", { v: "Ref" },
    ["=>",
        ["and",
            ["est", ["var", "v"], "Voiture"],
            ["fait", ["var", "v"], "roule", ["sur", autoroute]]
        ],
        ["fait", ["var", "v"], ["roule", "très vite"], ["sur", autoroute]]
    ]
]))


// La majorité des gens ne sont pas racistes

const ensemble = new Ref()
const type = new Ref()

addMemoryComposition("Personne", "Nom", type)
addMemoryComposition(ensemble, "Ensemble")
addMemoryComposition(type, "Type", ensemble)
addMemoryComposition(ensemble, "Majorité")

addMemoryPhrase(undefined, "pense", quantification([
    "all", { r: "Ref" },
    ["=>",
        ["est", ["var", "r"], "Element", ensemble],
        ["not",
            ["est", ["var", "r"], "Raciste"]
        ]
    ]
]))


// La plupart des gens ne sont pas racistes

const plupart = new Ref()
const ensembleBis = new Ref()
const typeBis = new Ref()

addMemoryComposition("quantificatrice", "Valeur", plupart)
addMemoryComposition("Plupart", "Nom", plupart)

addMemoryComposition("Personne", "Nom", typeBis)
addMemoryComposition(ensembleBis, "Ensemble")
addMemoryComposition(typeBis, "Type", ensembleBis)

addMemoryComposition(
    plupart,
    ["Locution", "déterminative"],
    ensembleBis
)

addMemoryPhrase(undefined, "pense", quantification([
    "all", { r: "Ref" },
    ["=>",
        ["est", ["var", "r"], "Element", ensembleBis],
        ["not",
            ["est", ["var", "r"], "Raciste"]
        ]
    ]
]))


// Tous les hommes sont mortels

const proposition = all(
    { h: "Ref" },
    implies(
        est(variable("h"), "Homme"),
        est(variable("h"), "Mortel")
    )
)

addMemoryPhrase(undefined, "pense", proposition)


// Jean pense que tous les hommes sont mortels

const jean = new Ref()

addMemoryComposition("Jean", "Nom", jean)

addMemoryPhrase(jean, "pense", proposition)


// Socrate est un homme mortel

const socrate = new Ref()

addMemoryComposition("Socrate", "Nom", socrate)
addMemoryComposition(socrate, "Homme")
addMemoryComposition(socrate, "Mortel")


// Rechercher tous les hommes mortels

const hommesMortels = query(
    select(
        { h: "Ref" },
        and(
            est(variable("h"), "Homme"),
            est(variable("h"), "Mortel")
        )
    )
)

console.log(hommesMortels)


// Rechercher les individus qui pensent
// que tous les hommes sont mortels

const croyances = query(
    select(
        { p: "Ref" },
        fait(variable("p"), "pense", proposition)
    )
)

console.log(croyances)
// ======================================================
// 1. Deux personnes ont des croyances contradictoires
// ======================================================


const paul = new Ref()
const terre = new Ref()

addMemoryComposition("Jean", "Nom", jean)
addMemoryComposition("Paul", "Nom", paul)
addMemoryComposition("Terre", "Nom", terre)
addMemoryComposition(jean, "Personne")
addMemoryComposition(paul, "Personne")

// Jean pense que la Terre est ronde

addMemoryPhrase(jean, "pense",
    est(terre, "Ronde")
)

// Paul pense que la Terre n'est pas ronde

addMemoryPhrase(paul, "pense",
    not(est(terre, "Ronde"))
)

// Rechercher les personnes qui pensent que la Terre est ronde

const croyanceTerre = query(
    select({ p: "Ref" },
        fait(variable("p"), "pense",
            est(terre, "Ronde")
        )
    )
)


// ======================================================
// 2. Une croyance portant sur une autre croyance
// ======================================================

// Jean pense que Paul croit que la Terre est ronde

addMemoryPhrase(jean, "pense",
    fait(paul, "croit",
        est(terre, "Ronde")
    )
)

// Rechercher les personnes qui pensent que Paul
// croit que la Terre est ronde

const croyanceImbriquee = query(
    select({ p: "Ref" },
        fait(variable("p"), "pense",
            fait(paul, "croit",
                est(terre, "Ronde")
            )
        )
    )
)


// ======================================================
// 3. Communication d'une information
// ======================================================

const marie = new Ref()
const voiture = new Ref()

addMemoryComposition("Marie", "Nom", marie)
addMemoryComposition(marie, "Personne")
addMemoryComposition(voiture, "Voiture")

// Marie affirme à Jean que Paul possède une voiture

addMemoryPhrase(marie, "affirme",
    ["à", jean],
    fait(paul, "possède", voiture)
)

// Rechercher qui a affirmé à Jean que Paul
// possède cette voiture

const sourceInformation = query(
    select({ p: "Ref" },
        fait(variable("p"), "affirme",
            ["à", jean],
            fait(paul, "possède", voiture)
        )
    )
)


// ======================================================
// 4. Une règle générale portant sur plusieurs individus
// ======================================================
// Marie pense que tous les parents aiment leurs enfants

addMemoryPhrase(marie, "pense",
    all({ p: "Ref", e: "Ref" },
        implies(
            and(
                est(variable("p"), "Parent"),
                est(variable("e"), "Enfant", variable("p"))
            ),
            fait(variable("p"), "aime", variable("e"))
        )
    )
)

// Marie est la mère de Luc

const luc = new Ref()

addMemoryComposition("Luc", "Nom", luc)
addMemoryComposition(luc, "Personne")
addMemoryComposition(luc, "Enfant", marie)
addMemoryComposition(marie, "Mère", luc)

// Rechercher toutes les relations parent-enfant

const parentsEnfants = query(
    select({ p: "Ref", e: "Ref" },
        est(variable("e"), "Enfant", variable("p"))
    )
)


// ======================================================
// 5. Quantifications imbriquées
// ======================================================

// Jean pense que chaque personne aime au moins une personne

const existenceAmour = [
    "all", { p: "Ref" },
    implies(
        est(variable("p"), "Personne"),
        [
            "exists", { e: "Ref" },
            and(
                est(variable("e"), "Personne"),
                fait(variable("p"), "aime", variable("e"))
            )
        ]
    )
] satisfies Expression

addMemoryPhrase(jean, "pense", existenceAmour)

// Rechercher les personnes qui partagent cette croyance

const croyanceAmour = query(
    select({ p: "Ref" },
        fait(variable("p"), "pense", existenceAmour)
    )
)


// ======================================================
// 6. Raisonnement sur les intentions
// ======================================================

const maison = new Ref()

addMemoryComposition(maison, "Maison")

// Paul souhaite acheter une maison,
// mais Jean souhaite que Paul ne l'achète pas

addMemoryPhrase(paul, "souhaite",
    fait(paul, "acheter", maison)
)

addMemoryPhrase(jean, "souhaite",
    not(fait(paul, "acheter", maison))
)

// Rechercher les personnes qui souhaitent
// que Paul n'achète pas cette maison

const oppositionAchat = query(
    select({ p: "Ref" },
        fait(variable("p"), "souhaite",
            not(fait(paul, "acheter", maison))
        )
    )
)


// ======================================================
// 7. Relations entre entreprises et employés
// ======================================================

const entreprise = new Ref()
const informatique = new Ref()
const comptabilite = new Ref()

addMemoryComposition(entreprise, "Entreprise")
addMemoryComposition("Entreprise ABC", "Nom", entreprise)

addMemoryComposition(informatique, "Service", entreprise)
addMemoryComposition(comptabilite, "Service", entreprise)

addMemoryComposition("Informatique", "Nom", informatique)
addMemoryComposition("Comptabilité", "Nom", comptabilite)

addMemoryComposition(jean, "Employé", entreprise)
addMemoryComposition(paul, "Employé", entreprise)
addMemoryComposition(marie, "Employé", entreprise)

addMemoryPhrase(jean, "travaille", ["dans", informatique])
addMemoryPhrase(paul, "travaille", ["dans", informatique])
addMemoryPhrase(marie, "travaille", ["dans", comptabilite])

// Rechercher les personnes travaillant dans le même service

const collegues = query(
    select({ p1: "Ref", p2: "Ref", s: "Ref" },
        and(
            est(variable("s"), "Service", entreprise),
            fait(variable("p1"), "travaille",
                ["dans", variable("s")]
            ),
            fait(variable("p2"), "travaille",
                ["dans", variable("s")]
            ),
            not(eq(variable("p1"), variable("p2")))
        )
    )
)


// ======================================================
// 8. Rechercher une relation indirecte
// ======================================================

const directeur = new Ref()
const responsable = new Ref()

addMemoryComposition(directeur, "Personne")
addMemoryComposition(responsable, "Personne")

addMemoryPhrase(directeur, "dirige", responsable)
addMemoryPhrase(responsable, "dirige", jean)

// Rechercher les personnes qui dirigent indirectement Jean

const hierarchie = query(
    select({ p: "Ref" },
        exists({ i: "Ref" },
            and(
                fait(variable("p"), "dirige", variable("i")),
                fait(variable("i"), "dirige", jean)
            )
        )
    )
)


// ======================================================
// 9. Rechercher les connaissances contradictoires
// ======================================================

// Rechercher les couples de personnes ayant
// des croyances opposées sur la forme de la Terre

const contradictions = query(
    select({ p1: "Ref", p2: "Ref" },
        and(
            fait(variable("p1"), "pense",
                est(terre, "Ronde")
            ),
            fait(variable("p2"), "pense",
                not(est(terre, "Ronde"))
            ),
            not(eq(variable("p1"), variable("p2")))
        )
    )
)


// ======================================================
// 10. Une personne ignore ce qu'une autre personne sait
// ======================================================

const document = new Ref()

addMemoryComposition(document, "Document")
addMemoryComposition(document, "Confidentiel")

// Paul sait que le document est confidentiel

addMemoryPhrase(paul, "sait",
    est(document, "Confidentiel")
)

// Jean ignore que Paul sait que le document est confidentiel

addMemoryPhrase(jean, "ignore",
    fait(paul, "sait",
        est(document, "Confidentiel")
    )
)

// Rechercher les personnes qui ignorent cette connaissance

const ignorance = query(
    select({ p: "Ref" },
        fait(variable("p"), "ignore",
            fait(paul, "sait",
                est(document, "Confidentiel")
            )
        )
    )
)


// ======================================================
// 11. Une personne promet quelque chose sous condition
// ======================================================

const examen = new Ref()
const ordinateur = new Ref()

addMemoryComposition(examen, "Examen")
addMemoryComposition(ordinateur, "Ordinateur")

// Marie promet à Luc de lui offrir un ordinateur
// s'il réussit son examen

addMemoryPhrase(marie, "promet",
    ["à", luc],
    implies(
        fait(luc, "réussit", examen),
        fait(marie, "offrir", ordinateur, ["à", luc])
    )
)

// Rechercher qui a fait cette promesse à Luc

const promesses = query(
    select({ p: "Ref" },
        fait(variable("p"), "promet",
            ["à", luc],
            implies(
                fait(luc, "réussit", examen),
                fait(variable("p"), "offrir",
                    ordinateur, ["à", luc]
                )
            )
        )
    )
)


// ======================================================
// 12. Une personne interprète les motivations d'une autre
// ======================================================

// Jean pense que Paul souhaite acheter une maison
// parce qu'il souhaite impressionner Marie

addMemoryPhrase(jean, "pense",
    new Phrase(
        paul,
        "souhaite",
        [
            fait(paul, "acheter", maison),
            ["parce que",
                fait(paul, "souhaite",
                    fait(paul, "impressionner", marie)
                )
            ]
        ]
    )
)

// Rechercher les personnes qui attribuent
// cette motivation à Paul

const motivations = query(
    select({ p: "Ref" },
        fait(variable("p"), "pense",
            new Phrase(
                paul,
                "souhaite",
                [
                    fait(paul, "acheter", maison),
                    ["parce que",
                        fait(paul, "souhaite",
                            fait(paul, "impressionner", marie)
                        )
                    ]
                ]
            )
        )
    )
)