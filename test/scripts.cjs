const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ScriptStore } = require('../dist/scripts');
const { exampleScripts } = require('../dist/example-scripts');
const ts = require('typescript');
const { Runtime, Ref, phrase } = require('../dist/runtime');

async function startServer(path) {
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, HOST: '127.0.0.1', PORT: '0', MEMORY_DB: path },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const stop = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill();
        await exited;
    };
    try {
        const url = await new Promise((resolve, reject) => {
            let output = '', errors = '';
            const timer = setTimeout(() => reject(Error('Démarrage trop long')), 10000);
            child.stderr.on('data', chunk => { errors += chunk; });
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => { clearTimeout(timer); reject(Error(`Serveur arrêté (${code}) : ${errors}`)); });
            child.stdout.on('data', chunk => {
                output += chunk;
                const match = output.match(/Web app : (http:\/\/\S+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
            });
        });
        return { stop, request: (method, path, body) => fetch(new URL(path, url), {
            method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }) };
    } catch (error) { await stop(); throw error; }
}

test('Scripts : enregistrement, renommage, rechargement après redémarrage et exécution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-scripts-'));
    let server;
    try {
        const path = join(dir, 'memory.sqlite');
        server = await startServer(path);
        const code = 'function creer(nom:string){const p=new Ref();addMemoryComposition(nom,"Nom",p);return p;} const p=creer("Alice"); print(query(select({nom:"string"},est(variable("nom"),"Nom",p))));';
        const created = await server.request('POST', '/api/scripts', { name: '  Acquisition Alice  ', code, mode: 'write' });
        assert.equal(created.status, 201);
        const saved = await created.json();
        assert.equal(saved.name, 'Acquisition Alice');
        assert.equal(saved.code, code);
        assert.equal(saved.mode, 'write');
        assert.ok(saved.id);
        assert.ok(!Number.isNaN(Date.parse(saved.updatedAt)));
        const list = await (await server.request('GET', '/api/scripts')).json();
        assert.equal(list.length, exampleScripts.length + 1);
        assert.equal(list.find(script => script.type === 'utilisateur').id, saved.id);
        assert.ok(list.every(script => !Object.hasOwn(script, 'code')));
        assert.equal(saved.type, 'utilisateur');
        // Enregistrer un script en mode écriture ne l’exécute pas.
        const untouched = await (await server.request('POST', '/api/execute', { code: 'print(query(select({nom:"string"},eq(variable("nom"),variable("nom")))));' })).json();
        assert.deepEqual(untouched, { ok: true, output: [[[]]] });
        await server.stop();
        server = await startServer(path);
        const loaded = await (await server.request('GET', '/api/scripts/' + saved.id)).json();
        assert.deepEqual(loaded, saved);
        const replayed = await (await server.request('POST', '/api/execute', { code: loaded.code, mode: loaded.mode })).json();
        assert.deepEqual(replayed, { ok: true, output: [[[{ nom: 'Alice' }]]] });
        const updated = await server.request('PUT', '/api/scripts/' + saved.id, { name: 'Lire les noms', code: 'print(query(select({nom:"string"},eq(variable("nom"),variable("nom")))));', mode: 'read' });
        assert.equal(updated.status, 200);
        const renamed = await updated.json();
        assert.equal(renamed.id, saved.id);
        assert.equal(renamed.name, 'Lire les noms');
        assert.equal(renamed.mode, 'read');
        await server.stop();
        server = await startServer(path);
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + saved.id)).json(), renamed);
        assert.equal((await (await server.request('GET', '/api/scripts')).json()).length, exampleScripts.length + 1);
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Scripts : accès sans clé, validation et doublons sans écrasement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-scripts-validation-'));
    let server;
    try {
        server = await startServer(join(dir, 'memory.sqlite'));
        const input = { name: 'Mon script', code: 'print("original");', mode: 'read' };
        assert.equal((await server.request('GET', '/api/scripts')).status, 200);
        const created = await server.request('POST', '/api/scripts', input);
        assert.equal(created.status, 201);
        const original = await created.json();
        assert.equal((await server.request('GET', '/api/scripts/' + original.id)).status, 200);
        const updated = await server.request('PUT', '/api/scripts/' + original.id, input);
        assert.equal(updated.status, 200);
        const saved = await updated.json();
        assert.equal(saved.id, original.id);
        const duplicate = await server.request('POST', '/api/scripts', { ...input, code: 'print("écrasé");' });
        assert.equal(duplicate.status, 409);
        assert.match((await duplicate.json()).error, /déjà ce nom/);
        for (const invalid of [
            {}, { ...input, name: '  ' }, { ...input, name: 'x'.repeat(121) },
            { ...input, code: 123 }, { ...input, code: 'x'.repeat(60001) }, { ...input, mode: 'admin' }
        ]) {
            assert.equal((await server.request('POST', '/api/scripts', invalid)).status, 400);
            assert.equal((await server.request('PUT', '/api/scripts/' + saved.id, invalid)).status, 400);
        }
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + saved.id)).json(), saved);
        const second = await (await server.request('POST', '/api/scripts', { name: 'Autre', code: '' })).json();
        assert.equal(second.mode, 'read');
        assert.equal((await server.request('PUT', '/api/scripts/' + second.id, input)).status, 409);
        assert.equal((await (await server.request('GET', '/api/scripts/' + second.id)).json()).name, 'Autre');
        assert.equal((await server.request('GET', '/api/scripts/inconnu')).status, 404);
        assert.equal((await server.request('PUT', '/api/scripts/inconnu', input)).status, 404);
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Scripts : clonage indépendant, modifications courantes, noms disponibles et persistance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-scripts-clone-'));
    let server;
    try {
        const path = join(dir, 'memory.sqlite');
        server = await startServer(path);
        const input = { name: 'Acquisition', code: 'const p=new Ref();addMemoryComposition(p,"Personne");', mode: 'write' };
        const original = await (await server.request('POST', '/api/scripts', input)).json();
        const current = { ...input, code: input.code + 'print(p);' };
        const response = await server.request('POST', '/api/scripts/clone', current);
        assert.equal(response.status, 201);
        const first = await response.json();
        assert.notEqual(first.id, original.id);
        assert.equal(first.name, 'Acquisition — copie');
        assert.equal(first.code, current.code);
        assert.equal(first.mode, current.mode);
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + original.id)).json(), original);
        const second = await (await server.request('POST', '/api/scripts/clone', current)).json();
        assert.equal(second.name, 'Acquisition — copie 2');
        const third = await (await server.request('POST', '/api/scripts/clone', { name: second.name, code: second.code, mode: second.mode })).json();
        assert.equal(third.name, 'Acquisition — copie 3');
        const changed = await server.request('PUT', '/api/scripts/' + first.id, { name: first.name, code: 'print("copie modifiée");', mode: 'read' });
        assert.equal(changed.status, 200);
        const edited = await changed.json();
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + original.id)).json(), original);
        const untouched = await (await server.request('POST', '/api/execute', { code: 'print(query(select({p:"Ref"},eq(variable("p"),variable("p")))));' })).json();
        assert.deepEqual(untouched, { ok: true, output: [[[]]] });
        await server.stop(); server = await startServer(path);
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + first.id)).json(), edited);
        assert.deepEqual(await (await server.request('GET', '/api/scripts/' + original.id)).json(), original);
        assert.equal((await (await server.request('GET', '/api/scripts')).json()).length, exampleScripts.length + 4);
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Scripts : clonage des noms longs et validation avant création', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-scripts-clone-validation-'));
    let server;
    try {
        server = await startServer(join(dir, 'memory.sqlite'));
        for (const input of [{}, { name: ' ', code: '' }, { name: 'x', code: 12 }, { name: 'x', code: '', mode: 'admin' }, { name: 'x'.repeat(121), code: '' }, { name: 'x', code: 'x'.repeat(60001) }]) {
            assert.equal((await server.request('POST', '/api/scripts/clone', input)).status, 400);
        }
        assert.ok((await (await server.request('GET', '/api/scripts')).json()).every(script => script.type === 'exemple'));
        const input = { name: 'x'.repeat(120), code: '' };
        const first = await (await server.request('POST', '/api/scripts/clone', input)).json();
        const second = await (await server.request('POST', '/api/scripts/clone', input)).json();
        assert.equal(first.name.length, 120);
        assert.equal(second.name.length, 120);
        assert.notEqual(first.name, second.name);
        assert.equal(first.mode, 'read');
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Exemples : insertion et requête switchCase exécutables, clonage modifiable et redémarrage sans doublons', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-example-scripts-'));
    let server;
    try {
        const path = join(dir, 'memory.sqlite');
        server = await startServer(path);
        const list = await (await server.request('GET', '/api/scripts')).json();
        assert.equal(list.length, exampleScripts.length);
        assert.ok(list.every(script => script.type === 'exemple'));
        const sql = new DatabaseSync(path, { readOnly: true });
        try {
            assert.equal(sql.prepare("SELECT count(*) AS n FROM saved_scripts WHERE type='exemple'").get().n, exampleScripts.length);
            assert.equal(sql.prepare('SELECT count(*) AS n FROM refs').get().n, 0);
        } finally { sql.close(); }
        const load = async id => (await server.request('GET', '/api/scripts/' + id)).json();
        const insert = await load(exampleScripts[0].id);
        const query = await load(exampleScripts[1].id);
        const execute = async script => {
            const response = await server.request('POST', '/api/execute', { code: script.code, mode: script.mode });
            const result = await response.json();
            assert.equal(response.status, 200, JSON.stringify(result));
            assert.equal(result.ok, true);
            return result.output[0][0];
        };
        assert.deepEqual((await execute(query)).map(row => row.nom).sort(), ['Bob', 'Chloé']);
        const persons = await execute(insert);
        assert.deepEqual(persons.map(row => row.nom).sort(), ['Alice', 'Bob', 'Chloé', 'Denis']);
        assert.deepEqual(await execute(insert), persons);
        assert.deepEqual((await execute(query)).map(row => row.nom).sort(), ['Bob', 'Chloé']);
        const denied = await server.request('PUT', '/api/scripts/' + query.id, { ...query, code: 'print("écrasé");' });
        assert.equal(denied.status, 409);
        assert.match((await denied.json()).error, /Clonez/);
        for (const example of [insert, query]) {
            const deletion = await server.request('DELETE', '/api/scripts/' + example.id);
            assert.equal(deletion.status, 403);
            assert.match((await deletion.json()).error, /ne peuvent pas être supprimés/);
            assert.deepEqual(await load(example.id), example);
        }
        const cloned = await server.request('POST', '/api/scripts/clone', query);
        assert.equal(cloned.status, 201);
        const copy = await cloned.json();
        assert.equal(copy.type, 'utilisateur');
        assert.notEqual(copy.id, query.id);
        assert.equal(copy.code, query.code);
        assert.equal(copy.mode, query.mode);
        const changed = await server.request('PUT', '/api/scripts/' + copy.id, { ...copy, code: 'print("modifié");' });
        assert.equal(changed.status, 200);
        const savedCopy = await changed.json();
        assert.deepEqual(await load(query.id), query);
        await server.stop();
        server = await startServer(path);
        const restarted = await (await server.request('GET', '/api/scripts')).json();
        assert.equal(restarted.filter(script => script.type === 'exemple').length, exampleScripts.length);
        assert.deepEqual(await load(copy.id), savedCopy);
        assert.deepEqual(await load(query.id), query);
        const deletion = await server.request('DELETE', '/api/scripts/' + copy.id);
        assert.equal(deletion.status, 200);
        assert.deepEqual(await deletion.json(), { ok: true });
        assert.equal((await server.request('GET', '/api/scripts/' + copy.id)).status, 404);
        assert.equal((await server.request('DELETE', '/api/scripts/' + copy.id)).status, 404);
        assert.deepEqual(await load(query.id), query);
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Scripts : migration des anciens scripts et conflit de nom avec un exemple sans écrasement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-script-migration-'));
    const path = join(dir, 'memory.sqlite');
    let store;
    try {
        const db = new DatabaseSync(path);
        db.exec(`CREATE TABLE saved_scripts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,code TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('read','write')),updated_at TEXT NOT NULL)`);
        const legacy = { id: 'legacy', name: exampleScripts[0].name, code: 'print("original");', mode: 'read', updatedAt: '2026-01-01T00:00:00.000Z' };
        db.prepare('INSERT INTO saved_scripts VALUES (?,?,?,?,?)').run(legacy.id, legacy.name, legacy.code, legacy.mode, legacy.updatedAt);
        db.close();
        store = new ScriptStore(path);
        assert.deepEqual({ ...store.get(legacy.id) }, { ...legacy, type: 'utilisateur' });
        assert.equal(store.list().length, exampleScripts.length + 1);
        assert.equal(store.list().filter(script => script.type === 'exemple').length, exampleScripts.length);
        const before = store.list();
        store.close(); store = new ScriptStore(path);
        assert.deepEqual(store.list(), before);
    } finally {
        if (store) store.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Catalogue : mise à jour des exemples existants sans toucher aux copies utilisateur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-example-update-'));
    const path = join(dir, 'memory.sqlite');
    let store;
    try {
        store = new ScriptStore(path);
        const example = store.list().find(script => script.name.includes('09. contient'));
        const copy = store.clone({ name: example.name, code: 'print("ma copie");', mode: 'read' });
        store.close();
        const db = new DatabaseSync(path);
        db.prepare('UPDATE saved_scripts SET code=? WHERE id=?').run('ancien exemple', example.id);
        const phraseExample = exampleScripts.find(script => script.id.endsWith('f006'));
        db.prepare('UPDATE saved_scripts SET name=?,code=? WHERE id=?').run('Exemple expressions — 03. fait — phrases', 'ancien code fait', phraseExample.id);
        db.close();
        store = new ScriptStore(path);
        assert.equal(store.get(example.id).code, exampleScripts.find(script => script.id === example.id).code);
        assert.equal(store.get(phraseExample.id).name, phraseExample.name);
        assert.equal(store.get(phraseExample.id).code, phraseExample.code);
        assert.deepEqual({ ...store.get(copy.id) }, copy);
    } finally {
        if (store) store.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Catalogue : scripts sans fonctions, autonomes et idempotents, sans résidus ni modification des données existantes', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-expression-examples-'));
    let server;
    try {
        const path = join(dir, 'memory.sqlite');
        server = await startServer(path);
        const runtime = new Runtime(path);
        const person = new Ref(), report = new Ref();
        runtime.addMemoryComposition(person, 'personne');
        runtime.addMemoryComposition(person, 'collaborateur');
        runtime.addMemoryComposition(person, ['exemple', 'général']);
        runtime.addMemoryComposition(person, ['exemple', 'complexe']);
        runtime.addMemoryComposition('Ana', 'Nom', person);
        runtime.addMemoryComposition('Nora', 'nom', person);
        runtime.addMemoryComposition(42, 'âge', person);
        runtime.addMemoryComposition(0, 'retard', person);
        runtime.addMemoryComposition(false, 'disponibilité', person);
        runtime.addMemoryComposition(report, 'rapport');
        runtime.addMemoryComposition('Budget', 'nom', report);
        runtime.addMemoryPhrase(person, 'prépare', report, ['parce que', phrase(person, 'demande', report)]);
        runtime.addMemoryPhrase(person, 'pense', phrase(person, 'valide', report));
        runtime.close();
        const list = await (await server.request('GET', '/api/scripts')).json();
        const scripts = await Promise.all(list.map(async script => (await server.request('GET', '/api/scripts/' + script.id)).json()));
        const execute = async script => {
            const response = await server.request('POST', '/api/execute', { code: script.code, mode: script.mode });
            const result = await response.json();
            assert.equal(response.status, 200, script.name + ': ' + JSON.stringify(result));
            assert.equal(result.ok, true);
            return result.output;
        };
        const snapshot = () => {
            const db = new DatabaseSync(path, { readOnly: true });
            try {
                return Object.fromEntries(['compositions', 'phrases', 'refs', 'primitive_values', 'Complement', 'fact_arguments']
                    .map(table => [table, db.prepare('SELECT * FROM "' + table + '"').all()]));
            } finally { db.close(); }
        };
        const before = snapshot();
        const expected = {
            f001: [['Alice', 'Bob', 'Chloé', 'Denis']],
            f002: [['Bob', 'Chloé']],
            f003: [['Ana', 'Bruno', 'Clara']],
            f004: [[{}], []],
            f005: [['Ana', 'Bruno']],
            f006: [['Ana']],
            f007: [['Ana'], [{}], []],
            f008: [['Clara']],
            f009: [['Ana']],
            f010: [['Ana', 'Clara']],
            f011: [['Ana', 'Clara']],
            f012: [['Bruno']],
            f013: [[{}], []],
            f014: [['Ana']],
            f015: [['Ana'], ['Ana'], ['Bruno']],
            f016: [['Hugo', 'Léa', 'Nora', 'Omar', 'Zoé']],
            f017: [['Nora']],
            f018: [['Nora'], []],
            f019: [['Omar'], ['Zoé'], []],
            f020: [[], ['Nora']],
            f021: [[{}], []],
            f022: [['Budget'], ['Zoé']],
            f023: [['Hugo', 'Nora']],
            f024: [['Omar']],
            f025: [['Budget'], ['Avancement']]
        };
        assert.equal(scripts.length, Object.keys(expected).length);
        for (const script of scripts.reverse()) await t.test(script.name, async () => {
            const source = ts.createSourceFile('example.ts', script.code, ts.ScriptTarget.Latest, true);
            const check = node => {
                assert.ok(!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node), script.name);
                ts.forEachChild(node, check);
            };
            check(source);
            const output = await execute(script);
            assert.deepEqual(snapshot(), before, 'aucun résidu après le premier appel');
            assert.deepEqual(await execute(script), output, 'mêmes résultats au second appel');
            assert.deepEqual(snapshot(), before, 'aucun résidu après le second appel');
            const actual = output.map(args => args[0].map(row => Object.hasOwn(row, 'nom') ? row.nom : row).sort());
            assert.deepEqual(actual, expected[script.id.slice(-4)]);
            if (script.name.includes('contient')) {
                const row = output[0][0][0];
                assert.equal(row.objet, 'Rapport pédagogique');
                assert.equal(row.destinataire, 'Clara');
            }
            if (script.id.endsWith('f024')) {
                const row = output[0][0][0];
                assert.equal(row.age, 42);
                assert.equal(row.retard, 0);
                assert.equal(row.disponible, false);
            }
        });
        assert.deepEqual(snapshot(), before);
    } finally {
        if (server) await server.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});
