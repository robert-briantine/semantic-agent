const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sql = require('../dist/runtime');
const memory = require('../dist/structure-langage-pour-ia');

for (const [engine, api] of [['SQLite', sql], ['RAM', memory]]) {
    test(`${engine} : les chaînes sont interdites en complément, y compris dans les expressions imbriquées`, t => {
        const db = engine === 'SQLite' ? new sql.Runtime(':memory:') : memory;
        if (engine === 'RAM') memory.clearMemory();
        t.after(() => engine === 'SQLite' ? db.close() : memory.clearMemory());
        const { Ref, phrase, contient, select, variable, all, exists, and, not, switchCase, implies, eq, est } = api;
        const auteur = new Ref(), objet = new Ref();
        const error = /Chaîne interdite comme complément/;
        for (const value of ['rapport', '', ['objet', 'rapport'], ['objet', '']]) {
            assert.throws(() => db.addMemoryPhrase(auteur, 'envoyer', value), error);
            assert.throws(() => db.query(select({}, phrase(auteur, 'envoyer', value))), error);
            assert.throws(() => db.query(select({}, contient([value], objet))), error);
            assert.throws(() => db.query(select({}, contient([], value))), error);
            assert.throws(() => phrase(auteur, 'envoyer', value), error);
            // Une mutation manuelle ne doit pas contourner la validation à l'entrée du moteur.
            const nested = phrase(auteur, 'envoyer');
            nested.push(value);
            assert.throws(() => db.addMemoryPhrase(auteur, 'penser', nested), error);
            assert.throws(() => db.addMemoryComposition(nested, 'Croyance'), error);
            assert.throws(() => db.query(select({}, eq(nested, nested))), error);
            assert.throws(() => db.query(select({}, switchCase([implies(false, phrase(auteur, 'envoyer', value))], true))), error);
        }
        const s = variable('s');
        for (const expression of [
            phrase(auteur, 'dire', s), phrase(auteur, 'dire', ['objet', s]),
            contient([], s), contient([], ['objet', s]), contient([s], objet),
            not(phrase(auteur, 'dire', s)),
            exists({ s: 'string' }, phrase(auteur, 'dire', s)),
            all({ s: 'string' }, phrase(auteur, 'dire', ['objet', s]))
        ]) assert.throws(() => db.query(['select', { s: 'string' }, expression]), error);
        assert.throws(() => db.query(['select', {}, ['phrase', auteur, 'envoyer', ['objet', 'rapport']]]), error);
        assert.throws(() => db.addMemoryPhrase(auteur, 'croire', all({ s: 'string' }, phrase(auteur, 'dire', s))), error);
        assert.equal((engine === 'SQLite' ? db.memoryRelation : memory.memoryRelation).length, 0);
        assert.equal((engine === 'SQLite' ? db.memoryComposition : memory.memoryComposition).length, 0);

        db.addMemoryComposition(objet, 'Rapport');
        db.addMemoryComposition('Rapport annuel', 'Titre', objet);
        db.addMemoryPhrase(auteur, 'envoyer', objet, 42, false, eq('texte', 'texte'));
        assert.equal(db.query(select({}, phrase(auteur, 'envoyer', objet, 42, false, eq('texte', 'texte')))).length, 1);
        assert.deepEqual(db.query(select({ titre: 'string' }, est(variable('titre'), 'Titre', objet))), [{ titre: 'Rapport annuel' }]);
        db.addMemoryPhrase(auteur, 'voir', objet);
        // Le Ref local masque la variable string extérieure.
        assert.deepEqual(db.query(select({ s: 'string' }, exists({ s: 'Ref' }, phrase(auteur, 'voir', s)))), [{ s: undefined }]);
        // La variable string ne sert ici qu'à chercher une composition.
        assert.equal(db.query(select({ s: 'string' }, and(
            est(s, 'Titre', objet), exists({ autre: 'Ref' }, phrase(auteur, 'voir', variable('autre')))
        ))).length, 1);
    });
}

test('Exécuteur : une chaîne en complément annule toutes les écritures du script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-complement-rules-'));
    try {
        const run = (code, mode) => {
            const result = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), mode], {
                env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8'
            });
            return JSON.parse(result.stdout);
        };
        for (const value of ['"rapport"', '["objet","rapport"]', 'phrase(p, "décrire", "rapport")']) {
            const result = run(`const p=new Ref();addMemoryComposition(p,"Personne");addMemoryPhrase(p,"envoyer",${value});`, 'write');
            assert.equal(result.ok, false);
            assert.match(result.error, /Chaîne interdite comme complément/);
        }
        assert.deepEqual(run('print(query(select({p:"Ref"},est(variable("p"),"Personne"))));', 'read').output, [[[]]]);
        const invalidQuery = run('print(query(select({s:"string"},phrase(new Ref(),"dire",variable("s")))));', 'read');
        assert.equal(invalidQuery.ok, false);
        assert.match(invalidQuery.error, /Chaîne interdite comme complément/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
