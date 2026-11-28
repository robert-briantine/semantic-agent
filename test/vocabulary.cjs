const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const api = require('../dist/runtime');
const memory = require('../dist/structure-langage-pour-ia');
const { resetDatabase } = require('../dist/database');
const { vocabularyTables } = require('../dist/vocabulary');

test('Dictionnaires : initialisation locale, pas de doublons, catégories et conservation après RAZ', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-vocabulary-'));
    const path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let runtime = new api.Runtime(path);
    const db = new DatabaseSync(path);
    t.after(() => db.close());
    const counts = () => vocabularyTables.map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
    const before = counts();
    assert.ok(before[0] > 88000);
    assert.ok(before[1] > 43000);
    assert.equal(before[2], 148);
    assert.ok(db.prepare("SELECT 1 FROM lexique_verbes WHERE mot='manger'").get());
    for (const form of ['mange', 'mangent', 'mangeons', 'mangeait', 'mangeront', 'mangé', 'suis', 'étaient']) {
        assert.ok(db.prepare('SELECT 1 FROM lexique_verbes WHERE mot=?').get(form), form);
    }
    assert.ok(db.prepare("SELECT 1 FROM lexique_noms_communs WHERE mot='voiture'").get());
    assert.ok(!db.prepare("SELECT 1 FROM lexique_noms_communs WHERE mot='voitures'").get());
    assert.equal(db.prepare("SELECT nature FROM lexique_prepositions WHERE mot='à cause de'").get().nature, 'préposition');
    assert.equal(db.prepare("SELECT nature FROM lexique_prepositions WHERE mot='parce que'").get().nature, 'conjonction');
    runtime.close(); runtime = new api.Runtime(path);
    assert.deepEqual(counts(), before);
    runtime.addMemoryComposition(new api.Ref(), 'personne');
    runtime.close();
    const reset = resetDatabase(path);
    assert.ok(vocabularyTables.every(table => !Object.hasOwn(reset.deleted, table)));
    assert.deepEqual(counts(), before);
});

