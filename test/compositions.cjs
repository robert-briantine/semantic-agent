const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sql = require('../dist/runtime');
const ram = require('../dist/structure-langage-pour-ia');
const { inspectDatabase } = require('../dist/database');

for (const [name, api] of [['SQLite', sql], ['RAM', ram]]) test(`${name} : composition unique, éléments imbriqués, domaine et contexte`, t => {
    const db = name === 'SQLite' ? new sql.Runtime(':memory:') : ram;
    if (name === 'RAM') ram.clearMemory();
    t.after(() => name === 'SQLite' ? db.close() : ram.clearMemory());
    const { Ref, composition, phrase, select, variable: v, eq, not, and, all, implies, contient, exists } = api;
    const alice = new Ref(), bob = new Ref();
    const property = composition(bob, 'personne');
    assert.deepEqual(property, ['composition', bob, 'personne']);
    assert.deepEqual(composition(bob, 'personne', undefined), property);
    assert.equal(api.Composition, undefined);
    assert.equal(api.est, undefined);
    assert.deepEqual(db.query(select({ c: 'Composition' }, eq(v('c'), property))), []);
    db.addMemoryPhrase(alice, 'pense', property, property);
    assert.deepEqual(db.query(select({ c: 'Composition' }, eq(v('c'), property))), [{ c: property }]);
    assert.deepEqual(db.query(select({}, property)), []);
    assert.deepEqual(db.query(select({}, not(property))), [{}]);
    assert.deepEqual(db.query(select({ c: 'Composition' }, phrase(alice, 'pense', v('c'), v('c')))), [{ c: property }]);
    db.addMemoryPhrase(alice, 'affirme', property);
    assert.deepEqual(db.query(select({ c: 'Composition' }, phrase(alice, 'affirme', v('c')))), [{ c: property }]);
    const raw = ['composition', bob, 'personne', undefined];
    assert.deepEqual(db.addMemoryPhrase(alice, 'dit', raw), ['phrase', alice, 'dit', property]);
    assert.deepEqual(db.query(select({ c: 'Composition' }, phrase(alice, 'dit', v('c')))), [{ c: property }]);
    const rawNested = composition(raw, 'observation');
    db.addMemoryPhrase(alice, 'voit', rawNested);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, eq(v('p'), ['phrase', alice, 'voit', rawNested]))), [{ p: ['phrase', alice, 'voit', composition(property, 'observation')] }]);
    assert.deepEqual(db.query(select({ p: 'Ref' }, phrase(alice, 'affirme', composition(v('p'), 'personne')))), [{ p: bob }]);
    assert.deepEqual(db.query(select({ c: 'complements' }, and(phrase(alice, 'affirme', v('c')), contient(v('c'), property)))), [{ c: [property] }]);
    const sleep = phrase(bob, 'dort');
    db.addMemoryComposition(not(property), 'observation', sleep);
    assert.deepEqual(db.query(select({}, composition(not(property), 'observation', sleep))), [{}]);
    assert.deepEqual(db.query(select({}, sleep)), []);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, eq(v('p'), sleep))), [{ p: sleep }]);
    assert.deepEqual(db.query(select({}, property)), []);
    const rule = all({ x: 'Ref' }, implies(composition(v('x'), 'personne'), phrase(v('x'), 'dort')));
    db.addMemoryPhrase(alice, 'croit', rule);
    assert.deepEqual(db.query(select({}, phrase(alice, 'croit', rule))), [{}]);
    assert.deepEqual(db.addMemoryComposition(bob, 'personne'), property);
    assert.deepEqual(db.query(select({}, property)), [{}]);
    assert.deepEqual(db.query(select({ c: 'Composition', unused: 'string' }, eq(v('c'), ['composition', bob, 'personne', undefined]))), [{ c: property, unused: undefined }]);
    assert.deepEqual(db.query(select({ c: 'Composition' }, exists({ c: 'Ref' }, composition(v('c'), 'personne')))), [{ c: undefined }]);
    for (const value of [0, false, '']) {
        db.addMemoryComposition(value, 'valeur', bob);
        const expected = composition(value, 'valeur', bob);
        assert.deepEqual(db.query(select({ c: 'Composition' }, eq(v('c'), expected))), [{ c: expected }]);
    }
    assert.throws(() => db.query(['select', {}, ['est', bob, 'personne']]), /Expression « est » remplacée/);
    assert.throws(() => db.addMemoryPhrase(alice, 'pense', { ref: bob, name: 'personne', of: undefined }), /Composition objet interdite/);
    assert.throws(() => db.query(select({ c: 'Composition' }, composition(v('missing'), 'personne'))), /Variable non déclarée/);
});

test('SQLite : compositions et phrases dépendantes dédupliquées, persistantes et supprimées ensemble', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-composition-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let db = new sql.Runtime(path);
    const alice = new sql.Ref('alice'), bob = new sql.Ref('bob');
    const property = sql.composition(bob, 'personne');
    const nested = sql.composition(sql.not(property), 'observation', sql.phrase(bob, 'dort'));
    db.addMemoryPhrase(alice, 'pense', nested, nested);
    const raw = new DatabaseSync(path);
    try {
        assert.deepEqual(raw.prepare('SELECT owner_type,owner_id FROM compositions ORDER BY id').all().map(r => ({ ...r })), [{ owner_type: 'phrase', owner_id: 1 }, { owner_type: 'phrase', owner_id: 1 }]);
        assert.equal(db.memoryComposition.length, 0);
        assert.equal(db.memoryRelation.length, 1);
        assert.equal(inspectDatabase(path, { action: 'reference', refId: alice.id }).compositions, 2);
        assert.equal(inspectDatabase(path, { action: 'references', refIds: [alice.id, alice.id] }).phrases, 2);
        db.close(); db = new sql.Runtime(path);
        assert.deepEqual(db.query(sql.select({ c: 'Composition' }, sql.eq(sql.variable('c'), property))), [{ c: property }]);
        const before = raw.prepare('SELECT id,value FROM compositions ORDER BY id').all();
        assert.throws(() => db.transaction(() => { db.deleteReference(alice.id); throw Error('annulation'); }), /annulation/);
        assert.deepEqual(raw.prepare('SELECT id,value FROM compositions ORDER BY id').all(), before);
        assert.equal(db.deleteReference(alice.id).deleted.compositions, 2);
        for (const table of ['compositions', 'phrases', 'Complement', 'refs', 'primitive_values', 'fact_arguments']) assert.equal(raw.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table);
    } finally { raw.close(); db.close(); }
});

