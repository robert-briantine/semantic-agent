import { collectPhrases, collectCompositions, normalizeFactTuples } from './phrase-storage';
import { validateVocabulary } from './vocabulary';
import { validateComplementUsage } from './validate-complements';

declare const refBrand: unique symbol;

export class Ref {
    declare protected readonly [refBrand]?: void;
}

// Types sémantiques

/**
 * Verbe français, avec ses formes conjuguées.
 * Représente une action, un état, un processus ou une relation.
 * Dans une phrase, privilégier une forme conjuguée adaptée au sujet et au texte.
 * Éviter de remplacer systématiquement le verbe par son infinitif.
 * Exemples : mange, travaille, possède, pense, devient.
 */
export type Verbe = string;

/**
 * Nom commun français au singulier.
 * Représente une entité, une catégorie, une propriété
 * ou un concept abstrait.
 * Ne pas inclure de déterminant.
 * Exemples : personne, voiture, âge, couleur, entreprise.
 */
export type NomCommun = string;

/**
 * Adjectif ou adverbe français.
 * Qualifie un nom commun ou précise le sens d'un verbe.
 * Utiliser le masculin singulier pour les adjectifs.
 * Exemples : grand, rouge, intelligent, rapidement.
 */
export type Qualificatif = string;

/**
 * Préposition ou locution prépositive française.
 * Définit la relation entre une action et son complément.
 * Ne pas inclure de déterminant ni de forme contractée.
 * Exemples : à, de, avec, pour, depuis, à cause de.
 */
export type Preposition = string;

// Variables

export type VariableTypes = {
    Ref: Ref;
    Phrase: Phrase;
    Composition: Composition;
    string: string;
    number: number;
    boolean: boolean;
    complements: Complements;
};
export type Variables = Record<string, keyof VariableTypes>;

export type Variable<T extends Variables> = [
    "var", keyof T & string
];

// Éléments

export type Element<T extends Variables = {}> =
    | Ref
    | Expression<T>
    | Variable<T>
    | string | number | boolean;

// Une chaîne décrit une propriété via Composition, jamais un complément de phrase.
export type ComplementElement<T extends Variables = {}> =
    Ref | Expression<T> | Variable<T> | number | boolean;
// Complément direct : élément seul. Complément introduit : [mot de liaison, élément].
export type Complement<T extends Variables = {}> = [Preposition, ComplementElement<T>] | ComplementElement<T>;
export type Complements<T extends Variables = {}> = Complement<T>[];

// Phrase

/** Représentation unique d’une phrase, également utilisable comme expression. */
export type Phrase<T extends Variables = {}> = [
    "phrase", Element<T> | undefined, Verbe | [Verbe, Qualificatif], ...Complement<T>[]
];

// Composition

/** Représentation unique d’une composition, également utilisable comme expression. */
export type Composition<T extends Variables = {}> = [
    "composition", Element<T> | string | number, NomCommun | [NomCommun, Qualificatif], Element<T>?
];

// Quantification

export type Q<
    T extends Variables,
    Parent extends Variables = {}
> = [
    "all" | "exists",
    T,
    Expression<Omit<Parent, keyof T> & T>
];

// Expressions logiques

export type Expression<T extends Variables = {}> =
    | boolean
    | ["not", Expression<T>]
    | ["and", ...Expression<T>[]]
    | ["or", ...Expression<T>[]]
    | ["=>", Expression<T>, Expression<T>]
    | ["switchCase", ["=>", Expression<T>, Expression<T>][], Expression<T>]
    | ["=", Element<T>, Element<T>]
    | ["contient", Complements<T> | Variable<T>, Complement<T>]
    | Phrase<T>
    | Composition<T>
    | [
        "all" | "exists",
        Variables,
        Expression<any>
    ];

export type Prop<T extends Variables = {}> =
    Expression<T>;

// ======================================================
// Helpers
// ======================================================

export function variable<const K extends string>(
    name: K
): ["var", K] {
    return ["var", name];
}

export function not<E extends Expression<any>>(
    e: E
): ["not", E] {
    return ["not", e];
}

export function and<E extends Expression<any>[]>(
    ...es: E
): ["and", ...E] {
    return ["and", ...es];
}

export function or<E extends Expression<any>[]>(
    ...es: E
): ["or", ...E] {
    return ["or", ...es];
}

