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

for (const [name, api] of [['SQLite', sql], ['RAM', ram]]) test(`${name} : un seul tuple de phrase, domaines imbriqués et distinction du contexte`, t => {
    const db = name === 'SQLite' ? new sql.Runtime(':memory:') : ram;
    if (name === 'RAM') ram.clearMemory();
    t.after(() => name === 'SQLite' ? db.close() : ram.clearMemory());
    const { Ref, phrase, select, variable, eq, not, all, implies, composition, contient } = api;
    const alice = new Ref(), bob = new Ref(), rapport = new Ref();
    const sommeil = phrase(bob, 'dort');
    assert.deepEqual(sommeil, ['phrase', bob, 'dort']);
    assert.equal(api.Phrase, undefined);
    assert.equal(api.fait, undefined);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, eq(variable('p'), sommeil))), []);
    assert.deepEqual(db.addMemoryPhrase(alice, 'pense', sommeil, ['parce que', phrase(bob, 'demande', rapport)]),
        ['phrase', alice, 'pense', sommeil, ['parce que', ['phrase', bob, 'demande', rapport]]]);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, eq(variable('p'), sommeil))), [{ p: sommeil }]);
    assert.deepEqual(db.query(select({}, phrase(bob, 'dort'))), []);
    assert.deepEqual(db.query(select({ c: 'complements' }, api.and(
        phrase(alice, 'pense', variable('c')), contient(variable('c'), sommeil)
    ))), [{ c: [sommeil, ['parce que', phrase(bob, 'demande', rapport)]] }]);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, phrase(alice, 'pense', variable('p'), ['parce que', phrase(bob, 'demande', rapport)]))), [{ p: sommeil }]);
    // Les phrases servent aussi de sujet et d’arguments de composition.
    const validation = phrase(bob, 'valide', rapport);
    db.addMemoryPhrase(validation, 'concerne', rapport);
    db.addMemoryComposition(not(validation), 'observation', sommeil);
    assert.deepEqual(db.query(select({ p: 'Phrase' }, eq(variable('p'), validation))), [{ p: validation }]);
    assert.deepEqual(db.query(select({}, phrase(bob, 'valide', rapport))), []);
    assert.deepEqual(db.query(select({}, composition(not(validation), 'observation', sommeil))), [{}]);
    const regle = all({ x: 'Ref' }, implies(composition(variable('x'), 'personne'), phrase(variable('x'), 'dort')));
    db.addMemoryPhrase(alice, 'affirme', regle);
    assert.deepEqual(db.query(select({}, phrase(alice, 'affirme', regle))), [{}]);
    db.addMemoryPhrase(bob, 'dort');
    assert.deepEqual(db.query(select({}, sommeil)), [{}]);
    assert.throws(() => db.query(['select', {}, ['fait', bob, 'dort']]), /Expression « fait » remplacée/);
    assert.throws(() => db.addMemoryPhrase(alice, 'pense', ['fait', bob, 'dort']), /Expression « fait » remplacée/);
    const oldObject = { subject: bob, name: 'dort', complements: [] };
    assert.throws(() => db.addMemoryPhrase(alice, 'pense', oldObject), /Phrase objet interdite/);
});

test('SQLite : lignes imbriquées persistantes, propriétaires et nettoyage sans résidus', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-phrase-storage-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let db = new sql.Runtime(path);
    const alice = new sql.Ref(), bob = new sql.Ref(), rapport = new sql.Ref();
    const contenu = sql.phrase(bob, 'prépare', rapport, ['avec', false], 0);
    db.addMemoryPhrase(alice, 'pense', contenu, contenu);
    db.addMemoryComposition(bob, 'personne');
    db.addMemoryComposition('Budget', 'nom', rapport);
    db.addMemoryComposition(sql.not(contenu), 'observation');
    db.close(); db = new sql.Runtime(path);
    const raw = new DatabaseSync(path);
    try {
        const rows = raw.prepare('SELECT id,owner_type,owner_id,value FROM phrases ORDER BY id').all();
        assert.equal(rows.length, 3); // Une ligne par contenu et par propriétaire.
        assert.deepEqual(rows.map(row => row.owner_type), [null, 'phrase', 'composition']);
        assert.equal(rows[1].owner_id, rows[0].id);
        assert.ok(rows.every(row => JSON.parse(row.value)[0] === 'phrase'));
        assert.equal(raw.prepare('SELECT count(*) AS n FROM Complement').get().n, 8);
        assert.deepEqual(db.query(sql.select({ p: 'Phrase' }, sql.eq(sql.variable('p'), contenu))), [{ p: contenu }]);
        assert.deepEqual(db.query(sql.select({}, contenu)), []);
        // L’aperçu inclut les lignes dépendantes, même sans Alice dans leur sujet.
        assert.equal(inspectDatabase(path, { action: 'reference', refId: alice.id }).phrases, 2);
        assert.equal(inspectDatabase(path, { action: 'references', refIds: [alice.id, alice.id] }).phrases, 2);
        assert.equal(db.deleteReference(alice.id).deleted.phrases, 2);
        assert.equal(raw.prepare('SELECT count(*) AS n FROM phrases').get().n, 1);
        assert.deepEqual(db.query(sql.select({ p: 'Phrase' }, sql.eq(sql.variable('p'), contenu))), [{ p: contenu }]);
        db.deleteReferences([bob.id, rapport.id]);
        for (const table of ['phrases', 'compositions', 'Complement', 'refs', 'primitive_values', 'fact_arguments'])
            assert.equal(raw.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table);
    } finally { raw.close(); db.close(); }
});

