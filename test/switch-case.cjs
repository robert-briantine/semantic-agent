const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sql = require('../dist/runtime');
const memory = require('../dist/structure-langage-pour-ia');

for (const [name, api] of [['SQLite', sql], ['RAM', memory]]) {
    function setup(t) {
        const db = name === 'SQLite' ? new sql.Runtime(':memory:') : memory;
        if (name === 'RAM') memory.clearMemory();
        t.after(() => name === 'SQLite' ? db.close() : memory.clearMemory());
        return db;
    }
    const { Ref, switchCase, implies, select, variable, composition, phrase, eq, not, exists, all } = api;

    test(`${name} : switchCase choisit le premier cas vrai ou le défaut`, t => {
        const db = setup(t);
        for (const [cases, fallback, expected] of [
            [[], true, true],
            [[], false, false],
            [[implies(false, true), implies(false, true)], false, false],
            [[implies(false, false), implies(false, false)], true, true],
            [[implies(false, false), implies(true, true)], false, true],
            [[implies(true, false), implies(true, true)], true, false],
            [[implies(true, true), implies(true, false)], false, true]
        ]) {
            assert.deepEqual(db.query(select({}, switchCase(cases, fallback))), expected ? [{}] : []);
        }
        assert.deepEqual(db.query(select({}, not(switchCase([implies(true, false)], true)))), [{}]);
        const nested = switchCase([], switchCase([implies(true, true)], false));
        assert.deepEqual(db.query(select({}, nested)), [{}]);
    });

    test(`${name} : switchCase conserve les variables et les portées des quantificateurs`, t => {
        const db = setup(t);
        const a = new Ref(), b = new Ref(), c = new Ref();
        for (const ref of [a, b, c]) db.addMemoryComposition(ref, 'Personne');
        db.addMemoryComposition(a, 'Prioritaire');
        db.addMemoryPhrase(b, 'travailler');
        const condition = switchCase([
            implies(composition(variable('p'), 'Prioritaire'), false),
            implies(phrase(variable('p'), 'travailler'), eq(variable('p'), b))
        ], eq(variable('p'), c));
        assert.deepEqual(db.query(select({ p: 'Ref', unused: 'string' }, condition))
            .map(row => [row.p.id, row.unused]).sort(), [[b.id, undefined], [c.id, undefined]].sort());
        const quantified = switchCase([
            implies(exists({ p: 'Ref' }, composition(variable('p'), 'Personne')), true)
        ], false);
        assert.deepEqual(db.query(select({ p: 'Ref' }, quantified)), [{ p: undefined }]);
        const universal = all({ p: 'Ref' }, switchCase([
            implies(composition(variable('p'), 'Prioritaire'), eq(variable('p'), a))
        ], not(eq(variable('p'), a))));
        assert.deepEqual(db.query(select({}, universal)), [{}]);
        for (const invalid of [
            switchCase([implies(composition(variable('missing'), 'Personne'), true)], false),
            switchCase([implies(true, composition(variable('missing'), 'Personne'))], false),
            switchCase([], composition(variable('missing'), 'Personne'))
        ]) assert.throws(() => db.query(select({}, invalid)), /Variable non déclarée/);
    });

    test(`${name} : switchCase stocké conserve les littéraux de chaque cas et du défaut`, t => {
        const db = setup(t), person = new Ref();
        const belief = switchCase([
            implies(eq('premier', 'premier'), composition(7, 'Nombre')),
            implies(eq('suivant', 'suivant'), composition(11, 'Nombre'))
        ], eq('defaut', false));
        db.addMemoryPhrase(person, 'penser', belief);
        assert.deepEqual(db.query(select({ p: 'Ref' }, phrase(variable('p'), 'penser', belief)))
            .map(row => row.p.id), [person.id]);
        const values = type => db.query(select({ value: type }, eq(variable('value'), variable('value')))).map(row => row.value);
        assert.deepEqual(values('string').sort(), ['defaut', 'premier', 'suivant']);
        assert.deepEqual(values('number').sort((a, b) => a - b), [7, 11]);
        assert.deepEqual(values('boolean'), [false]);
    });
}

test('Exécuteur : switchCase est accessible dans les scripts sans import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-switch-case-'));
    try {
        const code = `
            print(query(select({}, switchCase([implies(false, false), implies(true, true)], false))));
            print(query(select({}, switchCase([implies(true, false), implies(true, true)], true))));
            print(query(select({}, switchCase([], true))));
        `;
        const result = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), 'read'], {
            env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const response = JSON.parse(result.stdout);
        assert.equal(response.ok, true);
        assert.deepEqual(response.output, [[[{}]], [[]], [[{}]]]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
