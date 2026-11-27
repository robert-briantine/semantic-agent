const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Runtime, Ref, Phrase, est, fait, variable, select } = require('../dist/runtime');

const names = ['Personne', ['Personne', 'célèbre'], ['Personne', ''], '["Personne","célèbre"]', '"Personne"', 'true', 'null', '', 'l’homme "célèbre"'];

function checkNames(runtime, refs) {
    names.forEach((name, index) => {
        assert.deepEqual(runtime.query(select({ p: 'Ref' }, est(variable('p'), name))).map(row => row.p.id), [refs[index].id]);
        assert.deepEqual(runtime.query(select({ p: 'Ref' }, fait(variable('p'), name))).map(row => row.p.id), [refs[index].id]);
    });
    assert.deepEqual(runtime.memoryComposition.map(value => value.name), names);
    assert.deepEqual(runtime.memoryRelation.map(value => value.name), names);
}

test('Noms SQL en texte brut : qualificatifs distincts, caractères spéciaux et réouverture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-names-'));
    const path = join(dir, 'memory.sqlite');
    let runtime = new Runtime(path), sql;
    try {
        const refs = names.map(() => new Ref());
        runtime.transaction(() => names.forEach((name, index) => {
            runtime.addMemoryComposition(refs[index], name);
            runtime.addMemoryPhrase(refs[index], name);
        }));
        checkNames(runtime, refs);
        sql = new DatabaseSync(path);
        for (const table of ['compositions', 'phrases']) {
            assert.deepEqual(sql.prepare(`SELECT name,qualifier FROM ${table} ORDER BY id`).all().map(row => ({ ...row })), names.map(name => ({
                name: typeof name === 'string' ? name : name[0], qualifier: typeof name === 'string' ? null : name[1]
            })));
            assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE name='Personne'`).get().n, 3);
            assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE name='Personne' AND qualifier IS NULL`).get().n, 1);
            assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE name='Personne' AND qualifier=''`).get().n, 1);
        }
        runtime.close(); runtime = new Runtime(path);
        checkNames(runtime, refs);
        const belief = new Phrase(refs[0], ['dort', 'profondément']);
        runtime.addMemoryPhrase(refs[1], 'pense', belief);
        assert.equal(runtime.query(select({ p: 'Ref' }, fait(variable('p'), 'pense', belief)))[0].p.id, refs[1].id);
        assert.deepEqual(runtime.query(select({ p: 'Ref' }, fait(variable('p'), 'pense', new Phrase(refs[0], 'dort')))), []);
    } finally { sql?.close(); runtime.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Migration des noms JSON : faits, identités, qualificatifs et index conservés', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-names-migration-'));
    const path = join(dir, 'memory.sqlite');
    let runtime, sql = new DatabaseSync(path);
    try {
        // Schéma réellement utilisé avant l’ajout de la colonne qualifier.
        sql.exec(`
            CREATE TABLE refs(value TEXT PRIMARY KEY);
            CREATE TABLE compositions(id INTEGER PRIMARY KEY,ref TEXT NOT NULL,name TEXT NOT NULL,of_value TEXT NOT NULL,value TEXT NOT NULL);
            CREATE TABLE phrases(id INTEGER PRIMARY KEY,subject TEXT NOT NULL,name TEXT NOT NULL,complements TEXT NOT NULL,value TEXT NOT NULL);
            CREATE INDEX comp_lookup ON compositions(name,ref,of_value);
            CREATE INDEX comp_reverse ON compositions(name,of_value,ref);
            CREATE INDEX phrase_lookup ON phrases(name,subject,complements);
            CREATE INDEX phrase_reverse ON phrases(name,complements,subject);
        `);
        const refs = names.map((_, index) => new Ref('legacy-' + index));
        names.forEach((name, index) => {
            const ref = { $ref: refs[index].id }, absent = { $undefined: true };
            sql.prepare('INSERT INTO refs VALUES (?)').run(JSON.stringify(ref));
            sql.prepare('INSERT INTO compositions VALUES (?,?,?,?,?)').run(index + 10, JSON.stringify(ref), JSON.stringify(name), JSON.stringify(absent), JSON.stringify({ $composition: [ref, name, absent] }));
            sql.prepare('INSERT INTO phrases VALUES (?,?,?,?,?)').run(index + 20, JSON.stringify(ref), JSON.stringify(name), '[]', JSON.stringify({ $phrase: [ref, name, []] }));
        });
        const before = Object.fromEntries(['compositions', 'phrases'].map(table => [table, sql.prepare(`SELECT id,value FROM ${table} ORDER BY id`).all()]));
        sql.close(); sql = undefined;
        runtime = new Runtime(path);
        checkNames(runtime, refs);
        sql = new DatabaseSync(path);
        for (const table of ['compositions', 'phrases']) {
            assert.deepEqual(sql.prepare(`SELECT id,value FROM ${table} ORDER BY id`).all(), before[table]);
            assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE name='Personne'`).get().n, 3);
            assert.equal(sql.prepare(`SELECT name FROM ${table} WHERE name=?`).get('"Personne"').name, '"Personne"');
        }
        assert.deepEqual(sql.prepare("PRAGMA index_info('comp_lookup')").all().map(row => row.name), ['name', 'ref', 'of_value', 'qualifier']);
        assert.deepEqual(sql.prepare("PRAGMA index_info('phrase_lookup')").all().map(row => row.name), ['name', 'subject', 'complements', 'qualifier']);
        assert.equal(sql.prepare('SELECT count(*) AS n FROM primitive_values').get().n, 0);
        runtime.close(); runtime = new Runtime(path);
        checkNames(runtime, refs);
        for (const table of ['compositions', 'phrases']) assert.deepEqual(sql.prepare(`SELECT id,value FROM ${table} ORDER BY id`).all(), before[table]);
    } finally { sql?.close(); runtime?.close(); rmSync(dir, { recursive: true, force: true }); }
});