export function implies<
    A extends Expression<any>,
    B extends Expression<any>
>(
    a: A,
    b: B
): ["=>", A, B] {
    return ["=>", a, b];
}

// La première condition vraie détermine le résultat ; sinon, utiliser d.
export function switchCase<const Cases extends ["=>", Expression<any>, Expression<any>][], C extends Expression<any>>(cases:Cases,d:C): ["switchCase",Cases,C] {
    return ["switchCase", cases, d];
}

export function eq<
    A extends Element<any>,
    B extends Element<any>
>(
    a: A,
    b: B
): ["=", A, B] {
    return ["=", a, b];
}

// Helper composition

export function composition<R extends Element<any> | string | number, N extends Composition[2]>(ref: R, name: N): ["composition", R, N];
export function composition<R extends Element<any> | string | number, N extends Composition[2], O extends Element<any> | undefined>(ref: R, name: N, of: O): O extends undefined ? ["composition", R, N] : ["composition", R, N, O];
export function composition(ref: Element<any> | string | number, name: Composition[2], of?: Element<any>): Composition<any> {
    const expression = normalizeFactTuples<Composition<any>>(of === undefined ? ["composition", ref, name] : ["composition", ref, name, of]);
    validateComplementUsage(expression);
    return expression;
}

export function phrase<
    S extends Element<any> | undefined,
    N extends Phrase[2],
    C extends Complements<any>
>(
    subject: S,
    name: N,
    ...complements: C
): ["phrase", S, N, ...C] {
    const expression = normalizeFactTuples<["phrase", S, N, ...C]>(["phrase", subject, name, ...complements]);
    validateComplementUsage(expression);
    return expression;
}

// Quantifications
// Les variables des portées parentes sont autorisées.

export function contient<C extends Complements<any> | Variable<any>, E extends Complement<any>>(complements: C, element: E): ["contient", C, E] {
    const expression: ["contient", C, E] = ["contient", complements, element];
    validateComplementUsage(expression);
    return expression;
}

export function quantification<
    const T extends Variables,
    E extends Expression<any>
>(
    q: ["all" | "exists", T, E]
): ["all" | "exists", T, E] {
    return q;
}

export function all<
    const T extends Variables,
    E extends Expression<any>
>(
    names: T,
    expression: E
): ["all", T, E] {
    return ["all", names, expression];
}

export function exists<
    const T extends Variables,
    E extends Expression<any>
>(
    names: T,
    expression: E
): ["exists", T, E] {
    return ["exists", names, expression];
}

// ======================================================
// Mémoire
// ======================================================

export type Memory = Phrase | Composition;

export const memoryRelation: Phrase[] = [];
export const memoryComposition: Composition[] = [];

// Écriture dans la mémoire

export function addMemoryComposition(
    ref: Element | string | number,
    name: Composition[2],
    of?: Element
): Composition {

    const value = composition(ref, name, of);

    validateVariables(value);
    validateComplementUsage(value);
    validateVocabulary(value);

    memoryComposition.push(value);
    return value;
}

export function addMemoryPhrase(
    subject: Element | undefined,
    name: Phrase[2],
    ...complements: Complements
): Phrase {

    const stored = phrase(subject, name, ...complements);

    validateVariables(stored);
    validateComplementUsage(stored);
    validateVocabulary(stored);

    memoryRelation.push(stored);

    return stored;
}

// Extraction récursive des références

export function getRefs(
    value: unknown,
    set: Set<Ref>,
    visited = new WeakSet<object>()
): void {

    if (value instanceof Ref) {
        set.add(value);
        return;
    }

    if (
        typeof value !== "object" ||
        value === null ||
        visited.has(value)
    ) {
        return;
    }

    visited.add(value);

    if (Array.isArray(value)) {

        for (const e of value) {
            getRefs(e, set, visited);
        }

        return;
    }

}

// Lecture des références

export function memoryRef(): Set<Ref> {

    const refs = new Set<Ref>();

    getRefs(memoryRelation, refs);
    getRefs(memoryComposition, refs);

    return refs;
}

// Réinitialisation de la mémoire

