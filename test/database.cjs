const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

async function startServer(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-database-'));
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, PORT: '0', HOST: '127.0.0.1', MEMORY_DB: join(dir, 'memory.sqlite') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill(); await exited;
        }
        rmSync(dir, { recursive: true, force: true });
    });
    const url = await new Promise((resolve, reject) => {
        let output = '', errors = '';
        const timer = setTimeout(() => reject(Error('Démarrage trop long')), 10000);
        child.stderr.on('data', chunk => { errors += chunk; });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(Error(errors)); });
        child.stdout.on('data', chunk => {
            output += chunk; const match = output.match(/Web app : (http:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    const request = (path, body) => fetch(new URL(path, url), body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const query = async (sql, options = {}) => {
        const response = await request('/api/database/query', { sql, ...options });
        return { status: response.status, ...await response.json() };
    };
    return { request, query, remove: (path, body) => fetch(new URL(path, url), {
        method: 'DELETE', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }) };
}

test('SQLite : les huit tables sont consultables avant toute exécution', async t => {
    const { request, query } = await startServer(t);
    const response = await request('/api/database/tables');
    assert.equal(response.status, 200);
    const { tables } = await response.json();
    assert.deepEqual(tables.map(table => table.name), ['Complement', 'agent_calls', 'compositions', 'fact_arguments', 'phrases', 'primitive_values', 'refs', 'saved_scripts']);
    for (const table of tables) {
        assert.equal(table.rowCount, 0);
        assert.ok(table.sql.startsWith('CREATE TABLE'));
        const result = await query('SELECT * FROM "' + table.name + '";');
        assert.equal(result.status, 200);
        assert.deepEqual(result.columns, table.columns.map(column => column.name));
        assert.deepEqual(result.rows, []);
        assert.equal(result.hasMore, false);
    }
});

test('SQLite : faits et scripts, pagination, jointures et valeurs JSON', async t => {
    const { request, query } = await startServer(t);
    const code = 'const p=new Ref();addMemoryComposition("Alice","Nom",p);addMemoryComposition(32,"Age",p);addMemoryComposition(true,"Actif",p);addMemoryPhrase(p,"dort");';
    assert.equal((await request('/api/execute', { mode: 'write', code })).status, 200);
    assert.equal((await request('/api/scripts', { name: 'Alice', code, mode: 'write' })).status, 201);
    const first = await query('SELECT * FROM compositions ORDER BY id;', { limit: 2 });
    assert.equal(first.status, 200);
    assert.equal(first.rows.length, 2);
    assert.equal(first.hasMore, true);
    const second = await query('SELECT * FROM compositions ORDER BY id;', { limit: 2, offset: 2 });
    assert.equal(second.rows.length, 1);
    assert.equal(second.offset, 2);
    assert.equal(second.hasMore, false);
    assert.ok(first.rows.every(row => row.id !== second.rows[0].id));
    const rows = await query(`WITH noms AS (SELECT of_value, json_extract(ref, '$') AS nom FROM compositions WHERE name='Nom')
        SELECT noms.nom, json_extract(c.ref, '$') AS age FROM noms JOIN compositions c ON c.of_value=noms.of_value WHERE c.name='Age';`);
    assert.deepEqual(rows.rows, [{ nom: 'Alice', age: 32 }]);
    assert.deepEqual((await query("SELECT name,qualifier FROM phrases WHERE name='dort'")).rows, [{ name: 'dort', qualifier: null }]);
    const scripts = await query('SELECT name,mode FROM saved_scripts');
    assert.deepEqual(scripts.rows, [{ name: 'Alice', mode: 'write' }]);
    const metadata = await (await request('/api/database/tables')).json();
    assert.deepEqual(Object.fromEntries(metadata.tables.map(table => [table.name, table.rowCount])), {
        Complement: 0, agent_calls: 0, compositions: 3, fact_arguments: 7, phrases: 1, primitive_values: 3, refs: 1, saved_scripts: 1
    });
    const values = await query("SELECT 1 AS valeur, 2 AS valeur, NULL AS vide, 9007199254740993 AS grand, x'00ff' AS binaire;");
    assert.deepEqual(values.columns, ['valeur', 'valeur:1', 'vide', 'grand', 'binaire']);
    assert.deepEqual(values.rows, [{ valeur: 1, 'valeur:1': 2, vide: null, grand: '9007199254740993', binaire: '0x00ff' }]);
});

test('SQLite : erreurs SQL et écritures refusées sans modifier les données', async t => {
    const { request, query } = await startServer(t);
    for (const sql of ['INSERT INTO refs VALUES (\'test\') RETURNING *', 'DELETE FROM refs', 'DROP TABLE refs', 'SELECT * FROM absente', 'SELECT FROM refs']) {
        const result = await query(sql);
        assert.equal(result.status, 400, sql);
        assert.equal(result.ok, false);
        assert.equal(typeof result.error, 'string');
    }
    for (const body of [{}, { sql: '' }, { sql: 42 }, { sql: 'SELECT 1', limit: 0 }, { sql: 'SELECT 1', limit: 1001 }, { sql: 'SELECT 1', offset: -1 }, { sql: 'SELECT 1', offset: 0.5 }]) {
        assert.equal((await request('/api/database/query', body)).status, 400);
    }
    assert.deepEqual((await query('SELECT * FROM refs')).rows, []);
    assert.deepEqual((await query('SELECT 42 AS reponse')).rows, [{ reponse: 42 }]);
});

test('SQLite : une requête lente est interrompue et le serveur reste disponible', async t => {
    const { request, query } = await startServer(t);
    const slow = query('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n;');
    assert.equal((await request('/health')).status, 200);
    const result = await slow;
    assert.equal(result.status, 408);
    assert.equal(result.ok, false);
    assert.deepEqual((await query('SELECT 1 AS resultat')).rows, [{ resultat: 1 }]);
});

test('API : aperçu puis suppression des faits liés à une référence, avec compléments imbriqués', async t => {
    const { request, query, remove } = await startServer(t);
    const execution = await request('/api/execute', { mode: 'write', code: 'const p=new Ref();const autre=new Ref();addMemoryComposition("Alice","Nom",p);addMemoryComposition("Bob","Nom",autre);addMemoryPhrase(autre,"pense",new Phrase(autre,"voit",[p]));print(p);' });
    assert.equal(execution.status, 200);
    const id = (await execution.json()).output[0][0].id;
    const endpoint = '/api/refs/' + encodeURIComponent(id);
    const preview = await (await request(endpoint)).json();
    assert.deepEqual(preview, { ok: true, refId: id, exists: true, compositions: 1, phrases: 1 });
    for (const body of [undefined, {}, { mode: 'read' }, { mode: 'admin' }]) {
        const refused = await remove(endpoint, body);
        assert.equal(refused.status, 403);
        assert.equal((await refused.json()).ok, false);
        assert.deepEqual(await (await request(endpoint)).json(), preview);
    }
    const response = await remove(endpoint, { mode: 'write' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.deleted, { compositions: 1, phrases: 1, refs: 1, primitiveValues: 1 });
    assert.deepEqual((await query('SELECT json_extract(ref,\'$\') AS nom FROM compositions')).rows, [{ nom: 'Bob' }]);
    assert.deepEqual((await query('SELECT * FROM phrases')).rows, []);
    assert.deepEqual(await (await request(endpoint)).json(), { ok: true, refId: id, exists: false, compositions: 0, phrases: 0 });
    assert.deepEqual((await (await remove(endpoint, { mode: 'write' })).json()).deleted, { compositions: 0, phrases: 0, refs: 0, primitiveValues: 0 });
});

test('API : sélection multiple, aperçu sans doublon et suppression en mode écriture uniquement', async t => {
    const { request, query } = await startServer(t);
    const execution = await request('/api/execute', { mode: 'write', code: 'const a=new Ref();const b=new Ref();const c=new Ref();addMemoryComposition(a,"Personne");addMemoryComposition(b,"Personne");addMemoryComposition(c,"Personne");addMemoryPhrase(a,"voit",b);addMemoryPhrase(a,"sait",c);addMemoryPhrase(c,"reste");print(a,b,c);' });
    assert.equal(execution.status, 200);
    const [a, b, c] = (await execution.json()).output[0];
    const refIds = [a.id, b.id, a.id];
    const preview = await (await request('/api/refs/preview', { refIds })).json();
    assert.deepEqual(preview, { ok: true, refIds: [a.id, b.id], existingRefs: 2, compositions: 2, phrases: 2 });
    for (const mode of [undefined, 'read', 'admin']) {
        assert.equal((await request('/api/refs/delete', { refIds, mode })).status, 403);
        assert.deepEqual(await (await request('/api/refs/preview', { refIds })).json(), preview);
    }
    for (const invalid of [undefined, [], 'abc', [1], [''], [a.id, null]]) {
        assert.equal((await request('/api/refs/preview', { refIds: invalid })).status, 400);
        assert.equal((await request('/api/refs/delete', { refIds: invalid, mode: 'write' })).status, 400);
    }
    const deletion = await request('/api/refs/delete', { refIds, mode: 'write' });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { ok: true, refIds: [a.id, b.id], deleted: { compositions: 2, phrases: 2, refs: 2, primitiveValues: 0 } });
    assert.deepEqual((await query('SELECT json_extract(ref,\'$.$ref\') AS id FROM compositions')).rows, [{ id: c.id }]);
    assert.deepEqual((await query('SELECT name FROM phrases')).rows, [{ name: 'reste' }]);
});
