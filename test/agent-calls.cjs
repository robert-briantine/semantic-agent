const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { inspectDatabase } = require('../dist/database');
const { vocabularyTables } = require('../dist/vocabulary');
const preservedTables = new Set(['saved_scripts', ...vocabularyTables]);

async function setup(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-agent-calls-'));
    const path = join(dir, 'memory.sqlite');
    let child;
    async function stop() {
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill(); await exited;
        }
    }
    t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, HOST: '127.0.0.1', PORT: '0', MEMORY_DB: path },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const url = await new Promise((resolve, reject) => {
            let output = '', errors = '';
            const timer = setTimeout(() => reject(Error('Démarrage trop long')), 10000);
            child.stderr.on('data', chunk => { errors += chunk; });
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', () => { clearTimeout(timer); reject(Error(errors)); });
            child.stdout.on('data', chunk => {
                output += chunk;
                const match = output.match(/Web app : (http:\/\/\S+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
            });
        });
        return async (endpoint, body, method = 'POST') => {
            const response = await fetch(new URL(endpoint, url), body === undefined ? {} : {
                method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            return { status: response.status, data: await response.json() };
        };
    }
    const request = await start();
    const tables = () => inspectDatabase(path, { action: 'tables' }).tables;
    return { path, request, tables, restart: async () => { await stop(); return start(); } };
}

test('Exécution : console non tracée, agent avec source/code, détails, pagination et persistance', async t => {
    const { request, tables, restart } = await setup(t);
    assert.deepEqual(await request('/api/execute', { code: 'print("console");', source: 'ignorée' }), { status: 200, data: { ok: true, output: [['console']] } });
    assert.equal(tables().find(table => table.name === 'agent_calls').rowCount, 0);
    for (const source of [undefined, '', '  ', 1, 'x'.repeat(60001)]) {
        assert.equal((await request('/api/agent/execute', { code: 'print(1);', source })).status, 400);
    }
    for (const body of [{ source: 'test' }, { source: 'test', code: 1 }, { source: 'test', code: 'print(1);', mode: 'admin' }]) {
        assert.equal((await request('/api/agent/execute', body)).status, 400);
    }
    assert.equal(tables().find(table => table.name === 'agent_calls').rowCount, 0);
    const input = { source: '  Affiche « bonjour ».\nTexte source <script>test</script>  ', code: 'print("bonjour",false);', mode: 'read' };
    const result = await request('/api/agent/execute', input);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.output, [['bonjour', false]]);
    assert.equal(typeof result.data.callId, 'string');
    const detail = (await request('/api/agent/calls/' + result.data.callId)).data.call;
    assert.equal(detail.source, input.source);
    assert.equal(detail.code, input.code);
    assert.equal(detail.mode, 'read');
    assert.equal(detail.status, 'succeeded');
    assert.equal(detail.httpStatus, 200);
    assert.ok(detail.durationMs >= 0);
    assert.ok(detail.completedAt >= detail.createdAt);
    assert.deepEqual(detail.response, result.data);
    const second = await request('/api/agent/execute', { source: 'Affiche deux.', code: 'print(2);' });
    const firstPage = (await request('/api/agent/calls?limit=1')).data;
    assert.equal(firstPage.calls.length, 1);
    assert.equal(firstPage.calls[0].id, second.data.callId);
    assert.equal(firstPage.hasMore, true);
    assert.equal(Object.hasOwn(firstPage.calls[0], 'code'), false);
    const nextPage = (await request('/api/agent/calls?limit=1&offset=1')).data;
    assert.equal(nextPage.calls[0].id, result.data.callId);
    assert.equal(nextPage.hasMore, false);
    for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=0.5', 'limit=x']) assert.equal((await request('/api/agent/calls?' + query)).status, 400);
    assert.equal((await request('/api/agent/calls/inconnu')).data.call, null);
    const afterRestart = await restart();
    assert.deepEqual((await afterRestart('/api/agent/calls/' + result.data.callId)).data.call, detail);
});

test('Historique : les erreurs et les sorties trop volumineuses sont conservées malgré le rollback', async t => {
    const { request, tables } = await setup(t);
    const error = await request('/api/agent/execute', {
        source: 'Écriture suivie d’une erreur.', mode: 'write',
        code: 'addMemoryComposition("Alice","Nom",new Ref());inconnue();'
    });
    assert.equal(error.status, 400);
    assert.equal(error.data.ok, false);
    assert.match(error.data.error, /Variable inconnue/);
    assert.equal(tables().find(table => table.name === 'compositions').rowCount, 0);
    const detail = (await request('/api/agent/calls/' + error.data.callId)).data.call;
    assert.equal(detail.status, 'failed');
    assert.equal(detail.httpStatus, 400);
    assert.deepEqual(detail.response, error.data);
    const tooLarge = await request('/api/agent/execute', { source: 'Sortie de test volumineuse.', code: 'function double(s,n){return n===0?s:double(s+s,n-1);}print(double("x",20));' });
    assert.equal(tooLarge.status, 413);
    assert.equal((await request('/api/agent/calls/' + tooLarge.data.callId)).data.call.httpStatus, 413);
});

test('RAZ : mémoire et historique vidés, scripts conservés et réutilisables', async t => {
    const { request, tables } = await setup(t);
    const code = 'const p=new Ref();addMemoryComposition("Alice","Nom",p);addMemoryPhrase(p,"donner",["à",new Ref()],42);';
    assert.equal((await request('/api/agent/execute', { source: 'Alice donne un objet.', code, mode: 'write' })).status, 200);
    const saved = await request('/api/scripts', { name: 'Test', code, mode: 'write' });
    assert.equal(saved.status, 201);
    assert.equal((await request('/api/scripts', { name: 'Lecture', code: 'print(1);', mode: 'read' })).status, 201);
    const scriptsBefore = (await request('/api/scripts')).data;
    const before = tables();
    assert.ok(before.every(table => table.rowCount > 0), JSON.stringify(before));
    for (const body of [{}, { confirm: true }, { confirm: 'raz' }]) assert.equal((await request('/api/database/reset', body)).status, 400);
    assert.deepEqual(tables(), before);
    const reset = await request('/api/database/reset', { confirm: 'RAZ' });
    assert.equal(reset.status, 200);
    assert.equal(reset.data.ok, true);
    assert.deepEqual(reset.data.deleted, Object.fromEntries(before.filter(table => !preservedTables.has(table.name)).map(table => [table.name, table.rowCount])));
    assert.ok(tables().every(table => preservedTables.has(table.name) ? table.rowCount === before.find(previous => previous.name === table.name).rowCount : table.rowCount === 0));
    assert.deepEqual(tables().map(table => [table.name, table.sql]), before.map(table => [table.name, table.sql]));
    assert.deepEqual((await request('/api/scripts')).data, scriptsBefore);
    assert.deepEqual((await request('/api/scripts/' + saved.data.id)).data, saved.data);
    assert.equal((await request('/api/agent/calls')).data.calls.length, 0);
    assert.equal((await request('/api/execute', { code: saved.data.code, mode: saved.data.mode })).status, 200);
    assert.equal(tables().find(table => table.name === 'agent_calls').rowCount, 0);
    assert.equal((await request('/api/agent/execute', { source: 'Affiche un.', code: 'print(1);' })).status, 200);
    assert.equal(tables().find(table => table.name === 'agent_calls').rowCount, 1);
    const updated = await request('/api/scripts/' + saved.data.id, { name: 'Test modifié', code: 'print(2);', mode: 'read' }, 'PUT');
    assert.equal(updated.status, 200);
    assert.equal(updated.data.id, saved.data.id);
    assert.equal((await request('/api/scripts')).data.length, scriptsBefore.length);
});

test('RAZ : une erreur annule la suppression des tables déjà vidées', async t => {
    const { request, tables, path } = await setup(t);
    await request('/api/agent/execute', { source: 'Alice donne un objet.', mode: 'write', code: 'const p=new Ref();addMemoryComposition("Alice","Nom",p);addMemoryPhrase(p,"donner",42);' });
    const sql = new DatabaseSync(path);
    try {
        const before = tables();
        const rows = sql.prepare('SELECT * FROM agent_calls').all();
        sql.exec("CREATE TRIGGER reject_reset BEFORE DELETE ON refs BEGIN SELECT RAISE(ABORT,'RAZ refusée'); END;");
        const reset = await request('/api/database/reset', { confirm: 'RAZ' });
        assert.equal(reset.status, 400);
        assert.match(reset.data.error, /RAZ refusée/);
        assert.deepEqual(tables(), before);
        assert.deepEqual(sql.prepare('SELECT * FROM agent_calls').all(), rows);
        sql.exec('DROP TRIGGER reject_reset');
        assert.equal((await request('/api/database/reset', { confirm: 'RAZ' })).status, 200);
    } finally { sql.close(); }
});

test('Exécution en cours : RAZ et autres écritures refusées, timeout historisé avant libération', async t => {
    const { request, path, tables } = await setup(t);
    const sql = new DatabaseSync(path);
    try {
        const insert = sql.prepare('INSERT INTO refs(value) VALUES (?)');
        for (let i = 0; i < 150; i++) insert.run(JSON.stringify({ $ref: 'ref-' + i }));
        const pending = request('/api/agent/execute', { source: 'Requête volontairement trop coûteuse.', code: 'print(query(select({a:"Ref",b:"Ref",c:"Ref",d:"Ref"},eq(phrase(variable("a"), "voir", variable("b")),phrase(variable("c"), "penser", variable("d"))))));' });
        let call;
        for (let i = 0; i < 100 && !call; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
            call = sql.prepare("SELECT * FROM agent_calls WHERE status='running'").get();
        }
        assert.ok(call, 'L’appel doit être enregistré avant son exécution.');
        assert.equal((await request('/api/database/reset', { confirm: 'RAZ' })).status, 429);
        assert.equal((await request('/api/execute', { code: 'print(1);' })).status, 429);
        assert.equal((await request('/api/agent/execute', { source: 'Autre appel.', code: 'print(1);' })).status, 429);
        assert.equal((await request('/api/scripts', { name: 'Occupé', code: '', mode: 'read' })).status, 429);
        const result = await pending;
        assert.equal(result.status, 408);
        assert.equal(result.data.callId, call.id);
        const finished = (await request('/api/agent/calls/' + call.id)).data.call;
        assert.equal(finished.status, 'failed');
        assert.equal(finished.httpStatus, 408);
        assert.deepEqual(finished.response, result.data);
        assert.equal(tables().find(table => table.name === 'agent_calls').rowCount, 1);
        assert.equal((await request('/api/database/reset', { confirm: 'RAZ' })).status, 200);
    } finally { sql.close(); }
});
