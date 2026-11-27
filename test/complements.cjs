const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const api = require('../dist/runtime');
const memory = require('../dist/structure-langage-pour-ia');
const { Runtime, Ref, Phrase, select, variable: v, fait, contient, and, not, exists, all, eq, compileQuery } = api;

function setup(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-complements-'));
    const path = join(dir, 'memory.sqlite');
    const db = new Runtime(path), sql = new DatabaseSync(path);
    t.after(() => { sql.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
    return { db, sql, path };
}

test('Complement : ordre, rôles, valeurs typées, expressions et phrases imbriquées', t => {
    const { db, sql } = setup(t);
    const alice = new Ref('alice'), bob = new Ref('bob');
    const nested = new Phrase(bob, 'dort', []);
    const complements = [bob, ['à', bob], ['', ''], 42, '42', false, ['not', true], nested, bob];
    db.addMemoryPhrase(alice, ['donne', 'souvent'], ...complements);
    db.addMemoryPhrase(bob, 'dort');
    assert.deepEqual(sql.prepare("SELECT name FROM pragma_table_info('Complement') ORDER BY cid").all().map(r => r.name), ['idPhrase', 'ordre', 'motClef', 'Element']);
    const rows = sql.prepare('SELECT * FROM Complement ORDER BY idPhrase,ordre').all();
    assert.deepEqual(rows.map(r => r.ordre), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(rows.map(r => r.motClef), [null, 'à', '', null, null, null, null, null, null]);
    assert.deepEqual(rows.map(r => JSON.parse(r.Element)), [{ $ref: 'bob' }, { $ref: 'bob' }, '', 42, '42', false, ['not', true], { $phrase: [{ $ref: 'bob' }, 'dort', []] }, { $ref: 'bob' }]);
    assert.ok(rows.every(r => r.idPhrase === 1));
    assert.deepEqual(db.query(select({ c: 'complements' }, fait(alice, ['donne', 'souvent'], v('c')))), [{ c: complements }]);
    assert.deepEqual(db.query(select({ c: 'complements' }, fait(bob, 'dort', v('c')))), [{ c: [] }]);
    assert.deepEqual(db.query(select({ c: 'complements' }, fait(alice, 'donne', v('c')))), []);
    assert.equal(db.query(select({}, fait(alice, ['donne', 'souvent'], ...complements))).length, 1);
});

for (const engine of ['SQLite', 'RAM']) test(`${engine} : fait lie la liste entière et contient filtre un complément exact`, t => {
    const lib = engine === 'SQLite' ? api : memory;
    const db = engine === 'SQLite' ? setup(t).db : memory;
    if (engine === 'RAM') { memory.clearMemory(); t.after(() => memory.clearMemory()); }
    const { Ref, Phrase, select, variable: v, fait, contient, and, not, exists, all, eq } = lib;
    const alice = new Ref(), bob = new Ref();
    const nested = new Phrase(bob, 'dort', []);
    const complements = [['à', bob], 42, '42', false, ['not', true], nested, ['à', bob]];
    db.addMemoryPhrase(alice, 'donne', ...complements);
    db.addMemoryPhrase(alice, 'répète', ...complements);
    db.addMemoryPhrase(bob, 'dort');
    const condition = and(fait(alice, 'donne', v('c')), contient(v('c'), ['à', v('dest')]));
    assert.deepEqual(db.query(select({ c: 'complements', dest: 'Ref', unused: 'string' }, condition)), [{ c: complements, dest: bob, unused: undefined }]);
    for (const value of [42, '42', false, ['not', true], nested, ['à', bob]]) {
        assert.equal(db.query(select({ c: 'complements' }, and(fait(alice, 'donne', v('c')), contient(v('c'), value)))).length, 1);
        assert.deepEqual(db.query(select({}, contient(complements, value))), [{}]);
    }
    for (const value of [bob, true, ['de', bob], ['à', alice], new Phrase(alice, 'dort')]) {
        assert.deepEqual(db.query(select({ c: 'complements' }, and(fait(alice, 'donne', v('c')), contient(v('c'), value)))), []);
        assert.deepEqual(db.query(select({}, contient(complements, value))), []);
    }
    for (const value of [1e-7, 1e21, '', 'texte \"cité\"', true]) {
        assert.deepEqual(db.query(select({}, contient([value], value))), [{}]);
    }
    assert.deepEqual(db.query(select({}, contient([], false))), []);
    assert.deepEqual(db.query(select({ c: 'complements' }, and(fait(bob, 'dort', v('c')), not(contient(v('c'), false))))), [{ c: [] }]);
    assert.equal(db.query(select({ n: 'number' }, exists({ c: 'complements' }, and(fait(alice, 'donne', v('c')), contient(v('c'), v('n'))))))[0].n, 42);
    assert.deepEqual(db.query(select({}, all({ c: 'complements' }, eq(v('c'), v('c'))))), [{}]);
    assert.deepEqual(db.query(select({ c: 'complements' }, exists({ c: 'complements' }, fait(alice, 'donne', v('c'))))), [{ c: undefined }]);
    assert.deepEqual(db.query(select({ c: 'complements' }, and(fait(alice, 'donne', v('c')), exists({ c: 'Ref' }, fait(alice, 'voit', v('c')))))), []);
    db.addMemoryPhrase(alice, 'voit', bob);
    assert.deepEqual(db.query(select({ c: 'complements' }, and(fait(alice, 'donne', v('c')), exists({ c: 'Ref' }, fait(alice, 'voit', v('c')))))), [{ c: complements }]);
    assert.deepEqual(db.query(select({ p: 'Ref' }, fait(alice, 'voit', v('p')))), [{ p: bob }]);
    assert.throws(() => db.query(select({ c: 'complements' }, contient(v('missing'), bob))), /Variable non déclarée/);
});

test('Complement : migration sans modifier les phrases, réouverture et nettoyage transactionnel', t => {
    const { db, sql, path } = setup(t);
    const alice = new Ref('alice'), bob = new Ref('bob');
    db.addMemoryPhrase(alice, 'donne', ['à', bob], 'cadeau');
    db.addMemoryPhrase(bob, 'reste');
    const before = sql.prepare('SELECT * FROM phrases ORDER BY id').all();
    sql.exec('DROP TRIGGER phrases_delete_complements; DROP TABLE Complement;');
    const migrated = new Runtime(path);
    try {
        assert.deepEqual(sql.prepare('SELECT * FROM phrases ORDER BY id').all(), before);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM Complement').get().n, 2);
        assert.equal(migrated.query(select({ c: 'complements' }, and(fait(alice, 'donne', v('c')), contient(v('c'), ['à', bob])))).length, 1);
        const compiled = compileQuery(select({ c: 'complements' }, contient(v('c'), ['à', bob])));
        const plan = sql.prepare('EXPLAIN QUERY PLAN ' + compiled.sql).all(compiled.params);
        assert.ok(plan.some(row => /complement_lookup/.test(row.detail)), JSON.stringify(plan));
        assert.throws(() => migrated.transaction(() => { migrated.addMemoryPhrase(alice, 'voit', bob); throw Error('annulation'); }), /annulation/);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM Complement').get().n, 2);
        assert.throws(() => migrated.transaction(() => { migrated.deleteReference(alice.id); throw Error('annulation'); }), /annulation/);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM Complement').get().n, 2);
        assert.equal(migrated.deleteReference(alice.id).deleted.phrases, 1);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM Complement').get().n, 0);
        assert.deepEqual(migrated.query(select({ c: 'complements' }, eq(v('c'), v('c')))), [{ c: [] }]);
        const reopened = new Runtime(path);
        try { assert.equal(sql.prepare('SELECT count(*) AS n FROM Complement').get().n, 0); }
        finally { reopened.close(); }
    } finally { migrated.close(); }
});

test('Exécuteur : contient et variable complements disponibles sans import', t => {
    const { db, path } = setup(t);
    db.addMemoryPhrase(new Ref('alice'), 'donne', ['à', new Ref('bob')], 42);
    const code = 'print(query(select({c:"complements",p:"Ref",s:"Ref"},and(["fait",["var","s"],"donne",["var","c"]],contient(variable("c"),["à",variable("p")])))));';
    const run = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), 'read'], { env: { ...process.env, MEMORY_DB: path }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).output[0][0], [{ c: [['à', { id: 'bob' }], 42], p: { id: 'bob' }, s: { id: 'alice' } }]);
});
