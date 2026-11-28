const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Runtime, Ref, composition, phrase, all, implies, variable, select, eq } = require('../dist/runtime');

function setup(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-delete-ref-'));
    const path = join(dir, 'memory.sqlite');
    const runtime = new Runtime(path), sql = new DatabaseSync(path);
    t.after(() => { sql.close(); runtime.close(); rmSync(dir, { recursive: true, force: true }); });
    return { runtime, sql, path };
}
function snapshot(sql) {
    return Object.fromEntries(['Complement', 'compositions', 'phrases', 'refs', 'primitive_values', 'fact_arguments'].map(table => [table,
        sql.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'Complement' ? 'idPhrase,ordre' : table === 'fact_arguments' ? 'type,value,fact_type,fact_id' : table === 'primitive_values' ? 'type,value' : table === 'refs' ? 'value' : 'id'}`).all()
    ]));
}

test('Suppression : références directes, compléments, propositions imbriquées et annuaires', t => {
    const { runtime, sql, path } = setup(t);
    const target = new Ref('cible'), other = new Ref('autre'), orphan = new Ref('orpheline'), prefix = new Ref('cible-suite');
    runtime.transaction(() => {
        runtime.addMemoryComposition(target, 'Personne');
        runtime.addMemoryComposition('Alice', 'Nom', target);
        runtime.addMemoryComposition(phrase(other, 'voir', target), 'Observation');
        runtime.addMemoryComposition(other, 'Relation', composition(target, 'imbrication'));
        runtime.addMemoryComposition('exclusif', 'Signal', target);
        runtime.addMemoryComposition(32, 'Nombre', target);
        runtime.addMemoryPhrase(target, 'dormir');
        runtime.addMemoryPhrase(other, 'voir', target);
        runtime.addMemoryPhrase(other, 'parler', ['à', target]);
        runtime.addMemoryPhrase(other, 'penser', phrase(other, 'affirmer', phrase(target, 'connaître', other)));
        runtime.addMemoryPhrase(other, 'croire', all({ p: 'Ref' }, implies(phrase(variable('p'), 'voir', target), composition(variable('p'), 'Personne'))));
        runtime.addMemoryPhrase(other, 'répéter', new Ref(target.id), ['avec', target], orphan);
        runtime.addMemoryPhrase(other, 'dire', false, target);
        // Faits indépendants, y compris des textes identiques à l’ID ou à son JSON.
        runtime.addMemoryComposition(other, 'Personne');
        runtime.addMemoryComposition('Bob', 'Nom', other);
        runtime.addMemoryComposition(32, 'Nombre', other);
        runtime.addMemoryComposition(target.id, 'code', other);
        runtime.addMemoryComposition(JSON.stringify({ $ref: target.id }), 'format', other);
        runtime.addMemoryComposition(prefix, 'Personne');
        runtime.addMemoryPhrase(prefix, 'rester', other);
    });
    const plan = sql.prepare("EXPLAIN QUERY PLAN SELECT fact_id FROM fact_arguments WHERE type='Ref' AND value=?").all(JSON.stringify({ $ref: target.id }));
    assert.ok(plan.some(row => /SEARCH .*PRIMARY KEY/.test(row.detail)), JSON.stringify(plan));
    assert.deepEqual(runtime.deleteReference(target.id), { refId: target.id, deleted: { compositions: 8, phrases: 11, refs: 2, primitiveValues: 3 } });
    assert.equal(runtime.memoryComposition.length, 6);
    assert.deepEqual(runtime.memoryRelation.map(value => value[2]), ['rester']);
    assert.deepEqual(runtime.query(select({ p: 'Ref' }, eq(variable('p'), variable('p')))).map(row => row.p.id).sort(), [other.id, prefix.id].sort());
    assert.deepEqual(runtime.query(select({ n: 'number' }, eq(variable('n'), variable('n')))), [{ n: 32 }]);
    assert.deepEqual(runtime.query(select({ b: 'boolean' }, eq(variable('b'), variable('b')))), []);
    assert.deepEqual(runtime.query(select({ s: 'string' }, eq(variable('s'), variable('s')))).map(row => row.s).sort(), ['Bob', target.id, JSON.stringify({ $ref: target.id })].sort());
    assert.equal(sql.prepare("SELECT count(*) AS n FROM fact_arguments WHERE type='Ref' AND value=?").get(JSON.stringify({ $ref: target.id })).n, 0);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM fact_arguments WHERE fact_type='composition' AND fact_id NOT IN (SELECT id FROM compositions)").get().n, 0);
    const reopened = new Runtime(path);
    try {
        assert.equal(reopened.memoryComposition.length, 6);
        assert.deepEqual(reopened.deleteReference(target.id).deleted, { compositions: 0, phrases: 0, refs: 0, primitiveValues: 0 });
    } finally { reopened.close(); }
});

test('Migration : l’index des arguments est reconstruit pour les faits existants', t => {
    const { runtime, sql, path } = setup(t);
    const target = new Ref(), other = new Ref();
    runtime.addMemoryComposition('Nom', 'Nom', target);
    runtime.addMemoryPhrase(other, 'penser', phrase(other, 'voir', target, new Ref(target.id)));
    const before = { compositions: sql.prepare('SELECT * FROM compositions').all(), phrases: sql.prepare('SELECT * FROM phrases').all() };
    sql.exec('DROP TRIGGER compositions_delete_arguments; DROP TRIGGER phrases_delete_arguments; DROP TABLE fact_arguments;');
    const migrated = new Runtime(path);
    try {
        assert.deepEqual(sql.prepare('SELECT * FROM compositions').all(), before.compositions);
        assert.deepEqual(sql.prepare('SELECT * FROM phrases').all(), before.phrases);
        assert.equal(sql.prepare("SELECT count(*) AS n FROM fact_arguments WHERE type='Ref' AND value=?").get(JSON.stringify({ $ref: target.id })).n, 3);
        const result = migrated.deleteReference(target.id);
        assert.equal(result.deleted.compositions, 1);
        assert.equal(result.deleted.phrases, 2);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM fact_arguments').get().n, 0);
    } finally { migrated.close(); }
});

test('Suppression transactionnelle : une erreur restaure les faits et tous les index', t => {
    const { runtime, sql } = setup(t);
    const ref = new Ref();
    runtime.addMemoryComposition('Alice', 'Nom', ref);
    runtime.addMemoryPhrase(ref, 'penser', 42);
    const before = snapshot(sql);
    sql.exec("CREATE TRIGGER reject_phrase_delete BEFORE DELETE ON phrases BEGIN SELECT RAISE(ABORT,'échec simulé'); END;");
    assert.throws(() => runtime.deleteReference(ref.id), /échec simulé/);
    assert.deepEqual(snapshot(sql), before);
    sql.exec('DROP TRIGGER reject_phrase_delete');
    assert.throws(() => runtime.transaction(() => { runtime.deleteReference(ref.id); throw Error('annulation'); }), /annulation/);
    assert.deepEqual(snapshot(sql), before);
    assert.equal(runtime.deleteReference(ref.id).deleted.phrases, 1);
});

test('Une erreur d’indexation annule aussi une insertion directe de phrase', t => {
    const { runtime, sql } = setup(t);
    const before = snapshot(sql);
    sql.exec("CREATE TRIGGER reject_argument BEFORE INSERT ON fact_arguments BEGIN SELECT RAISE(ABORT,'index indisponible'); END;");
    assert.throws(() => runtime.addMemoryComposition('Alice', 'Nom', new Ref()), /index indisponible/);
    assert.deepEqual(snapshot(sql), before);
    assert.throws(() => runtime.addMemoryPhrase(new Ref(), 'penser', 42), /index indisponible/);
    assert.deepEqual(snapshot(sql), before);
});

test('Suppression groupée : références et faits communs dédupliqués', t => {
    const { runtime, sql } = setup(t);
    const a = new Ref(), b = new Ref(), c = new Ref();
    for (const ref of [a, b, c]) runtime.addMemoryComposition(ref, 'Personne');
    runtime.addMemoryPhrase(a, 'voir', b);
    runtime.addMemoryPhrase(a, 'savoir', c);
    runtime.addMemoryPhrase(c, 'rester');
    assert.deepEqual(runtime.deleteReferences([a.id, b.id, a.id]), {
        refIds: [a.id, b.id], deleted: { compositions: 2, phrases: 2, refs: 2, primitiveValues: 0 }
    });
    assert.deepEqual(runtime.memoryComposition.map(value => value[1].id), [c.id]);
    assert.deepEqual(runtime.memoryRelation.map(value => value[2]), ['rester']);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM fact_arguments').get().n, 2);
});

test('Suppression groupée : une erreur sur la seconde référence annule aussi la première', t => {
    const { runtime, sql } = setup(t);
    const a = new Ref(), b = new Ref();
    runtime.addMemoryComposition('Alice', 'Nom', a);
    runtime.addMemoryComposition('Bob', 'Nom', b);
    runtime.addMemoryPhrase(a, 'agir');
    runtime.addMemoryPhrase(b, 'bloquer');
    const before = snapshot(sql);
    sql.exec("CREATE TRIGGER reject_second_delete BEFORE DELETE ON phrases WHEN OLD.name='bloquer' BEGIN SELECT RAISE(ABORT,'seconde référence'); END;");
    assert.throws(() => runtime.deleteReferences([a.id, b.id]), /seconde référence/);
    assert.deepEqual(snapshot(sql), before);
});
