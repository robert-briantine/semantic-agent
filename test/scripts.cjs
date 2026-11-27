const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

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
        assert.equal(list.length, 1);
        assert.equal(list[0].id, saved.id);
        assert.ok(!Object.hasOwn(list[0], 'code'));
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
        assert.equal((await (await server.request('GET', '/api/scripts')).json()).length, 1);
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
        assert.equal((await (await server.request('GET', '/api/scripts')).json()).length, 4);
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
        assert.deepEqual(await (await server.request('GET', '/api/scripts')).json(), []);
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
