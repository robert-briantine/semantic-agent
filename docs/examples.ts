// Exemple d'acquisition (mode write, base de test vide).
const marie = new Ref();
const jean = new Ref();
const paul = new Ref();
addMemoryComposition('Marie','Nom',marie);
addMemoryComposition('Jean','Nom',jean);
addMemoryComposition('Paul','Nom',paul);
addMemoryComposition(marie,'Personne');
addMemoryComposition(jean,'Personne');
addMemoryComposition(paul,'Personne');
addMemoryComposition(32,'Age',marie);
addMemoryComposition(true,'Actif',marie);
// Les valeurs primitives sont récupérables avec leur type, sans créer de Ref.
print(query(select({nom:'string',age:'number',actif:'boolean'},and(
    est(variable('nom'),'Nom',marie),
    est(variable('age'),'Age',marie),
    est(variable('actif'),'Actif',marie)
))));
addMemoryPhrase(marie,'pense',all({p:'Ref',e:'Ref'},implies(and(est(variable('p'),'Parent'),est(variable('e'),'Enfant',variable('p'))),fait(variable('p'),'aime',variable('e')))));
addMemoryPhrase(marie,'dirige',paul);
addMemoryPhrase(paul,'dirige',jean);
addMemoryPhrase(paul,'affirme',['à',jean],fait(marie,'dirige',paul));
// Recherche de la hiérarchie indirecte.
print(query(select({p:'Ref'},exists({i:'Ref'},and(fait(variable('p'),'dirige',variable('i')),fait(variable('i'),'dirige',jean))))));
// Dans un autre appel, récupérer une identité existante avant de créer une Ref.
// const candidats = query(select({p:'Ref'},est('Jean','Nom',variable('p'))));
// print(candidats);
// Après vérification que le candidat est le bon : const jeanExistant = candidats[0].p;
// Recherche d'une croyance exacte (sans en déduire qu'elle est vraie).
print(query(select({p:'Ref'},fait(variable('p'),'pense',all({p:'Ref',e:'Ref'},implies(and(est(variable('p'),'Parent'),est(variable('e'),'Enfant',variable('p'))),fait(variable('p'),'aime',variable('e'))))))));

// Regrouper les requêtes dans des fonctions réutilisables.
function personnesNommees() {
    return query(select({p:'Ref',nom:'string'},and(
        est(variable('p'),'Personne'),
        est(variable('nom'),'Nom',variable('p'))
    )));
}
const nomsDe = (personne: Ref) => query(select({nom:'string'},est(variable('nom'),'Nom',personne)));
print(personnesNommees());
print(nomsDe(marie));
