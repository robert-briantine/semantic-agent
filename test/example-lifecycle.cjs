const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ram = require('../dist/structure-langage-pour-ia');
const { Runtime, Ref } = require('../dist/runtime');
const { exampleScripts } = require('../dist/example-scripts');

test('Exemples : nettoyage RAM des contenus imbriqués, résultats réexécutables et finally en cas d’erreur', () => {
    ram.clearMemory();
    try {
        const existing = new ram.Ref();
        ram.addMemoryComposition('Nora', 'nom', existing);
        ram.addMemoryPhrase(existing, 'pense', ram.phrase(existing, 'valide', existing));
        const before = { compositions: [...ram.memoryComposition], phrases: [...ram.memoryRelation] };
        for (const id of ['f012', 'f018', 'f019', 'f023']) {
            const script = exampleScripts.find(script => script.id.endsWith(id));
            const execute = () => {
                const output = [];
                runInNewContext(script.code, { ...ram, print: (...args) => output.push(args) }, { timeout: 5000 });
                assert.deepEqual(ram.memoryComposition, before.compositions);
                assert.deepEqual(ram.memoryRelation, before.phrases);
                return output;
            };
            assert.deepEqual(execute(), execute(), script.name);
        }
        assert.throws(() => runInNewContext(exampleScripts[18].code, {
            ...ram, query: () => { throw Error('échec de requête'); }, print: () => {}
        }), /échec de requête/);
        assert.deepEqual(ram.memoryComposition, before.compositions);
        assert.deepEqual(ram.memoryRelation, before.phrases);
        assert.throws(() => ram.deleteReferences(['identifiant']), /tableau de Ref/);
    } finally { ram.clearMemory(); }
});

test('Exécution : finally, suppression protégée en lecture et annulation intégrale sur erreur', t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-example-lifecycle-'));
    const path = join(dir, 'memory.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const runtime = new Runtime(path), existing = new Ref();
    runtime.addMemoryComposition('Alice', 'Nom', existing);
    runtime.close();
    const snapshot = () => {
        const db = new DatabaseSync(path, { readOnly: true });
        try {
            return Object.fromEntries(['compositions', 'phrases', 'Complement', 'refs', 'primitive_values', 'fact_arguments']
                .map(table => [table, db.prepare('SELECT * FROM "' + table + '"').all()]));
        } finally { db.close(); }
    };
    const before = snapshot();
    const run = (code, mode = 'write') => {
        const child = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), mode], {
            env: { ...process.env, MEMORY_DB: path }, encoding: 'utf8'
        });
        assert.ok(child.stdout, child.stderr);
        return JSON.parse(child.stdout);
    };
    assert.deepEqual(run(`const p=new Ref();try{
        addMemoryComposition("Alice","Nom",p);
        print(query(select({nom:"string"},composition(variable("nom"),"Nom",p))));
    }finally{deleteReferences([p]);}
    print(query(select({},composition("Alice","Nom",p))));`), {
        ok: true, output: [[[{ nom: 'Alice' }]], [[]]]
    });
    assert.deepEqual(snapshot(), before);
    // Une erreur après insertion déclenche finally ; les autres écritures sont annulées.
    const failure = run(`const p=new Ref();try{
        addMemoryComposition("temporaire","Nom",p);fonctionInconnue();
    }finally{deleteReferences([p]);addMemoryComposition("à annuler","Nom",new Ref());}`);
    assert.equal(failure.ok, false);
    assert.match(failure.error, /fonctionInconnue/);
    assert.deepEqual(snapshot(), before);
    for (const code of [
        'deleteReferences([]);',
        'const supprimer=deleteReferences;supprimer([]);',
        'try{print("lecture");}finally{deleteReferences([]);}'
    ]) {
        const result = run(code, 'read');
        assert.equal(result.ok, false);
        assert.match(result.error, /Écriture interdite/);
        assert.deepEqual(snapshot(), before);
    }
    assert.match(run('deleteReferences(["identifiant"]);').error, /tableau de Ref/);
    assert.match(run('try{print("x");}catch(e){print(e);}').error, /TryStatement/);
    // finally s’exécute aussi lors d’un return et conserve sa valeur.
    assert.deepEqual(run('function valeur(){try{return 42;}finally{print("nettoyage");}}print(valeur());'), {
        ok: true, output: [['nettoyage'], [42]]
    });
    assert.deepEqual(snapshot(), before);
});
