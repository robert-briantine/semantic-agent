// Parcours partagé : chaque tuple de phrase possède une ligne de stockage,
// y compris lorsqu’il est contenu dans une proposition ou une composition.
// Aucune dépendance aux classes : la librairie RAM possède sa propre classe Ref.
export function collectPhrases<T extends unknown[] = unknown[]>(value: unknown, result: T[] = [], visited = new WeakSet<object>()): T[] {
    if (!value || typeof value !== 'object' || visited.has(value)) return result;
    visited.add(value);
    if (Array.isArray(value)) {
        if (value[0] === 'phrase' && value.length >= 3) result.push(value as T);
        for (const child of value) collectPhrases(child, result, visited);
    } else if ('ref' in value && 'of' in value) {
        collectPhrases(value.ref, result, visited);
        collectPhrases(value.of, result, visited);
    }
    return result;
}
