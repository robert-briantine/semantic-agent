const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Runtime, Ref, variable, est, phrase, select, and, or, eq, all, exists, implies } = require('../dist/runtime');

test('Select : valeurs primitives, jointures, quantificateurs et persistance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-primitives-'));
    const path = join(dir, 'memory.sqlite');
    let db = new Runtime(path);
    try {
        for (const type of ['string', 'number', 'boolean']) {
            assert.deepEqual(db.query(select({ value: type }, eq(variable("value"), variable("value")))), []);
        }
        const person = new Ref();
        const objet = new Ref();
        db.transaction(() => {
            db.addMemoryComposition('Alice', 'Nom', person);
            db.addMemoryComposition(42, 'Age', person);
            db.addMemoryComposition(true, 'Actif', person);
            db.addMemoryComposition('42', 'Code', person);
            db.addMemoryComposition(0, 'Mesure', person);
            db.addMemoryComposition(-2.5, 'Mesure', person);
            db.addMemoryComposition('Alice', 'Nom', person);
            db.addMemoryComposition(objet, 'Rapport');
            db.addMemoryComposition('rapport', 'Nom', objet);
            db.addMemoryPhrase(person, 'posséder', objet, ['avec', 1.5], ['sans', false]);
        });
        const query = select({ p: 'Ref', nom: 'string', age: 'number', actif: 'boolean' }, and(
            est(variable('p'), 'Personne'),
            est(variable('nom'), 'Nom', variable('p')),
            est(variable('age'), 'Age', variable('p')),
            est(variable('actif'), 'Actif', variable('p'))
        ));
        db.addMemoryComposition(person, 'Personne');
        const rows = db.query(query);
        assert.equal(rows.length, 1);
        assert.ok(rows[0].p instanceof Ref);
        assert.deepEqual({ ...rows[0], p: rows[0].p.id }, { p: person.id, nom: 'Alice', age: 42, actif: true });
        const values = type => db.query(select({ value: type }, eq(variable("value"), variable("value")))).map(row => row.value);
        assert.deepEqual(values('string').sort(), ['42', 'Alice', 'rapport']);
        assert.deepEqual(values('number').sort((a, b) => a - b), [-2.5, 0, 1.5, 42]);
        assert.deepEqual(values('boolean').sort(), [false, true]);
        assert.deepEqual(db.query(select({ value: 'number' }, eq(variable('value'), '42'))), []);
        assert.deepEqual(db.query(select({ value: 'boolean' }, eq(variable('value'), false))), [{ value: false }]);
        assert.deepEqual(db.query(select({ label: 'string', weight: 'number', valid: 'boolean' }, and(
            est(variable('label'), 'Nom', objet),
            phrase(person, 'posséder', objet, ['avec', variable('weight')], ['sans', variable('valid')])))),
            [{ label: 'rapport', weight: 1.5, valid: false }]);
        assert.deepEqual(db.query(select({ value: 'string' }, and(
            est(variable('value'), 'Nom', person),
            exists({ value: 'number' }, est(variable('value'), 'Age', person)),
            all({ flag: 'boolean' }, or(eq(variable('flag'), false), eq(variable('flag'), true)))
        ))), [{ value: 'Alice' }]);
        const mixed = db.query(select({ relation: 'Phrase', label: 'string' }, and(
            eq(variable('relation'), phrase(person, 'posséder', objet, ['avec', 1.5], ['sans', false])),
            eq(variable('label'), 'rapport')
        )));
        assert.equal(mixed.length, 1);
        assert.deepEqual(mixed[0].relation, phrase(person, 'posséder', objet, ['avec', 1.5], ['sans', false]));
        assert.throws(() => db.query(select({ value: 'Date' }, true)), /Type de variable invalide/);
        assert.throws(() => db.transaction(() => {
            db.addMemoryComposition(999, 'annulation', person);
            db.addMemoryComposition('annulé', 'annulation', person);
            throw Error('rollback');
        }), /rollback/);
        assert.ok(!values('number').includes(999));
        assert.ok(!values('string').includes('annulé'));
        db.close();
        db = new Runtime(path);
        assert.deepEqual(db.query(query).map(row => ({ ...row, p: row.p.id })), [{ p: person.id, nom: 'Alice', age: 42, actif: true }]);
        assert.deepEqual(values('boolean').sort(), [false, true]);
    } finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Migration des bases existantes et valeurs dans les propositions imbriquées', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-primitives-migration-'));
    const path = join(dir, 'memory.sqlite');
    let db = new Runtime(path);
    try {
        const person = new Ref();
        db.addMemoryComposition('Alice', 'Nom', person);
        db.addMemoryComposition(12, 'Age', person);
        const belief = all({ name: 'string' }, implies(est(variable('name'), 'Nom'), eq(variable('name'), 'Bob')));
        db.addMemoryPhrase(person, 'penser', belief);
        db.addMemoryPhrase(person, 'affirmer', phrase('capteur', 'mesurer', ['avec', 1.25], ['sans', false]));
        db.addMemoryComposition('tous', 'Groupe', person);
        db.addMemoryPhrase(person, 'attribuer', ['pour', false], ['depuis', 3]);
        db.close();
        // L'ancien schéma possède les faits, mais aucun domaine de valeurs primitives.
        const legacy = new DatabaseSync(path);
        legacy.exec('DROP TABLE primitive_values');
        legacy.close();
        db = new Runtime(path);
        const values = type => db.query(select({ value: type }, eq(variable("value"), variable("value")))).map(row => row.value);
        assert.deepEqual(values('string').sort(), ['Alice', 'Bob', 'capteur', 'tous']);
        assert.deepEqual(values('number').sort((a, b) => a - b), [1.25, 3, 12]);
        assert.deepEqual(values('boolean'), [false]);
        assert.deepEqual(db.query(select({ name: 'string' }, est(variable('name'), 'Nom', person))), [{ name: 'Alice' }]);
        assert.equal(db.query(select({ p: 'Ref' }, phrase(variable('p'), 'penser', belief)))[0].p.id, person.id);
        db.close();
        db = new Runtime(path);
        assert.deepEqual(values('string').sort(), ['Alice', 'Bob', 'capteur', 'tous']);
    } finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