/** Supprime les faits mentionnant ces références, y compris dans les contenus imbriqués. */
export function deleteReferences(refs: Ref[]): void {
    if (!Array.isArray(refs) || refs.some(ref => !(ref instanceof Ref))) throw new Error('deleteReferences attend un tableau de Ref');
    const targets = new Set(refs);
    for (const facts of [memoryRelation, memoryComposition]) {
        for (let i = facts.length - 1; i >= 0; i--) {
            const mentioned = new Set<Ref>();
            getRefs(facts[i], mentioned);
            if ([...mentioned].some(ref => targets.has(ref))) facts.splice(i, 1);
        }
    }
}

export function clearMemory(): void {

    memoryRelation.length = 0;
    memoryComposition.length = 0;
}

// ======================================================
// Algèbre de requêtage
// ======================================================

export type Query<T extends Variables, E extends Expression<NoInfer<T>> = Expression<NoInfer<T>>> = ["select", T, E];
export type UsedVariableKeys<E, Depth extends unknown[] = []> =
    Depth['length'] extends 12 ? string :
    0 extends (1 & E) ? string :
    E extends readonly ["var", infer K extends string] ? K :
    E extends readonly ["all" | "exists", infer Local, infer Body] ? string extends keyof Local ? string : Exclude<UsedVariableKeys<Body, [...Depth, unknown]>, keyof Local> :
    E extends readonly unknown[] ? UsedVariableKeys<E[number], [...Depth, unknown]> : never;
export type QueryResult<T extends Variables, E = unknown> = {
    -readonly [K in keyof T]: unknown extends E ? VariableTypes[T[K]] | undefined :
        string extends UsedVariableKeys<E> ? VariableTypes[T[K]] | undefined :
        K extends UsedVariableKeys<E> ? VariableTypes[T[K]] : undefined
};


export function select<const T extends Variables, const E extends Expression<NoInfer<T>>>(
    names: T,
    expression: E
): Query<T, E> {

    validateVariables(
        expression,
        new Set(Object.keys(names))
    );
    validateComplementUsage(expression, names);
    validateVocabulary(expression);

    return ["select", names, expression];
}

// ======================================================
// Validation des portées des variables
// ======================================================

export function validateVariables(
    value: unknown,
    scope: ReadonlySet<string> = new Set()
): void {

    if (value instanceof Ref) {
        return;
    }


    if (!Array.isArray(value)) {
        return;
    }

    // Référence à une variable

    if (
        value[0] === "var" &&
        value.length === 2 &&
        typeof value[1] === "string"
    ) {

        if (!scope.has(value[1])) {

            throw new Error(
                `Variable non déclarée : ${value[1]}`
            );
        }

        return;
    }

    // Quantification : création d'une portée locale
    // héritant de la portée parente.

    if (
        (value[0] === "all" || value[0] === "exists") &&
        value.length === 3 &&
        value[1] !== null &&
        typeof value[1] === "object" &&
        !Array.isArray(value[1])
    ) {

        const local = new Set(scope);

        for (const name of Object.keys(value[1])) {
            local.add(name);
        }

        validateVariables(value[2], local);

        return;
    }

    // Parcours des expressions imbriquées

    for (const e of value) {
        validateVariables(e, scope);
    }
}

// ======================================================
// Moteur de requêtage
// ======================================================

type Binding = Map<string, VariableTypes[keyof VariableTypes]>;

type Domains = { [K in keyof VariableTypes]: VariableTypes[K][] };

// Seules les occurrences libres lient les variables projetées par select.
function usedVariables(value: unknown, bound: ReadonlySet<string> = new Set(), used = new Set<string>()): Set<string> {
    const visit = (child: unknown, scope = bound) => usedVariables(child, scope, used);
    if (value instanceof Ref) return used;
    if (Array.isArray(value)) {
        if (value[0] === 'var' && value.length === 2 && typeof value[1] === 'string') {
            if (!bound.has(value[1])) used.add(value[1]);
        } else if ((value[0] === 'all' || value[0] === 'exists') && value.length === 3 && value[1] && typeof value[1] === 'object' && !Array.isArray(value[1])) {
            visit(value[2], new Set([...bound, ...Object.keys(value[1])]));
        } else for (const child of value) visit(child);
    }
    return used;
}

