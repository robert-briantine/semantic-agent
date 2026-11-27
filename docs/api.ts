import { randomUUID } from "node:crypto";

declare const refBrand: unique symbol;

export class Ref {
    declare protected readonly [refBrand]?: void;
    constructor(public readonly id: string = randomUUID()) {}
}

export type Verbe = string;
export type NomCommun = string;
export type Qualificatif = string;
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
    | Ref | Phrase<T> | Expression<T> | Variable<T> | string | number | boolean;

export type Complements<T extends Variables = {}> =
    ([string, Element<T>] | Element<T>)[];

export class Phrase<T extends Variables = {}> {
    constructor(
        public subject: Element<T> | undefined,
        public name: Verbe | [Verbe, Qualificatif],
        public complements?: Complements<T>
    ) {}
}

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
    | ["=", Element<T>, Element<T>]
    | ["contient", Complements<T> | Variable<T>, [string, Element<T>] | Element<T>]
    | ["fait", Element<T> | undefined, Verbe | [Verbe, Qualificatif], Variable<T>]
    | ["fait", Element<T> | undefined, Verbe | [Verbe, Qualificatif],
        ...([string, Element<T>] | Element<T>)[]]
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
    E extends Phrase<any> | Composition<any> ? string :
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
export function eq<A extends Element<any>, B extends Element<any>>(a: A, b: B): ["=", A, B] {
    return ["=", a, b];
}
export function est<R extends Element<any> | string | number, N extends Composition["name"]>(ref: R, name: N): ["est", R, N];
export function est<R extends Element<any> | string | number, N extends Composition["name"], O extends Element<any> | undefined>(ref: R, name: N, of: O): ["est", R, N, O];
export function est(ref: Element<any> | string | number, name: Composition["name"], of?: Element<any>): ["est", Element<any> | string | number, Composition["name"], Element<any>?] {
    return arguments.length === 2 ? ["est", ref, name] : ["est", ref, name, of];
}
export function fait<S extends Element<any> | undefined, N extends Phrase["name"], C extends Complements<any>>(subject: S, name: N, ...complements: C): ["fait", S, N, ...C] {
    return ["fait", subject, name, ...complements];
}
export function contient<C extends Complements<any> | Variable<any>, E extends [string, Element<any>] | Element<any>>(complements: C, element: E): ["contient", C, E] {
    return ["contient", complements, element];
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

// Fonctions injectées dans le programme (aucun import à écrire).
export declare function addMemoryComposition(ref:Element|string|number,name:Composition['name'],of?:Element):void;
export declare function addMemoryPhrase(subject:Element|undefined,name:Phrase['name'],...complements:Complements):Phrase;
export declare function query<const T extends Variables,const E extends Expression<NoInfer<T>>>(q:Query<T,E>):QueryResult<T,E>[];
export declare function memoryRef():Set<Ref>;
export declare function memoryRelation():Phrase[];
export declare function memoryComposition():Composition[];
export declare function print(...values:unknown[]):void;