function legacy(path) {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE refs(value TEXT PRIMARY KEY);
        CREATE TABLE compositions(id INTEGER PRIMARY KEY,ref TEXT NOT NULL,name TEXT NOT NULL,of_value TEXT NOT NULL,value TEXT NOT NULL,qualifier TEXT);
        CREATE TABLE phrases(id INTEGER PRIMARY KEY,subject TEXT NOT NULL,name TEXT NOT NULL,complements TEXT NOT NULL,value TEXT NOT NULL,qualifier TEXT);`);
    const alice = { $ref: 'alice' }, bob = { $ref: 'bob' }, rapport = { $ref: 'rapport' }, absent = { $undefined: true };
    for (const ref of [alice, bob, rapport]) db.prepare('INSERT INTO refs VALUES (?)').run(JSON.stringify(ref));
    const contents = [{ $phrase: [bob, ['dort', 'profondément'], []] }, ['parce que', ['fait', bob, 'demande', rapport]], ['not', ['fait', bob, 'valide', rapport]]];
    db.prepare('INSERT INTO phrases VALUES (?,?,?,?,?,?)').run(20, JSON.stringify(alice), 'pense', JSON.stringify(contents), JSON.stringify({ $phrase: [alice, 'pense', contents] }), null);
    const expression = ['fait', bob, 'prépare', rapport];
    db.prepare('INSERT INTO compositions VALUES (?,?,?,?,?,?)').run(9, JSON.stringify(expression), 'observation', JSON.stringify(absent), JSON.stringify({ $composition: [expression, 'observation', absent] }), null);
    return db;
}

test('Migration : anciens objets et tuples fait convertis sans perdre les identités, contexte ou index', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-phrase-migration-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const raw = legacy(path);
    const beforeRefs = raw.prepare('SELECT * FROM refs ORDER BY value').all();
    let db = new sql.Runtime(path);
    try {
        assert.deepEqual(raw.prepare('SELECT * FROM refs ORDER BY value').all(), beforeRefs);
        assert.equal(raw.prepare('SELECT count(*) AS n FROM phrases').get().n, 5);
        assert.equal(raw.prepare('SELECT count(*) AS n FROM phrases WHERE owner_type IS NULL AND id=20').get().n, 1);
        assert.equal(raw.prepare('SELECT count(*) AS n FROM compositions WHERE id=9').get().n, 1);
        const body = db.memoryRelation[0];
        assert.equal(body[0], 'phrase');
        assert.deepEqual(body[3], sql.phrase(new sql.Ref('bob'), ['dort', 'profondément']));
        assert.deepEqual(db.query(sql.select({}, sql.phrase(new sql.Ref('bob'), ['dort', 'profondément']))), []);
        assert.deepEqual(db.query(sql.select({}, body)), [{}]);
        assert.ok(!raw.prepare("SELECT value FROM phrases").all().some(row => /\$phrase|"fait"/.test(row.value)));
        const snapshot = () => Object.fromEntries(['compositions', 'phrases', 'Complement', 'primitive_values', 'fact_arguments', 'refs']
            .map(table => [table, raw.prepare('SELECT * FROM ' + table).all()]));
        const before = snapshot();
        db.close(); db = new sql.Runtime(path);
        assert.deepEqual(snapshot(), before);
        db.deleteReferences(['alice', 'bob', 'rapport']);
        for (const [table, rows] of Object.entries(snapshot())) assert.equal(rows.length, 0, table);
    } finally { raw.close(); db.close(); }
});

test('Migration : un échec restaure les anciennes valeurs et le schéma, puis peut être relancé', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-phrase-migration-rollback-')), path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const raw = legacy(path);
    try {
        const before = { phrases: raw.prepare('SELECT * FROM phrases').all(), compositions: raw.prepare('SELECT * FROM compositions').all() };
        raw.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON phrases BEGIN SELECT RAISE(ABORT,'migration interrompue'); END;");
        assert.throws(() => new sql.Runtime(path), /migration interrompue/);
        assert.deepEqual(raw.prepare('SELECT * FROM phrases').all(), before.phrases);
        assert.deepEqual(raw.prepare('SELECT * FROM compositions').all(), before.compositions);
        assert.equal(raw.prepare("SELECT count(*) AS n FROM pragma_table_info('phrases') WHERE name='owner_type'").get().n, 0);
        raw.exec('DROP TRIGGER reject_migration');
        const db = new sql.Runtime(path);
        try { assert.equal(db.memoryRelation[0][0], 'phrase'); }
        finally { db.close(); }
    } finally { raw.close(); }
});

test('Exécuteur : phrase et tuples bruts disponibles ; ancien helper et constructeur absents', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-phrase-executor-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = code => JSON.parse(spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), 'write'], {
        env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8'
    }).stdout);
    const result = run('const a=new Ref();const b=new Ref();try{addMemoryPhrase(a,"pense",phrase(b,"dort"));print(query(select({},["phrase",a,"pense",["phrase",b,"dort"]])));print(query(select({},phrase(b,"dort"))));}finally{deleteReferences([a,b]);}');
    assert.deepEqual(result, { ok: true, output: [[[{}]], [[]]] });
    assert.match(run('fait(new Ref(),"dort");').error, /Variable inconnue : fait/);
    assert.match(run('new Phrase(new Ref(),"dort");').error, /Variable inconnue : Phrase/);
});