function legacy(path) {
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TABLE compositions(id INTEGER PRIMARY KEY,ref TEXT NOT NULL,name TEXT NOT NULL,of_value TEXT NOT NULL,value TEXT NOT NULL,qualifier TEXT);
        CREATE TABLE phrases(id INTEGER PRIMARY KEY,subject TEXT NOT NULL,name TEXT NOT NULL,complements TEXT NOT NULL,value TEXT NOT NULL,qualifier TEXT,owner_type TEXT,owner_id INTEGER);`);
    const alice = { $ref: 'alice' }, bob = { $ref: 'bob' }, absent = { $undefined: true };
    const old = { $composition: [bob, 'personne', absent] };
    const belief = ['phrase', alice, 'pense', old, ['not', ['est', bob, ['personne', 'active']]]];
    raw.prepare('INSERT INTO compositions VALUES (?,?,?,?,?,?)').run(11, JSON.stringify(alice), 'personne', JSON.stringify(absent), JSON.stringify({ $composition: [alice, 'personne', absent] }), null);
    raw.prepare('INSERT INTO phrases VALUES (?,?,?,?,?,?,?,?)').run(20, JSON.stringify(alice), 'pense', JSON.stringify(belief.slice(3)), JSON.stringify(belief), null, null, null);
    return raw;
}

test('Migration : anciens objets et tuples est convertis sans perdre identifiants ni contexte', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-composition-migration-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const raw = legacy(path);
    let db = new sql.Runtime(path);
    try {
        const property = sql.composition(new sql.Ref('bob'), 'personne');
        assert.equal(db.memoryComposition[0][0], 'composition');
        assert.equal(raw.prepare('SELECT id FROM compositions WHERE owner_type IS NULL').get().id, 11);
        assert.equal(raw.prepare('SELECT id FROM phrases WHERE owner_type IS NULL').get().id, 20);
        assert.deepEqual(db.memoryRelation[0][3], property);
        assert.deepEqual(db.memoryRelation[0][4], sql.not(sql.composition(new sql.Ref('bob'), ['personne', 'active'])));
        assert.deepEqual(db.query(sql.select({}, property)), []);
        assert.equal(raw.prepare('SELECT count(*) AS n FROM compositions').get().n, 3);
        assert.ok(!raw.prepare('SELECT value FROM phrases UNION ALL SELECT value FROM compositions').all().some(row => /\$composition|"est"/.test(row.value)));
        const snapshot = () => Object.fromEntries(['compositions', 'phrases', 'Complement', 'fact_arguments', 'primitive_values', 'refs'].map(table => [table, raw.prepare('SELECT * FROM ' + table).all()]));
        const before = snapshot();
        db.close(); db = new sql.Runtime(path);
        assert.deepEqual(snapshot(), before);
        db.deleteReference('alice');
        for (const [table, rows] of Object.entries(snapshot())) assert.equal(rows.length, 0, table);
    } finally { db.close(); raw.close(); }
});

test('Migration : une erreur restaure les valeurs et le schéma, puis permet de réessayer', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-composition-rollback-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const raw = legacy(path);
    try {
        const before = { compositions: raw.prepare('SELECT * FROM compositions').all(), phrases: raw.prepare('SELECT * FROM phrases').all() };
        raw.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON compositions BEGIN SELECT RAISE(ABORT,'échec migration'); END;");
        assert.throws(() => new sql.Runtime(path), /échec migration/);
        assert.deepEqual(raw.prepare('SELECT * FROM compositions').all(), before.compositions);
        assert.deepEqual(raw.prepare('SELECT * FROM phrases').all(), before.phrases);
        assert.equal(raw.prepare("SELECT count(*) AS n FROM pragma_table_info('compositions') WHERE name='owner_type'").get().n, 0);
        raw.exec('DROP TRIGGER reject_update');
        const db = new sql.Runtime(path);
        try { assert.equal(db.memoryComposition[0][0], 'composition'); } finally { db.close(); }
    } finally { raw.close(); }
});

test('Exécuteur : composition utilisable sans import, classe et helper est supprimés', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-composition-exec-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = code => JSON.parse(spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), 'write'], { env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8' }).stdout);
    const result = run('const a=new Ref();const b=new Ref();try{addMemoryPhrase(a,"pense",composition(b,"personne"));print(query(select({c:"Composition"},phrase(a,"pense",variable("c")))));print(query(select({},["composition",b,"personne"])));}finally{deleteReferences([a,b]);}');
    assert.equal(result.ok, true, result.error);
    assert.equal(result.output[0][0][0].c[0], 'composition');
    assert.deepEqual(result.output[1], [[]]);
    assert.match(run('est(new Ref(),"personne");').error, /Variable inconnue : est/);
    assert.match(run('new Composition(new Ref(),"personne");').error, /Variable inconnue : Composition/);
});
