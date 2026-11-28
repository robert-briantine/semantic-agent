const stringComplementError = 'Chaîne interdite comme complément : utilisez une Ref typée avec addMemoryComposition (par exemple objet, "Rapport").';

type Scope = Readonly<Record<string, string>>;
const isVariable = (value: unknown): value is ['var', string] =>
    Array.isArray(value) && value.length === 2 && value[0] === 'var' && typeof value[1] === 'string';

function validateValue(value: unknown, scope: Scope): void {
    if (typeof value === 'string' || (isVariable(value) && scope[value[1]] === 'string')) {
        throw new Error(stringComplementError);
    }
    validateComplementUsage(value, scope);
}

function validateComplement(value: unknown, scope: Scope): void {
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' &&
        !['var', 'not', 'and', 'or'].includes(value[0])) {
        validateValue(value[1], scope);
    } else validateValue(value, scope);
}

// Valider les positions de compléments, en conservant les chaînes dans les compositions.
// Les deux moteurs partagent ce parcours, notamment pour les tuples bruts et les variables liées.
export function validateComplementUsage(value: unknown, scope: Scope = {}): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        if (value[0] === 'fait' && value.length >= 3) {
            throw new Error('Expression « fait » remplacée : utilisez phrase(...) ou ["phrase", ...].');
        }
        if (value[0] === 'est' && value.length >= 3) {
            throw new Error('Expression « est » remplacée : utilisez composition(...) ou ["composition", ...].');
        }
        if (isVariable(value)) return;
        if ((value[0] === 'all' || value[0] === 'exists') && value.length === 3 &&
            value[1] && typeof value[1] === 'object' && !Array.isArray(value[1])) {
            validateComplementUsage(value[2], { ...scope, ...value[1] });
        } else if (value[0] === 'phrase' && value.length >= 3) {
            validateComplementUsage(value[1], scope);
            for (const complement of value.slice(3)) validateComplement(complement, scope);
        } else if (value[0] === 'contient' && value.length === 3) {
            if (!isVariable(value[1]) && Array.isArray(value[1])) {
                for (const complement of value[1]) validateComplement(complement, scope);
            }
            validateComplement(value[2], scope);
        } else for (const child of value) validateComplementUsage(child, scope);
    } else if ('subject' in value && 'name' in value) {
        throw new Error('Phrase objet interdite : utilisez phrase(sujet, verbe, ...complements) ou le tuple ["phrase", ...].');
    } else if ('ref' in value && 'name' in value) {
        throw new Error('Composition objet interdite : utilisez composition(ref, nom, of?) ou le tuple ["composition", ...].');
    }
}
