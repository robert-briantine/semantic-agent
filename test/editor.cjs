const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { prepareAgentExamples } = require('../public/agent-examples.cjs');
const { exampleScripts } = require('../dist/example-scripts');

async function browserPage(t, chrome, url, directory) {
    const browser = spawn(chrome, [
        '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
        '--remote-debugging-port=0', '--user-data-dir=' + directory, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    t.after(async () => {
        if (browser.exitCode !== null || browser.signalCode !== null) return;
        const exited = new Promise(resolve => browser.once('exit', resolve));
        browser.kill(); await exited;
    });
    const debuggerUrl = await new Promise((resolve, reject) => {
        let errors = '';
        const timeout = setTimeout(() => reject(Error('Démarrage de Chrome trop long')), 10000);
        browser.once('error', error => { clearTimeout(timeout); reject(error); });
        browser.stderr.on('data', data => {
            errors += data;
            const match = errors.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
    });
    const targets = await (await fetch('http://' + new URL(debuggerUrl).host + '/json/list')).json();
    const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    t.after(() => socket.close());
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    const pending = new Map();
    let serial = 0, onLoad;
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') onLoad?.();
        const callback = pending.get(message.id);
        if (callback) { pending.delete(message.id); callback(message); }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++serial;
        const timeout = setTimeout(() => { pending.delete(id); reject(Error('Chrome : délai dépassé pour ' + method)); }, 10000);
        pending.set(id, message => { clearTimeout(timeout); message.error ? reject(Error(message.error.message)) : resolve(message.result); });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await command('Page.enable');
    const loaded = new Promise(resolve => { onLoad = resolve; });
    await command('Page.navigate', { url });
    await loaded;
    return async expression => {
        const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
        return response.result.value;
    };
}

test('Types Monaco : symboles globaux, inférence des requêtes et erreurs de type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-editor-types-'));
    try {
        const script = join(dir, 'script.ts');
        writeFileSync(script, `
            const p = new Ref();
            addMemoryComposition(p, "Personne");
            const rows = query(select({ p: "Ref" }, est(variable("p"), "Personne")));
            const ref: Ref = rows[0].p;
            const action: Phrase = query(select({ action: "Phrase" }, eq(variable("action"), variable("action"))))[0].action;
            const composition: Composition = memoryComposition()[0];
            const refs: Set<Ref> = memoryRef();
            const actions = query(select({ c: "complements", objet: "Ref" }, and(
                phrase(p, "donner", variable("c")), contient(variable("c"), ["à", variable("objet")])
            )));
            const liste: Complements = actions[0].c;
            const direct: Complement = p;
            const introduit: Complement = ["à", p];
            const preposition: Preposition = "depuis";
            const locution: Preposition = "à côté de";
            const temps: Preposition = "au moment de";
            const moyen: Preposition = "par l'intermédiaire de";
            const proportion: Preposition = "à hauteur de";
            const conjonction: Preposition = "parce que";
            const liaison: Preposition = preposition;
            const objet: Ref = actions[0].objet;
            const rawComplements: Complements = query(select({ c: "complements" }, ["phrase", p, "donner", ["var", "c"]]))[0].c;
            const rawContains: Complements = query(select({ c: "complements" }, ["contient", ["var", "c"], ["à", p]]))[0].c;
            // @ts-expect-error Une liste de compléments n'est pas une chaîne.
            const invalidList: string = actions[0].c;
            print(ref, action, composition, refs, memoryRelation());
            addMemoryComposition(true, "Actif", p);
            const unite = new Ref();
            addMemoryComposition(unite, "Unité");
            addMemoryComposition("kg", "Symbole", unite);
            addMemoryPhrase(p, "mesurer", ["valeur", 12.5], ["unité", unite], false);
            // @ts-expect-error Une chaîne nue n'est pas un complément.
            addMemoryPhrase(p, "envoyer", "rapport");
            // @ts-expect-error La valeur d'un complément nommé ne peut pas être une chaîne.
            addMemoryPhrase(p, "envoyer", ["objet", "rapport"]);
            // @ts-expect-error La règle s'applique aussi aux requêtes phrase.
            phrase(p, "envoyer", ["objet", "rapport"]);
            // @ts-expect-error La règle s'applique aux tuples de phrase.
            phrase(p, "envoyer", "rapport");
            // @ts-expect-error La règle s'applique aux recherches contient.
            contient(variable("c"), ["objet", "rapport"]);
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
            const switched = query(select({ p: "Ref", unused: "string" }, switchCase([
                implies(est(variable("p"), "Prioritaire"), false),
                implies(phrase(variable("p"), "travailler"), eq(variable("p"), p))
            ], eq(variable("p"), p))));
            const switchedRef: Ref = switched[0].p;
            const switchedUnused: undefined = switched[0].unused;
            select({}, switchCase([], switchCase([implies(true, false)], true)));
            select({}, ["switchCase", [["=>", true, false]], true]);
            // @ts-expect-error Les résultats des cas doivent être des expressions.
            switchCase([implies(true, true)], "invalide");
            // @ts-expect-error La variable doit être déclarée par select.
            select({}, switchCase([implies(est(variable("missing"), "Personne"), true)], false));
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
            ${exampleScripts.map(script => '{\n' + script.code + '\n}').join('\n')}
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
    assert.doesNotMatch(consoleHtml, /Exemple de lecture|Exemples API|id="loadExamples"|id="example"/);
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
    assert.equal(await examples.text(), readFileSync('src/lg-exemple executable.ts', 'utf8'));
    const code = prepareAgentExamples(exampleScripts.find(script => script.id.endsWith('f018')).code);
    const execution = await fetch(new URL('api/execute', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, mode: 'write' })
    });
    const result = await execution.json();
    assert.equal(execution.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.deepEqual(result.output, [[[{ nom: 'Nora' }]], [[]]]);

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
        assert.match(html, /id="userScriptsTab"[^>]*aria-selected="true"/);
        assert.match(html, /id="exampleScriptsTab"[^>]*aria-selected="false"/);
        const users = html.match(/<select id="savedScripts"[^>]*>(.*?)<\/select>/s)?.[1];
        assert.ok(users);
        assert.doesNotMatch(users, /Exemple switchCase/);
        assert.match(html, /id="exampleScriptsPanel"[^>]*hidden/);
        assert.match(html, /Exemple switchCase — 1\. Insertion/);
        assert.match(html, /Exemple switchCase — 2\. Requête/);
        for (const script of exampleScripts) assert.ok(html.includes(script.name), script.name);
        assert.doesNotMatch(html, /Exemple de lecture|Exemples API/);
    });
    await t.test('Onglets Script et Exemple : listes séparées, chargement, clonage et suppression utilisateur', {
        skip: chrome ? false : 'Chrome/Chromium absent ; définir CHROME_BIN pour le test navigateur.'
    }, async t => {
        const created = await fetch(new URL('api/scripts', url), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Mon script personnel', code: 'print("personnel");', mode: 'read' })
        });
        assert.equal(created.status, 201);
        const userScript = await created.json();
        const evaluate = await browserPage(t, chrome, url, join(dir, 'browser-scripts'));
        const states = await evaluate(`(async () => {
            const $ = id => document.getElementById(id);
            const wait = async condition => {
                for (let i = 0; i < 100; i++) {
                    if (condition()) return;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw Error('État attendu absent : ' + condition);
            };
            window.confirm = () => true;
            await wait(() => $('savedExamples')?.options.length === ${exampleScripts.length + 1} && !$('savedScripts').disabled);
            const initial = {
                users: [...$('savedScripts').options].filter(option => option.value).map(option => option.textContent),
                examples: [...$('savedExamples').options].filter(option => option.value).map(option => option.textContent)
            };
            $('scriptName').value = 'Brouillon conservé';
            $('scriptName').dispatchEvent(new Event('input'));
            $('exampleScriptsTab').click();
            const browsing = { hiddenUsers: $('userScriptsPanel').hidden, hiddenExamples: $('exampleScriptsPanel').hidden,
                name: $('scriptName').value, deleteButton: !!$('exampleScriptsPanel').querySelector('#deleteScript') };
            $('savedExamples').value = [...$('savedExamples').options].find(option => option.textContent.includes('Requête')).value;
            $('savedExamples').dispatchEvent(new Event('change'));
            $('openExample').click();
            await wait(() => $('scriptName').readOnly);
            const exampleName = $('scriptName').value;
            const example = { readOnly: $('scriptName').readOnly, saveDisabled: $('saveScript').disabled };
            $('cloneScript').click();
            await wait(() => $('userScriptsTab').getAttribute('aria-selected') === 'true' && !$('scriptName').readOnly);
            const copyId = $('savedScripts').value;
            const cloned = { copyId, userCount: $('savedScripts').options.length - 1,
                name: $('scriptName').value, saveDisabled: $('saveScript').disabled,
                examplesHidden: $('exampleScriptsPanel').hidden };
            $('scriptName').value = 'Ma copie modifiée';
            $('scriptName').dispatchEvent(new Event('input'));
            $('saveScript').click();
            await wait(() => $('scriptStatus').textContent.includes('enregistré sur le serveur'));
            $('deleteScript').click();
            await wait(() => $('scriptStatus').textContent.includes('supprimé'));
            $('exampleScriptsTab').click();
            return { initial, browsing, example, cloned, exampleName,
                finalUsers: [...$('savedScripts').options].filter(option => option.value).map(option => option.textContent),
                finalExamples: [...$('savedExamples').options].filter(option => option.value).map(option => option.textContent) };
        })()`);
        assert.deepEqual(states.initial.users, ['Mon script personnel']);
        assert.equal(states.initial.examples.length, exampleScripts.length);
        assert.deepEqual(states.browsing, { hiddenUsers: true, hiddenExamples: false, name: 'Brouillon conservé', deleteButton: false });
        assert.deepEqual(states.example, { readOnly: true, saveDisabled: true });
        assert.ok(states.cloned.copyId);
        assert.equal(states.cloned.userCount, 2);
        assert.equal(states.cloned.name, states.exampleName + ' — copie');
        assert.equal(states.cloned.saveDisabled, false);
        assert.equal(states.cloned.examplesHidden, true);
        assert.deepEqual(states.finalUsers, states.initial.users);
        assert.deepEqual(states.finalExamples, states.initial.examples);
        const list = await (await fetch(new URL('api/scripts', url))).json();
        assert.ok(!list.some(script => script.id === states.cloned.copyId));
        assert.ok(list.some(script => script.id === userScript.id));
        assert.equal(list.filter(script => script.type === 'exemple').length, exampleScripts.length);
    });
    await t.test('L’onglet Base SQLite charge les onze tables et leurs résultats dans le navigateur', {
        skip: chrome ? false : 'Chrome/Chromium absent ; définir CHROME_BIN pour le test navigateur.'
    }, async () => {
        const { stdout: html } = await promisify(execFile)(chrome, [
            '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
            '--user-data-dir=' + join(dir, 'browser-database'), '--dump-dom', '--timeout=10000',
            '--virtual-time-budget=3000', new URL('/#database', url).href
        ], { timeout: 15000, maxBuffer: 3 * 1024 * 1024 });
        assert.equal((html.match(/class="database-table"/g) ?? []).length, 11);
        assert.match(html, /11 table\(s\) · compteurs actualisés/);
        assert.match(html, /ligne\(s\) affichée\(s\)/);
        assert.match(html, /Colonnes de Complement/);
        assert.doesNotMatch(html, /Requête en cours…|Chargement des tables…/);
    });
});
