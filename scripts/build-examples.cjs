// Générer la source fournie à l'agent depuis le catalogue de scripts de la console.
const ts = require('typescript');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const source = readFileSync(resolve(root, 'src/example-scripts.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true
});
const errors = compiled.diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) throw Error(errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
// Compiler uniquement cette source locale de confiance, puis vérifier le projet et la sortie générée avec tsc.
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/example-scripts.js'), compiled.outputText);
const { renderExampleScripts } = require(resolve(root, 'dist/example-scripts.js'));
writeFileSync(resolve(root, 'src/lg-exemple executable.ts'), renderExampleScripts());