type Primitive = string | number | boolean;
function getPrimitives(x:unknown, values=new Set<Primitive>(), visited=new WeakSet<object>()):Set<Primitive> {
    if(typeof x==='string'||typeof x==='number'||typeof x==='boolean') {values.add(x);return values;}
    if(!x||typeof x!=='object'||visited.has(x))return values;
    visited.add(x);
    const visit=(value:unknown)=>getPrimitives(value,values,visited);
    if(Array.isArray(x)) {
        // Ignorer les noms de prédicats, rôles et variables : ce ne sont pas des valeurs.
        switch(x[0]) {
            case 'var':break;
            case 'switchCase':
                for(const branch of x[1] as unknown[])visit(branch);
                visit(x[2]);break;
            case 'all':case 'exists':
                if(x.length===3)visit(x[2]);else for(const value of x.slice(1))visit(value);
                break;
            case 'composition':visit(x[1]);visit(x[3]);break;
            case 'phrase':visit(x[1]);for(const complement of x.slice(3))visit(complement);break;
            case 'contient':
                if(!(Array.isArray(x[1])&&x[1][0]==='var'&&x[1].length===2))for(const complement of x[1] as unknown[])visit(complement);
                visit(x[2]);break;
            default:for(const value of x.slice(1))visit(value);
        }
    }
    return values;
}

// Comparaison structurelle

function equal(
    a: unknown,
    b: unknown
): boolean {

    if (a === b) {
        return true;
    }

    // Comparaison des références par identité

    if (a instanceof Ref || b instanceof Ref) {
        return false;
    }

    // Comparaison des tuples

    if (Array.isArray(a) && Array.isArray(b)) {
        // Le quatrième élément absent et undefined ont la même signification.
        if (a[0] === 'composition' && b[0] === 'composition') {
            return equal(a[1], b[1]) && equal(a[2], b[2]) && equal(a[3], b[3]);
        }
        return (
            a.length === b.length &&
            a.every((v, i) => equal(v, b[i]))
        );
    }

    // Comparaison des déclarations de variables

    if (
        a &&
        b &&
        typeof a === "object" &&
        typeof b === "object" &&
        Object.getPrototypeOf(a) === Object.prototype &&
        Object.getPrototypeOf(b) === Object.prototype
    ) {

        const x = a as Record<string, unknown>;
        const y = b as Record<string, unknown>;

        return (
            Object.keys(x).length === Object.keys(y).length &&
            Object.keys(x).every(
                k =>
                    Object.prototype.hasOwnProperty.call(y, k) &&
                    equal(x[k], y[k])
            )
        );
    }

    return false;
}

// ======================================================
// Résolution des variables
// ======================================================

function resolve(
    value: unknown,
    binding: Binding
): unknown {

    if (Array.isArray(value)) {

        // Substitution d'une variable

        if (
            value[0] === "var" &&
            value.length === 2 &&
            binding.has(value[1])
        ) {

            return binding.get(value[1]);
        }

        // Protection des variables locales
        // d'une quantification imbriquée.

        if (
            (value[0] === "all" || value[0] === "exists") &&
            value.length === 3 &&
            value[1] &&
            typeof value[1] === "object" &&
            !Array.isArray(value[1])
        ) {

            const local = new Map(binding);

            for (const name of Object.keys(value[1])) {
                local.delete(name);
            }

            return [
                value[0],
                value[1],
                resolve(value[2], local)
            ];
        }

        return value.map(
            e => resolve(e, binding)
        );
    }

    return value;
}

// ======================================================
// Énumération des affectations possibles
// ======================================================

function* bindings(
    names: Variables,
    domains: Domains,
    parent: Binding = new Map()
): Generator<Binding> {

    const entries = Object.entries(names);

    function* visit(
        i: number,
        current: Binding
    ): Generator<Binding> {

        if (i === entries.length) {

            yield current;

            return;
        }

        const [name, type] = entries[i];

        for (const value of domains[type]) {

            const next = new Map(current);

            next.set(name, value);

            yield* visit(i + 1, next);
        }
    }

    yield* visit(0, parent);
}

// ======================================================
// Évaluation des expressions de requêtage
// ======================================================

