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
        '## Annexe : exemples de référence\n\nSource actuelle de GET /api/examples. Adapte uniquement les extraits utiles : retire les imports et remplace console.log(...) par print(...). Ces exemples incluent des écritures et ne sont pas à exécuter automatiquement.\n\n'+sourceBlock(examples)
    ].join('\n\n')+'\n';
}
