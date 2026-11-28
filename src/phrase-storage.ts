// Parcours partagé : les tuples de phrase et de composition gardent leur contexte,
// y compris lorsqu’ils sont contenus dans une proposition ou un autre fait.
// Aucune dépendance aux classes : la librairie RAM possède sa propre classe Ref.
function collectFacts<T extends unknown[]>(kind:'phrase'|'composition',value: unknown, result: T[], visited: WeakSet<object>): T[] {
    if (!value || typeof value !== 'object' || visited.has(value)) return result;
    visited.add(value);
    if (Array.isArray(value)) {
        if (value[0] === kind && value.length >= 3) result.push(value as T);
        for (const child of value) collectFacts(kind,child,result,visited);
    }
    return result;
}

export function collectPhrases<T extends unknown[] = unknown[]>(value:unknown,result:T[]=[],visited=new WeakSet<object>()):T[] {
    return collectFacts('phrase',value,result,visited);
}
export function collectCompositions<T extends unknown[] = unknown[]>(value:unknown,result:T[]=[],visited=new WeakSet<object>()):T[] {
    return collectFacts('composition',value,result,visited);
}

// Canoniser l’argument optionnel, également dans les tuples bruts imbriqués.
// Les objets Ref sont conservés par identité.
export function normalizeFactTuples<T>(value:T):T {
    if(!Array.isArray(value))return value;
    const result=value.map(normalizeFactTuples);
    if(result[0]==='composition'&&result.length===4&&result[3]===undefined)result.pop();
    return result as T;
}