function evaluate(
    e: Expression<any>,
    b: Binding,
    d: Domains,
    types: Variables
): boolean {

    if (typeof e === "boolean") {
        return e;
    }

    switch (e[0]) {

        case "not":

            return !evaluate(e[1], b, d, types);

        case "and":

            return e.slice(1).every(
                x => evaluate(
                    x as Expression<any>,
                    b,
                    d,
                    types
                )
            );

        case "or":

            return e.slice(1).some(
                x => evaluate(
                    x as Expression<any>,
                    b,
                    d,
                    types
                )
            );

        case "=>":

            return (
                !evaluate(e[1], b, d, types) ||
                evaluate(e[2], b, d, types)
            );

        case "switchCase":
            for (const [, condition, result] of e[1]) {
                if (evaluate(condition, b, d, types)) return evaluate(result, b, d, types);
            }
            return evaluate(e[2], b, d, types);

        case "=":

            return equal(
                resolve(e[1], b),
                resolve(e[2], b)
            );

        case "composition": {

            const ref = resolve(e[1], b);
            const of = resolve(e[3], b);

            return memoryComposition.some(c =>

                equal(c[1], ref) &&
                equal(c[2], e[2]) &&
                equal(c[3], of)
            );
        }

        case "phrase": {

            const subject = resolve(e[1], b);

            const listVariable = e.length===4 && Array.isArray(e[3]) && e[3][0]==='var' && e[3].length===2 && types[e[3][1] as string] === 'complements';
            const complements = resolve(
                listVariable ? e[3] : e.slice(3),
                b
            );

            return memoryRelation.some(p =>

                equal(p[1], subject) &&
                equal(p[2], e[2]) &&
                equal(
                    p.slice(3),
                    complements
                )
            );
        }

        case "contient": {
            const complements = resolve(e[1], b);
            const element = resolve(e[2], b);
            return Array.isArray(complements) && complements.some(complement => equal(complement, element));
        }

        case "all":

            for (
                const local of bindings(e[1], d, b)
            ) {

                if (!evaluate(e[2], local, d, { ...types, ...e[1] })) {
                    return false;
                }
            }

            return true;

        case "exists":

            for (
                const local of bindings(e[1], d, b)
            ) {

                if (evaluate(e[2], local, d, { ...types, ...e[1] })) {
                    return true;
                }
            }

            return false;

        default:
            throw new Error('Opérateur inconnu');
    }
}

// ======================================================
// Exécution d'une requête
// ======================================================

export function query<const T extends Variables, const E extends Expression<NoInfer<T>>>(
    q: Query<T, E>
): QueryResult<T, E>[] {

    const [, names, expression] = q;

    validateVariables(
        expression,
        new Set(Object.keys(names))
    );
    validateComplementUsage(expression, names);
    validateVocabulary(expression);

    for (const type of Object.values(names)) {
        if (!['Ref', 'Phrase', 'Composition', 'string', 'number', 'boolean', 'complements'].includes(type)) throw new Error('Type de variable invalide');
    }
    const primitives = new Set<Primitive>();
    for (const fact of [...memoryComposition, ...memoryRelation]) getPrimitives(fact, primitives);
    const phrases: Phrase[] = [];
    for (const fact of [...memoryComposition, ...memoryRelation]) {
        for (const value of collectPhrases<Phrase>(fact)) if (!phrases.some(other => equal(value, other))) phrases.push(value);
    }
    const compositions: Composition[] = [];
    for (const fact of [...memoryComposition, ...memoryRelation]) {
        for (const value of collectCompositions<Composition>(fact)) if (!compositions.some(other => equal(value, other))) compositions.push(value);
    }
    const domains: Domains = {
        Ref: [...memoryRef()], Phrase: phrases, Composition: compositions,
        complements: phrases.map(value => value.slice(3) as Complements).filter((value, i, all) => all.findIndex(other => equal(value, other)) === i),
        string: [...primitives].filter((value): value is string => typeof value === 'string'),
        number: [...primitives].filter((value): value is number => typeof value === 'number'),
        boolean: [...primitives].filter((value): value is boolean => typeof value === 'boolean')
    };
    const used = usedVariables(expression);
    const active = Object.fromEntries(Object.entries(names).filter(([name]) => used.has(name))) as Variables;
    const result: QueryResult<T, E>[] = [];

    for (const b of bindings(active, domains)) {

        if (evaluate(expression, b, domains, names)) {

            result.push(

                Object.fromEntries(

                    Object.keys(names).map(
                        k => [k, b.get(k)]
                    )

                ) as QueryResult<T, E>
            );
        }
    }

    return result;
}

// ======================================================
// Sortie
// ======================================================

export function print(
    ...value: unknown[]
): void {

    console.log(...value);
}
