import { Ref, Phrase, Composition } from './structure-langage';

// Seules les occurrences libres lient les variables projetées par select.
export function usedVariables(value: unknown, bound: ReadonlySet<string> = new Set(), used = new Set<string>()): Set<string> {
    const visit = (child: unknown, scope = bound) => usedVariables(child, scope, used);
    if (value instanceof Ref) return used;
    if (value instanceof Phrase) { visit(value.subject); visit(value.complements); }
    else if (value instanceof Composition) { visit(value.ref); visit(value.of); }
    else if (Array.isArray(value)) {
        if (value[0] === 'var' && value.length === 2 && typeof value[1] === 'string') {
            if (!bound.has(value[1])) used.add(value[1]);
        } else if ((value[0] === 'all' || value[0] === 'exists') && value.length === 3 && value[1] && typeof value[1] === 'object' && !Array.isArray(value[1])) {
            visit(value[2], new Set([...bound, ...Object.keys(value[1])]));
        } else for (const child of value) visit(child);
    }
    return used;
}
