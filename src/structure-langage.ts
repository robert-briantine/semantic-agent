import { validateComplementUsage } from './validate-complements';
import { randomUUID } from "node:crypto";

declare const refBrand: unique symbol;

export class Ref {
    declare protected readonly [refBrand]?: void;
    constructor(public readonly id: string = randomUUID()) {}
}

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
export type VariableTypes = {
    Ref: Ref;
    Phrase: Phrase;
    string: string;
    number: number;
    boolean: boolean;
    complements: Complements;
};
export type Variables = Record<string, keyof VariableTypes>;
export type Variable<T extends Variables> = ["var", keyof T & string];

export type Element<T extends Variables = {}> =
    | Ref | Expression<T> | Variable<T> | string | number | boolean;

// Une chaîne décrit une propriété via Composition, jamais un complément de phrase.
export type ComplementElement<T extends Variables = {}> =
    Ref | Expression<T> | Variable<T> | number | boolean;
// Complément direct : élément seul. Complément introduit : [mot de liaison, élément].
export type Complement<T extends Variables = {}> = [Preposition, ComplementElement<T>] | ComplementElement<T>;
export type Complements<T extends Variables = {}> = Complement<T>[];

/** Représentation unique d’une phrase, également utilisable comme expression. */
export type Phrase<T extends Variables = {}> = [
    "phrase", Element<T> | undefined, Verbe | [Verbe, Qualificatif], ...Complement<T>[]
];

export class Composition<T extends Variables = {}> {
    constructor(
        public ref: Element<T> | string | number,
        public name: NomCommun | [NomCommun, Qualificatif],
        public of?: Element<T>
    ) {}
}

export type Q<T extends Variables, Parent extends Variables = {}> = [
    "all" | "exists", T, Expression<Omit<Parent, keyof T> & T>
];

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
    | ["est", Element<T> | string | number,
        NomCommun | [NomCommun, Qualificatif], Element<T>?]
    | ["all" | "exists", Variables, Expression<any>];

export type Prop<T extends Variables = {}> = Expression<T>;

export function quantification<const T extends Variables, E extends Expression<any>>(q: ["all" | "exists", T, E]): ["all" | "exists", T, E] { return q; }

export type Query<T extends Variables, E extends Expression<NoInfer<T>> = Expression<NoInfer<T>>> = ["select", T, E];
export type UsedVariableKeys<E, Depth extends unknown[] = []> =
    Depth['length'] extends 12 ? string :
    0 extends (1 & E) ? string :
    E extends readonly ["var", infer K extends string] ? K :
    E extends readonly ["all" | "exists", infer Local, infer Body] ? string extends keyof Local ? string : Exclude<UsedVariableKeys<Body, [...Depth, unknown]>, keyof Local> :
    E extends Composition<any> ? string :
    E extends readonly unknown[] ? UsedVariableKeys<E[number], [...Depth, unknown]> : never;
export type QueryResult<T extends Variables, E = unknown> = {
    -readonly [K in keyof T]: unknown extends E ? VariableTypes[T[K]] | undefined :
        string extends UsedVariableKeys<E> ? VariableTypes[T[K]] | undefined :
        K extends UsedVariableKeys<E> ? VariableTypes[T[K]] : undefined
};

// Helpers : construction des tuples sans modifier l'algèbre.
export function variable<const K extends string>(name: K): ["var", K] {
    return ["var", name];
}


export function not<E extends Expression<any>>(e: E): ["not", E] {
    return ["not", e];
}
export function and<E extends Expression<any>[]>(...es: E): ["and", ...E] {
    return ["and", ...es];
}
export function or<E extends Expression<any>[]>(...es: E): ["or", ...E] {
    return ["or", ...es];
}
export function implies<A extends Expression<any>, B extends Expression<any>>(a: A, b: B): ["=>", A, B] {
    return ["=>", a, b];
}
// La première condition vraie détermine le résultat ; sinon, utiliser d.
export function switchCase<const Cases extends ["=>", Expression<any>, Expression<any>][], C extends Expression<any>>(cases:Cases,d:C): ["switchCase",Cases,C] {
    return ["switchCase", cases, d];
}
export function eq<A extends Element<any>, B extends Element<any>>(a: A, b: B): ["=", A, B] {
    return ["=", a, b];
}
export function est<R extends Element<any> | string | number, N extends Composition["name"]>(ref: R, name: N): ["est", R, N];
export function est<R extends Element<any> | string | number, N extends Composition["name"], O extends Element<any> | undefined>(ref: R, name: N, of: O): ["est", R, N, O];
export function est(ref: Element<any> | string | number, name: Composition["name"], of?: Element<any>): ["est", Element<any> | string | number, Composition["name"], Element<any>?] {
    return arguments.length === 2 ? ["est", ref, name] : ["est", ref, name, of];
}
export function phrase<S extends Element<any> | undefined, N extends Phrase[2], C extends Complements<any>>(subject: S, name: N, ...complements: C): ["phrase", S, N, ...C] {
    const expression: ["phrase", S, N, ...C] = ["phrase", subject, name, ...complements];
    validateComplementUsage(expression);
    return expression;
}
export function contient<C extends Complements<any> | Variable<any>, E extends Complement<any>>(complements: C, element: E): ["contient", C, E] {
    const expression: ["contient", C, E] = ["contient", complements, element];
    validateComplementUsage(expression);
    return expression;
}
export function all<const T extends Variables, E extends Expression<any>>(names: T, expression: E): ["all", T, E] {
    return ["all", names, expression];
}
export function exists<const T extends Variables, E extends Expression<any>>(names: T, expression: E): ["exists", T, E] {
    return ["exists", names, expression];
}
export function select<const T extends Variables, const E extends Expression<NoInfer<T>>>(names: T, expression: E): Query<T, E> {
    return ["select", names, expression];
}
