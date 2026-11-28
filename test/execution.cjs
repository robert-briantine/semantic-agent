const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
test('Exécution restreinte, persistance, rollback, lecture seule',()=>{const dir=mkdtempSync(join(tmpdir(),'semantic-exec-'));try{const run=(code,mode='read')=>{const r=spawnSync(process.execPath,['dist/execute.js',Buffer.from(code).toString('base64'),mode],{env:{...process.env,MEMORY_DB:join(dir,'m.db')},encoding:'utf8'});return JSON.parse(r.stdout);};assert.equal(run('const p = new Ref(); addMemoryComposition("Jean","Nom",p);','write').ok,true);assert.equal(run('print(query(select({p:"Ref"},composition("Jean","Nom",variable("p")))));').output[0][0].length,1);assert.equal(run('addMemoryComposition("Test","Nom",new Ref());').ok,false);assert.equal(run('addMemoryComposition("Test","Nom",new Ref()); process.exit();','write').ok,false);assert.equal(run('print(query(select({p:"Ref"},composition("Test","Nom",variable("p")))));').output[0][0].length,0);assert.equal(run('require("fs");').ok,false);}finally{rmSync(dir,{recursive:true,force:true});}});

test('L’exécuteur conserve les types primitifs, y compris chaîne vide, zéro et false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-exec-primitives-'));
    try {
        const run = (code, mode = 'read') => {
            const result = spawnSync(process.execPath, ['dist/execute.js', Buffer.from(code).toString('base64'), mode], {
                env: { ...process.env, MEMORY_DB: join(dir, 'memory.sqlite') }, encoding: 'utf8'
            });
            return JSON.parse(result.stdout);
        };
        assert.equal(run(`
            const p = new Ref();
            addMemoryComposition("", "Nom", p);
            addMemoryComposition(0, "Age", p);
            addMemoryComposition(false, "Actif", p);
        `, 'write').ok, true);
        const result = run(`print(query(select({nom:"string",age:"number",actif:"boolean"},
            exists({p:"Ref"},and(
                composition(variable("nom"),"Nom",variable("p")),
                composition(variable("age"),"Age",variable("p")),
                composition(variable("actif"),"Actif",variable("p"))
            ))
        )));`);
        assert.deepEqual(result, { ok: true, output: [[[{ nom: '', age: 0, actif: false }]]] });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
