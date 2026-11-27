const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function runtime(t) {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-functions-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return (code, mode = 'read') => {
        const result = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), mode], {
            env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8', timeout: 5000
        });
        assert.ifError(result.error);
        assert.ok(result.stdout, result.stderr);
        return JSON.parse(result.stdout);
    };
}

test('Fonctions nommées : paramètres TypeScript, appels anticipés et requêtes', t => {
    const run = runtime(t);
    const result = run(`
        const paul = creerPersonne("Paul");
        function creerPersonne(nom: string): Ref {
            const ref = new Ref();
            addMemoryComposition(ref, "Personne");
            addMemoryComposition(nom, "nom", ref);
            return ref;
        }
        function personnes() {
            return query(select({ p: "Ref", n: "string" }, and(
                est(variable("p"), "Personne"), est(variable("n"), "nom", variable("p"))
            )));
        }
        print(personnes()[0].n, personnes()[0].p.id === paul.id);
    `, 'write');
    assert.deepEqual(result, { ok: true, output: [['Paul', true]] });
    assert.deepEqual(run('function noms() { return query(select({n:"string"},eq(variable("n"),variable("n")))); } print(noms());'),
        { ok: true, output: [[[{ n: 'Paul' }]]] });
});

test('Fonctions fléchées, expressions nommées, paramètres par défaut et rest', t => {
    const run = runtime(t);
    assert.deepEqual(run(`
        const identity = <T>(value: T): T => value;
        const collect = (label = "défaut", ...values: unknown[]) => ({ label, values });
        function forward(...values: unknown[]) { return collect(undefined, ...values); }
        const object = { f: (x: number) => x * 2 };
        const named = function self(n: number): number { return n > 0 ? self(n - 1) + 1 : 0; };
        function nothing() { return; print("inaccessible"); }
        function implicitReturn() { const local = 1; }
        print(identity(7), forward(false, 0, ""), object.f(3), named(4));
        print(nothing() === undefined, implicitReturn() === undefined);
    `), { ok: true, output: [[7, { label: 'défaut', values: [false, 0, ''] }, 6, 4], [true, true]] });
});

test('Portées lexicales, fermetures indépendantes et retours depuis les blocs', t => {
    const run = runtime(t);
    assert.deepEqual(run(`
        const label = "global";
        function lexical() { return label; }
        function caller() { const label = "local"; return lexical(); }
        function makeCounter(label: string) {
            let count = 0;
            return () => { count = count + 1; return { label, count }; };
        }
        const first = makeCounter("premier");
        const second = makeCounter("second");
        function choose(value: boolean) {
            if (value) { const label = "bloc"; return label; }
            else { return label; }
        }
        print(first(), first(), second(), caller(), choose(true), choose(false));
    `), { ok: true, output: [[{ label: 'premier', count: 1 }, { label: 'premier', count: 2 },
        { label: 'second', count: 1 }, 'global', 'bloc', 'global']] });
    assert.match(run('const x="extérieur"; function read(){print(x);const x="intérieur";} read();').error, /avant son initialisation/);
    assert.match(run('function f(){const x=1; x=2;} f();').error, /constante/);
    assert.match(run('function f(){const local=1;} f(); print(local);').error, /Variable inconnue/);
});

test('Récursion, récursion mutuelle et limites d’exécution', t => {
    const run = runtime(t);
    assert.deepEqual(run(`
        function factorial(n: number): number { if (n <= 1) return 1; return n * factorial(n - 1); }
        function even(n: number): boolean { if (n === 0) return true; return odd(n - 1); }
        function odd(n: number): boolean { if (n === 0) return false; return even(n - 1); }
        print(factorial(5), even(6), odd(3));
    `), { ok: true, output: [[120, true, true]] });
    assert.match(run('function recurse(){return recurse();} recurse();').error, /Profondeur maximale/);
    assert.match(run('function tree(n){if(n===0)return 1;return tree(n-1)+tree(n-1);} tree(15);').error, /Limite d’instructions/);
});

test('Les fonctions et alias conservent le mode lecture seule et le rollback', t => {
    const run = runtime(t);
    const code = `
        const write = addMemoryComposition;
        function invoke(fn) { const p = new Ref(); fn("Paul", "nom", p); return p; }
        invoke(write);
    `;
    assert.match(run(code).error, /Écriture interdite/);
    assert.equal(run(code, 'write').ok, true);
    const failure = run(`
        function create() { addMemoryComposition("À annuler", "nom", new Ref()); }
        function fail() { return process.exit(); }
        create(); fail();
    `, 'write');
    assert.equal(failure.ok, false);
    assert.deepEqual(run('print(query(select({n:"string"},eq(variable("n"),variable("n")))));'), { ok: true, output: [[[{ n: 'Paul' }]]] });
    const limit = run(`
        addMemoryComposition("Annulé par limite", "nom", new Ref());
        function recurse(){return recurse();} recurse();
    `, 'write');
    assert.equal(limit.ok, false);
    assert.deepEqual(run('print(query(select({n:"string"},eq(variable("n"),variable("n")))));'), { ok: true, output: [[[{ n: 'Paul' }]]] });
});

test('Les fonctions restent interprétées et n’exposent pas les objets de l’hôte', t => {
    const run = runtime(t);
    for (const code of [
        'function f(){return require("fs");} f();',
        'const f=()=>eval("process"); f();',
        'function f(){} f.constructor("return process")();',
        'function f(){} print(f.scope);',
        'const f=print; f.call(null,"test");',
        'const Constructor=Ref; new Constructor("identité-forgée");',
        'async function f(){return 1;} f();',
        'function* f(){yield 1;} f();',
        'function f({x}) { return x; } f({x:1});',
        'function f(){while(true){}} f();',
        'return 1;'
    ]) assert.equal(run(code).ok, false, code);
    assert.deepEqual(run('function f(){return 1;} print(f);'), { ok: true, output: [['[Function]']] });
});
