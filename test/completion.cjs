const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const ts = require('typescript');
const { variableCompletions } = require('../public/semantic-completions.cjs');

function fixture(markedCode) {
    const position = markedCode.indexOf('¦');
    assert.notEqual(position, -1);
    const code = markedCode.replace('¦', '');
    const filename = resolve('completion-script.ts');
    const options = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [] };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    host.readFile = path => path === filename ? code : readFile(path);
    host.fileExists = path => path === filename || ts.sys.fileExists(path);
    const program = ts.createProgram([filename, resolve('dist/editor/structure-langage.d.ts')], options, host);
    const source = program.getSourceFile(filename);
    return { source, code, position, program, complete: () => variableCompletions(ts, source, position, program.getTypeChecker()) };
}

test('Autocomplétion : p et n sont proposés dans le script de recherche de Paul', () => {
    const { complete, position, code } = fixture(`
        const ref = new Ref();
        addMemoryComposition(ref, "Personne");
        addMemoryComposition("Paul", "nom", ref);
        const personnes = query(select({ p: "Ref", n: "string" },
            and(est(variable("¦"), "Personne"), est(variable("n"), "nom", variable("p")))));
        print(personnes);
    `);
    const suggestions = complete();
    assert.deepEqual(suggestions.map(item => [item.name, item.type]), [['p', '"Ref"'], ['n', '"string"']]);
    assert.deepEqual(suggestions[0].replacementSpan, { start: position, length: 0 });
    assert.equal(code[position - 1], '"');
});

test('Autocomplétion : portées imbriquées, masquage et requêtes indépendantes', () => {
    const nested = fixture(`select({p:"Ref",n:"string"}, exists({p:"number",b:"boolean"},
        and(eq(variable("¦"), 1), est(variable("n"), "nom"))))`).complete();
    assert.deepEqual(nested.map(item => [item.name, item.type]), [['p', '"number"'], ['b', '"boolean"'], ['n', '"string"']]);
    const outside = fixture(`select({p:"Ref"}, and(exists({hidden:"string"},true), est(variable("¦"),"Personne")))`).complete();
    assert.deepEqual(outside.map(item => item.name), ['p']);
    const separate = fixture(`select({outer:"Ref"}, eq(query(select({inner:"string"},est(variable("¦"),"Nom")))[0].inner,"Paul"))`).complete();
    assert.deepEqual(separate.map(item => item.name), ['inner']);
    assert.deepEqual(fixture(`all({name:"string"}, eq(variable("¦"), "Paul"))`).complete().map(item => item.name), ['name']);
});

test('Autocomplétion : déclarations réutilisées, texte incomplet et remplacement du nom entier', () => {
    const reusable = fixture(`const vars = {p:"Ref",n:"string"} as const;
        select(vars, est(variable("¦"),"Personne"))`).complete();
    assert.deepEqual(reusable.map(item => item.name), ['p', 'n']);
    const spread = fixture(`const vars = {p:"Ref"} as const;
        select({...vars,n:"string"}, est(variable("¦"),"Personne"))`).complete();
    assert.deepEqual(spread.map(item => item.name).sort(), ['n', 'p']);
    const partial = fixture(`select({personne:"Ref",nom:"string"},est(variable("per¦sonne"),"Personne"))`);
    const suggestion = partial.complete().find(item => item.name === 'nom');
    const span = suggestion.replacementSpan;
    assert.equal(partial.code.slice(span.start, span.start + span.length), 'personne');
    const unfinished = fixture('select({p:"Ref",n:"string"},est(variable("n¦');
    assert.deepEqual(unfinished.complete().map(item => item.name), ['p', 'n']);
    const quoted = fixture(`select({"l'auteur":"Ref"},est(variable('¦'),"Personne"))`).complete();
    assert.equal(quoted[0].name, "l\\'auteur");
});

test('Autocomplétion : aucune variable d’une autre portée ou d’un commentaire', () => {
    assert.deepEqual(fixture(`select({p:"Ref"},true); variable("¦")`).complete(), []);
    assert.equal(fixture(`select({p:"Ref"},est(new Ref(),"¦"))`).complete(), undefined);
    assert.equal(fixture(`select({p:"Ref"},true); // variable("¦")`).complete(), undefined);
    assert.equal(fixture(`select({p:"Ref"},obj.variable("¦"))`).complete(), undefined);
});

test('TypeScript propose les six types de variables et infère string pour n', () => {
    const { code, position, program } = fixture(`const personnes = query(select({p:"Ref",n:"¦"},true));`);
    const filename = resolve('completion-script.ts');
    const options = program.getCompilerOptions();
    const service = ts.createLanguageService({
        getScriptFileNames: () => [filename, resolve('dist/editor/structure-langage.d.ts')],
        getScriptVersion: () => '1',
        getScriptSnapshot: path => {
            const content = path === filename ? code : ts.sys.readFile(path);
            return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
        },
        getCurrentDirectory: () => process.cwd(), getCompilationSettings: () => options,
        getDefaultLibFileName: ts.getDefaultLibFilePath, fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory
    });
    assert.deepEqual(service.getCompletionsAtPosition(filename, position, {}).entries.map(item => item.name).sort(),
        ['Phrase', 'Ref', 'boolean', 'complements', 'number', 'string']);
    service.dispose();
    const typed = fixture(`const ref = new Ref();
        const personnes = query(select({p:"Ref",n:"string"},and(est(variable("p"),"Personne"),est(variable("n"),"nom",variable("p")))));
        const name: string = personnes[0].n;
        const person: Ref = personnes[0].p;
        // @ts-expect-error Le nom est une chaîne.
        const invalid: number = personnes[0].n;
        // ¦`);
    assert.deepEqual(ts.getPreEmitDiagnostics(typed.program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
