const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { prepareAgentExamples } = require('../public/agent-examples.cjs');

test('Types Monaco : symboles globaux, inférence des requêtes et erreurs de type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-editor-types-'));
    try {
        const script = join(dir, 'script.ts');
        writeFileSync(script, `
            const p = new Ref();
            addMemoryComposition(p, "Personne");
            const rows = query(select({ p: "Ref" }, est(variable("p"), "Personne")));
            const ref: Ref = rows[0].p;
            const phrase: Phrase = query(select({ action: "Phrase" }, eq(variable("action"), variable("action"))))[0].action;
            const composition: Composition = memoryComposition()[0];
            const refs: Set<Ref> = memoryRef();
            const actions = query(select({ c: "complements", objet: "Ref" }, and(
                fait(p, "donne", variable("c")), contient(variable("c"), ["à", variable("objet")])
            )));
            const liste: Complements = actions[0].c;
            const objet: Ref = actions[0].objet;
            const rawComplements: Complements = query(select({ c: "complements" }, ["fait", p, "donne", ["var", "c"]]))[0].c;
            const rawContains: Complements = query(select({ c: "complements" }, ["contient", ["var", "c"], ["à", p]]))[0].c;
            // @ts-expect-error Une liste de compléments n'est pas une chaîne.
            const invalidList: string = actions[0].c;
            print(ref, phrase, composition, refs, memoryRelation());
            addMemoryComposition(true, "Actif", p);
            addMemoryPhrase(p, "mesure", ["valeur", 12.5], ["unité", "kg"], false);
            const primitives = query(select({ nom: "string", age: "number", actif: "boolean" },
                and(est(variable("nom"), "Nom", p), est(variable("age"), "Age", p), est(variable("actif"), "Actif", p))));
            const nom: string = primitives[0].nom;
            const age: number = primitives[0].age;
            const actif: boolean = primitives[0].actif;
            const union: QueryResult<{ value: "string" | "number" }>['value'] = 42;
            const projected = query(select({ p: "Ref", n: "string" }, est(variable("p"), "Personne")));
            const projectedRef: Ref = projected[0].p;
            const unusedName: undefined = projected[0].n;
            const raw = query(select({ p: "Ref", n: "string" }, ["est", ["var", "p"], "Personne"]));
            const rawRef: Ref = raw[0].p;
            const rawUnused: undefined = raw[0].n;
            const shadow = query(select({ p: "Ref", n: "string" }, and(
                est(variable("p"), "Personne"), exists({ n: "Ref" }, eq(variable("n"), variable("p")))
            )));
            const shadowUnused: undefined = shadow[0].n;
            const shadowRef: Ref = shadow[0].p;
            const constant = query(select({ n: "string" }, true));
            const unusedConstant: undefined = constant[0].n;
            function dynamic(q: Query<{ p: "Ref", n: "string" }>) {
                const maybeName: string | undefined = query(q)[0].n;
                // @ts-expect-error Une expression dynamique peut ne pas utiliser n.
                const unsafeName: string = query(q)[0].n;
            }
            // @ts-expect-error Une variable inutilisée n'est pas une chaîne.
            const invalidUnused: string = projected[0].n;
            // @ts-expect-error Une variable number ne produit pas une chaîne.
            const invalidPrimitive: string = primitives[0].age;
            // @ts-expect-error Un type de variable inconnu est refusé.
            select({ value: "Date" }, true);
            // @ts-expect-error Une requête exige un tuple Query.
            query("invalide");
            // @ts-expect-error La propriété p est une Ref, pas une chaîne.
            const invalid: string = rows[0].p;
        `);
        const program = ts.createProgram([resolve('dist/editor/structure-langage.d.ts'), script], {
            noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
            lib: ['lib.es2022.d.ts'], types: []
        });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Monaco, sa librairie et les API sont accessibles sans authentification', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-editor-server-'));
    // Une ancienne variable API_KEY ne doit plus restreindre l’accès.
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, HOST: '127.0.0.1', PORT: '0', API_KEY: 'editor-test', MEMORY_DB: join(dir, 'memory.sqlite') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill();
            await exited;
        }
        rmSync(dir, { recursive: true, force: true });
    });
    const url = await new Promise((resolve, reject) => {
        let output = '', errors = '';
        const timer = setTimeout(() => reject(new Error('Démarrage du serveur trop long')), 10000);
        child.stderr.on('data', chunk => { errors += chunk; });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', code => { clearTimeout(timer); reject(new Error(`Serveur arrêté (${code}) : ${errors}`)); });
        child.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/Web app : (http:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    const source = await fetch(new URL('editor/structure-langage.ts', url));
    assert.equal(source.status, 200);
    assert.equal(await source.text(), readFileSync('src/structure-langage.ts', 'utf8'));
    const agentSource = await fetch(new URL('editor/structure-langage-pour-ia.ts', url));
    assert.equal(agentSource.status, 200);
    assert.equal(await agentSource.text(), readFileSync('src/structure-langage-pour-ia.ts', 'utf8'));
    const consolePage = await fetch(url);
    const consoleHtml = await consolePage.text();
    assert.match(consoleHtml, /structure-langage-pour-ia\.ts/);
    assert.doesNotMatch(consoleHtml, /id="key"/);
    const declarations = await fetch(new URL('editor/structure-langage.d.ts', url));
    assert.equal(declarations.status, 200);
    assert.match(await declarations.text(), /declare class Ref/);
    const documentation = await fetch(new URL('docs/', url));
    assert.equal(documentation.status, 200);
    const documentationHtml = await documentation.text();
    assert.match(documentationHtml, /Documentation API/);
    assert.doesNotMatch(documentationHtml, /id="key"/);
    for (const asset of ['app.js', 'app.css', 'documentation.js', 'documentation.css', 'editor.worker.js', 'ts.worker.js']) {
        const response = await fetch(new URL('assets/' + asset, url));
        assert.equal(response.status, 200, asset);
        assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /javascript/);
        await response.body.cancel();
    }
    for (const [endpoint, file] of [['library', 'src/structure-langage-pour-ia.ts'], ['examples', 'src/lg-exemple executable.ts']]) {
        const response = await fetch(new URL('api/' + endpoint, url));
        assert.equal(response.status, 200);
        assert.equal(await response.text(), readFileSync(file, 'utf8'));
    }
    const examples = await fetch(new URL('api/examples', url));
    const code = prepareAgentExamples(await examples.text());
    const execution = await fetch(new URL('api/execute', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, mode: 'write' })
    });
    const result = await execution.json();
    assert.equal(execution.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal(result.output.length, 2);
    assert.ok(result.output[0][0].length > 0);
    assert.ok(result.output[1][0].length > 0);

    const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
        .find(path => path && existsSync(path));
    await t.test('Le navigateur initialise Monaco et active l’exécution sans champ de clé API', {
        skip: chrome ? false : 'Chrome/Chromium absent ; définir CHROME_BIN pour le test navigateur.'
    }, async () => {
        const { stdout: html } = await promisify(execFile)(chrome, [
            '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
            '--user-data-dir=' + join(dir, 'browser'), '--dump-dom', '--timeout=10000',
            '--virtual-time-budget=3000', url
        ], { timeout: 15000, maxBuffer: 3 * 1024 * 1024 });
        const run = html.match(/<button id="run"[^>]*>/)?.[0];
        assert.ok(run, 'Bouton d’exécution présent');
        assert.doesNotMatch(run, /disabled/);
        assert.match(html, /class="monaco-editor /);
        assert.doesNotMatch(html, /Chargement de Monaco…|Éditeur indisponible\./);
        assert.match(html, /TypeScript · autocomplétion et vérification des types/);
    });
    await t.test('L’onglet Base SQLite charge les huit tables et leurs résultats dans le navigateur', {
        skip: chrome ? false : 'Chrome/Chromium absent ; définir CHROME_BIN pour le test navigateur.'
    }, async () => {
        const { stdout: html } = await promisify(execFile)(chrome, [
            '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
            '--user-data-dir=' + join(dir, 'browser-database'), '--dump-dom', '--timeout=10000',
            '--virtual-time-budget=3000', new URL('/#database', url).href
        ], { timeout: 15000, maxBuffer: 3 * 1024 * 1024 });
        assert.equal((html.match(/class="database-table"/g) ?? []).length, 8);
        assert.match(html, /8 table\(s\) · compteurs actualisés/);
        assert.match(html, /ligne\(s\) affichée\(s\)/);
        assert.match(html, /Colonnes de Complement/);
        assert.doesNotMatch(html, /Requête en cours…|Chargement des tables…/);
    });
});
