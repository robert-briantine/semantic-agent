const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { Runtime, Ref, Phrase, select, variable, est, fait, and, exists, all, eq, compileQuery } = require('../dist/runtime');
const memory = require('../dist/structure-langage-pour-ia');

function setup(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-projection-'));
    const path = join(dir, 'memory.sqlite'), db = new Runtime(path);
    t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    return { db, path };
}
test('Select : les variables inutilisées valent undefined, même avec un domaine vide ou rempli', t => {
    const { db } = setup(t);
    const a = new Ref(), b = new Ref();
    db.addMemoryComposition(a, 'Personne'); db.addMemoryComposition(b, 'Personne');
    const query = select({ n: 'string', p: 'Ref', age: 'number', actif: 'boolean', action: 'Phrase' }, est(variable('p'), 'Personne'));
    const check = () => {
        const rows = db.query(query);
        assert.equal(rows.length, 2);
        assert.deepEqual(rows.map(row => row.p.id).sort(), [a.id, b.id].sort());
        for (const row of rows) {
            assert.deepEqual(Object.keys(row), ['n', 'p', 'age', 'actif', 'action']);
            for (const key of ['n', 'age', 'actif', 'action']) { assert.ok(Object.hasOwn(row, key)); assert.equal(row[key], undefined); }
        }
    };
    check();
    db.addMemoryComposition('Alice', 'Nom', a); db.addMemoryComposition('Bob', 'Nom', b);
    db.addMemoryComposition(42, 'Age', a); db.addMemoryComposition(true, 'Actif', a); db.addMemoryPhrase(a, 'dort');
    check();
    assert.doesNotMatch(compileQuery(query).sql, /primitive_values/);
    assert.deepEqual(db.query(select({ n: 'string' }, est(variable('n'), 'Nom', a))), [{ n: 'Alice' }]);
    assert.deepEqual(db.query(select({ p: 'Ref', n: 'string' }, and(est(variable('p'), 'Personne'), est(variable('n'), 'Inconnu', variable('p'))))), []);
});

test('Select : condition constante, validation et demande explicite d’un domaine', t => {
    const { db } = setup(t);
    assert.deepEqual(db.query(select({ p: 'Ref', n: 'string' }, true)), [{ p: undefined, n: undefined }]);
    assert.deepEqual(db.query(select({ p: 'Ref', n: 'string' }, false)), []);
    assert.deepEqual(db.query(select({}, true)), [{}]);
    assert.deepEqual(db.query(select({ n: 'string' }, eq(variable('n'), variable('n')))), []);
    db.addMemoryComposition('Alice', 'Nom', new Ref());
    assert.deepEqual(db.query(select({ n: 'string' }, true)), [{ n: undefined }]);
    assert.deepEqual(db.query(select({ n: 'string' }, eq(variable('n'), variable('n')))), [{ n: 'Alice' }]);
    assert.throws(() => db.query(select({ unused: 'Date' }, true)), /Type de variable invalide/);
    assert.throws(() => db.query(select({ p: 'Ref' }, est(variable('missing'), 'Personne'))), /Variable non déclarée/);
});

test('Select : portées des quantificateurs, masquage et variables capturées', t => {
    const { db } = setup(t);
    const a = new Ref(), b = new Ref();
    db.addMemoryComposition(a, 'Personne'); db.addMemoryComposition(b, 'Personne');
    db.addMemoryPhrase(a, 'connaît', b);
    const shadow = db.query(select({ p: 'Ref', n: 'string' }, and(
        est(variable('p'), 'Personne'), exists({ n: 'Ref' }, eq(variable('n'), variable('p')))
    )));
    assert.equal(shadow.length, 2); assert.ok(shadow.every(row => row.n === undefined));
    assert.deepEqual(db.query(select({ n: 'string' }, exists({ n: 'Ref' }, est(variable('n'), 'Personne')))), [{ n: undefined }]);
    assert.deepEqual(db.query(select({ p: 'Ref' }, and(est(variable('p'), 'Personne'), exists({ n: 'string' }, true)))), []);
    assert.equal(db.query(select({ p: 'Ref' }, and(est(variable('p'), 'Personne'), all({ n: 'string' }, false)))).length, 2);
    const captured = db.query(select({ p: 'Ref', n: 'string' }, exists({ x: 'Ref' }, fait(variable('x'), 'connaît', variable('p')))));
    assert.equal(captured.length, 1); assert.equal(captured[0].p.id, b.id); assert.equal(captured[0].n, undefined);
    db.addMemoryComposition('Alice', 'Nom', a);
    assert.deepEqual(db.query(select({ n: 'string' }, exists({ x: 'Ref' }, est(variable('n'), 'Nom', variable('x'))))), [{ n: 'Alice' }]);
});

