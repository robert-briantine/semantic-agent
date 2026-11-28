import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function sourceBlock(source:string):string {
    // Garder les annexes valides même si une source contient déjà des clôtures Markdown.
    const longest=Math.max(0,...(source.match(/`+/g)??[]).map(run=>run.length));
    const fence='`'.repeat(Math.max(3,longest+1));
    return `${fence}typescript\n${source.trimEnd()}\n${fence}`;
}

export async function buildAgentPrompt(root:string,executeUrl:string):Promise<string> {
    const [instructions,library,examples]=await Promise.all([
        readFile(resolve(root,'docs/agent-prompt.md'),'utf8'),
        readFile(resolve(root,'src/structure-langage-pour-ia.ts'),'utf8'),
        readFile(resolve(root,'src/lg-exemple executable.ts'),'utf8')
    ]);
    return [
        instructions.replaceAll('{{EXECUTE_URL}}',()=>executeUrl).trimEnd(),
        '## Annexe : librairie de référence\n\nSource actuelle de GET /api/library. Cette implémentation en RAM décrit les types et la sémantique ; les appels HTTP utilisent la mémoire SQLite persistante et uniquement les primitives injectées indiquées ci-dessus. Ne recopie pas cette implémentation dans un appel.\n\n'+sourceBlock(library),
        '## Annexe : exemples de traduction\n\nSource actuelle de GET /api/examples, générée depuis le même catalogue que les scripts de l’onglet Exemple. Chaque bloc indique son mode, son texte naturel, sa traduction et son résultat attendu. Chaque exemple est autonome, sans fonction définie : il prépare ses données privées, affiche le résultat puis les supprime dans finally. Il est idempotent et ne nécessite aucun autre exemple. Choisis le bloc utile, retire l’import et adapte les références à la demande réelle. Pour une acquisition réelle, conserve les faits demandés ; le nettoyage des références temporaires concerne les démonstrations. Les blocs représentent des appels indépendants ; ne les exécute pas tous et n’enregistre pas les jeux fictifs pour répondre à une vraie demande.\n\n'+sourceBlock(examples)
    ].join('\n\n')+'\n';
}
