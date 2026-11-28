const { build } = require('esbuild');
const ts = require('typescript');
const { mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
    const root = resolve(__dirname, '..');
    const editorDir = resolve(root, 'dist/editor');
    mkdirSync(editorDir, { recursive: true });
    const lexiconDir = resolve(root, 'dist/lexicon');
    mkdirSync(lexiconDir, { recursive: true });
    for (const name of ['README.md', 'LICENSE-Lexique.txt', 'README-Lexique.txt']) {
        copyFileSync(resolve(root, 'src/lexicon', name), resolve(lexiconDir, name));
    }

    // Générer les types depuis la vraie librairie, sans ses implémentations Node.
    const program = ts.createProgram([resolve(root, 'src/structure-langage.ts')], {
        declaration: true, emitDeclarationOnly: true, strict: true,
        target: ts.ScriptTarget.ES2022, skipLibCheck: true
    });
    let declarations;
    const emitted = program.emit(undefined, (filename, content) => {
        if (filename.endsWith('/structure-langage.d.ts')) declarations = content;
    });
    if (emitted.emitSkipped || !declarations) throw new Error('Génération des types Monaco impossible');

    // Les scripts accèdent aux symboles directement, sans import.
    declarations = declarations.replace(/^export \{\};?\s*$/gm, '').replace(/^export /gm, '');
    const api = ts.createSourceFile('api.ts', readFileSync(resolve(root, 'docs/api.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const runtimeDeclarations = api.statements
        .filter(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword))
        .map(node => node.getText(api).replace(/^export /, ''));
    writeFileSync(resolve(editorDir, 'structure-langage.d.ts'), declarations + '\n' + runtimeDeclarations.join('\n') + '\n');

    rmSync(resolve(root, 'dist/web'), { recursive: true, force: true });
    await build({
        absWorkingDir: root,
        entryPoints: {
            app: 'public/app.js',
            documentation: 'public/documentation.js',
            'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
            'ts.worker': 'public/ts.worker.js'
        },
        outdir: 'dist/web', bundle: true, format: 'esm', splitting: true,
        minify: true, target: 'es2022', loader: { '.ttf': 'file' }, logLevel: 'info', logLimit: 6
    });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