test('Select : variables dans les phrases imbriquées et noms littéraux', t => {
    const { db } = setup(t);
    const a = new Ref(), b = new Ref();
    db.addMemoryPhrase(a, 'pense', new Phrase(b, 'voit', [a]));
    const rows = db.query(select({ p: 'Ref', n: 'string' }, fait(a, 'pense', new Phrase(variable('p'), 'voit', [a]))));
    assert.equal(rows.length, 1); assert.equal(rows[0].p.id, b.id); assert.equal(rows[0].n, undefined);
    db.addMemoryPhrase(a, 'n', ['n', 'valeur']);
    assert.deepEqual(db.query(select({ n: 'string' }, fait(a, 'n', ['n', 'valeur']))), [{ n: undefined }]);
    const belief = all({ n: 'Ref' }, est(variable('n'), 'Personne'));
    db.addMemoryPhrase(a, 'pense', belief);
    const beliefs = db.query(select({ p: 'Ref', n: 'string' }, fait(variable('p'), 'pense', belief)));
    assert.equal(beliefs.length, 1); assert.equal(beliefs[0].p.id, a.id); assert.equal(beliefs[0].n, undefined);
});

test('La librairie de référence en RAM applique la même projection et les types primitifs', () => {
    memory.clearMemory();
    try {
        const ref = new memory.Ref(); memory.addMemoryComposition(ref, 'Personne');
        const q = memory.select({ p: 'Ref', n: 'string' }, memory.est(memory.variable('p'), 'Personne'));
        assert.deepEqual(memory.query(q), [{ p: ref, n: undefined }]);
        memory.addMemoryComposition('Alice', 'Nom', ref); memory.addMemoryComposition(32, 'Age', ref);
        assert.deepEqual(memory.query(q), [{ p: ref, n: undefined }]);
        assert.deepEqual(memory.query(memory.select({ n: 'string' }, memory.est(memory.variable('n'), 'Nom', ref))), [{ n: 'Alice' }]);
        assert.deepEqual(memory.query(memory.select({ n: 'number' }, memory.est(memory.variable('n'), 'Age', ref))), [{ n: 32 }]);
        assert.deepEqual(memory.query(memory.select({ n: 'string' }, memory.exists({ n: 'Ref' }, memory.est(memory.variable('n'), 'Personne')))), [{ n: undefined }]);
    } finally { memory.clearMemory(); }
});

test('Exécution : undefined est conservé dans les résultats et encodé explicitement dans le JSON', t => {
    const { db, path } = setup(t);
    db.addMemoryComposition(new Ref(), 'Personne'); db.addMemoryComposition(new Ref(), 'Personne');
    const code = 'const personnes=query(select({p:"Ref",n:"string"},est(variable("p"),"Personne")));print(personnes);print(personnes[0].n===undefined);';
    const execution = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), 'read'], { env: { ...process.env, MEMORY_DB: path }, encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stdout + execution.stderr);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.output[0][0].length, 2);
    for (const row of result.output[0][0]) assert.deepEqual(row.n, { $undefined: true });
    assert.deepEqual(result.output[1], [true]);
});