for (const [name, library] of [['SQLite', api], ['RAM', memory]]) {
    test(`${name} : mots connus par catégorie, formes canoniques et contrôle des expressions imbriquées`, t => {
        const runtime = name === 'SQLite' ? new api.Runtime(':memory:') : memory;
        if (name === 'RAM') memory.clearMemory();
        t.after(() => name === 'SQLite' ? runtime.close() : memory.clearMemory());
        const { Ref, select, variable, phrase, est, contient, all, implies, and } = library;
        const p = new Ref(), objet = new Ref();
        runtime.addMemoryComposition(p, 'personne');
        runtime.addMemoryComposition(objet, 'voiture');
        runtime.addMemoryComposition('Nom inventé Zyx', 'nom', p);
        runtime.addMemoryPhrase(p, 'possède', objet);
        runtime.addMemoryPhrase(p, ['travaille', 'rapidement'], ['à côté de', objet]);
        assert.equal(runtime.query(select({}, phrase(p, 'possède', objet))).length, 1);
        assert.equal(runtime.query(select({}, phrase(p, ['travaille', 'rapidement'], ['à côté de', objet]))).length, 1);
        for (const form of ['mange', 'mangent', 'mangeons', 'mangeait', 'mangeront', 'mangé', 'suis', 'étaient']) {
            runtime.addMemoryPhrase(p, form);
            assert.equal(runtime.query(select({}, phrase(p, form))).length, 1);
        }
        // Les mots de phrases conservent leur forme : aucun changement de temps implicite.
        assert.deepEqual(runtime.query(select({}, phrase(p, 'manger'))), []);
        assert.deepEqual(runtime.query(select({ n: 'string' }, est(variable('n'), 'nom', p))), [{ n: 'Nom inventé Zyx' }]);
        for (const word of ['personne', 'verbeinconnuzyx']) {
            assert.throws(() => runtime.addMemoryPhrase(p, word), /Verbe ou forme conjuguée inconnue/);
            assert.throws(() => runtime.query(['select', {}, ['phrase', p, word]]), /Verbe ou forme conjuguée inconnue/);
        }
        for (const word of ['voitures', 'une voiture', 'nomcommuninconnuzyx']) {
            assert.throws(() => runtime.addMemoryComposition(p, word), /Nom commun inconnu ou non singulier/);
            assert.throws(() => runtime.query(select({}, est(p, word))), /Nom commun inconnu ou non singulier/);
        }
        for (const word of ['objet', 'au', 'prépositioninconnuezyx', '', 'var']) {
            assert.throws(() => runtime.addMemoryPhrase(p, 'parler', [word, objet]), /Préposition ou locution inconnue/);
            assert.throws(() => runtime.query(select({}, contient([], [word, objet]))), /Préposition ou locution inconnue/);
        }
        assert.throws(() => runtime.addMemoryPhrase(p, 'pense', phrase(p, 'verbeinconnuzyx')), /Verbe ou forme conjuguée inconnue/);
        assert.throws(() => runtime.addMemoryPhrase(p, 'pense', all({ x: 'Ref' }, implies(true, phrase(variable('x'), 'verbeinconnuzyx')))), /Verbe ou forme conjuguée inconnue/);
        assert.throws(() => runtime.query(select({}, and(true, est(p, 'nomcommuninconnuzyx')))), /Nom commun inconnu/);
        runtime.addMemoryPhrase(p, 'partir', ['parce que', phrase(objet, 'rouler')]);
        assert.equal(runtime.query(select({}, phrase(p, 'partir', ['parce que', phrase(objet, 'rouler')]))).length, 1);
        // NFC, casse et apostrophe typographique n'empêchent pas la reconnaissance lexicale.
        runtime.addMemoryComposition(p, 'A\u0302ge');
        runtime.addMemoryPhrase(p, 'Travailler', ['jusqu’à', objet]);
    });
}

test('SQLite : les tables, et non la liste embarquée seule, déterminent les mots autorisés', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-dictionary-authority-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'memory.sqlite');
    const runtime = new api.Runtime(path), db = new DatabaseSync(path);
    t.after(() => { db.close(); runtime.close(); });
    db.prepare("DELETE FROM lexique_verbes WHERE mot='manger'").run();
    assert.throws(() => runtime.addMemoryPhrase(new api.Ref(), 'manger'), /Verbe ou forme conjuguée inconnue/);
    db.prepare("INSERT INTO lexique_verbes VALUES ('manger','manuel','verbe')").run();
    assert.doesNotThrow(() => runtime.addMemoryPhrase(new api.Ref(), 'manger'));
});

test('Dictionnaire : une base limitée aux infinitifs reçoit les conjugaisons sans doublons', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-conjugation-migration-'));
    const path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const db = new DatabaseSync(path);
    t.after(() => db.close());
    db.exec(`CREATE TABLE lexique_verbes(mot TEXT PRIMARY KEY,source TEXT NOT NULL,nature TEXT NOT NULL) WITHOUT ROWID;
        INSERT INTO lexique_verbes VALUES ('manger','lexique-4.15','verbe')`);
    let runtime = new api.Runtime(path);
    assert.ok(db.prepare("SELECT 1 FROM lexique_verbes WHERE mot='mange'").get());
    assert.equal(db.prepare("SELECT count(*) AS n FROM lexique_verbes WHERE mot='manger'").get().n, 1);
    const p = new api.Ref();
    runtime.addMemoryPhrase(p, 'mange');
    const count = db.prepare('SELECT count(*) AS n FROM lexique_verbes').get().n;
    runtime.close(); runtime = new api.Runtime(path);
    try {
        assert.equal(db.prepare('SELECT count(*) AS n FROM lexique_verbes').get().n, count);
        assert.equal(runtime.query(api.select({}, api.phrase(p, 'mange'))).length, 1);
    } finally { runtime.close(); }
});
