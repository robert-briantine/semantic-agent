import { DatabaseSync } from 'node:sqlite';
import { Ref, phrase, composition, Element, Complements, Query, QueryResult, Variables } from './structure-langage';
import type { Phrase, Composition } from './structure-langage';
import { collectPhrases, collectCompositions } from './phrase-storage';
import type { Expression, VariableTypes } from './structure-langage';
import { usedVariables } from './query-variables';
import { validateComplementUsage } from './validate-complements';
import { initializeVocabulary, validateVocabulary, bundledWordLookup } from './vocabulary';
import type { WordLookup } from './vocabulary';
export * from './structure-langage';

type Enc = null | boolean | number | string | Enc[] | { [key:string]: Enc };
function encode(x: unknown): Enc {
    if (x === undefined) return { $undefined: true };
    if (x instanceof Ref) return { $ref: x.id };
    if (Array.isArray(x)) return (x[0]==='composition'&&x.length===4&&x[3]===undefined?x.slice(0,3):x).map(encode);
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (typeof x === 'object' && x) return Object.fromEntries(Object.keys(x).sort().map(k => [k, encode((x as Record<string,unknown>)[k])]));
    throw new Error('Valeur non sérialisable');
}
const pack = (x:unknown) => JSON.stringify(encode(x));
function nameParts(name: string | [string, string]): [string, string | null] {
    return typeof name === 'string' ? [name, null] : name;
}
const nameIndexes = `
    CREATE INDEX IF NOT EXISTS comp_lookup ON compositions(name,ref,of_value,qualifier);
    CREATE INDEX IF NOT EXISTS comp_reverse ON compositions(name,of_value,ref,qualifier);
    CREATE INDEX IF NOT EXISTS phrase_lookup ON phrases(name,subject,complements,qualifier);
    CREATE INDEX IF NOT EXISTS phrase_reverse ON phrases(name,complements,subject,qualifier);`;
function decode(x:any):any {
    if (Array.isArray(x)) {
        const values = x.map(decode);
        if (values[0] === 'fait' && values.length >= 3) values[0] = 'phrase';
        if (values[0] === 'est' && values.length >= 3) values[0] = 'composition';
        if (values[0] === 'composition' && values.length===4 && values[3]===undefined) values.pop();
        return values;
    }
    if (x && typeof x === 'object') {
        if ('$undefined' in x) return undefined;
        if ('$ref' in x) return new Ref(x.$ref);
        if ('$phrase' in x) {
            // Ancienne représentation : conserver les identités et les contenus.
            const [subject,name,complements] = x.$phrase.map(decode);
            return ['phrase', subject, name, ...(complements ?? [])];
        }
        if ('$composition' in x) {
            const [ref,name,of]=x.$composition.map(decode);
            return of===undefined?['composition',ref,name]:['composition',ref,name,of];
        }
        return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,decode(v)]));
    }
    return x;
}
export function validateVariables(x:unknown, scope=new Set<string>()):void {
    if (Array.isArray(x)) {
        if (x[0]==='var' && x.length===2 && typeof x[1]==='string') { if (!scope.has(x[1])) throw new Error('Variable non déclarée : '+x[1]); }
        else if ((x[0]==='all'||x[0]==='exists') && x.length===3 && x[1] && typeof x[1]==='object' && !Array.isArray(x[1])) {
            validateVariables(x[2],new Set([...scope,...Object.keys(x[1])]));
        } else for (const e of x) validateVariables(e,scope);
    }
}
export function getRefs(x:unknown,set:Set<Ref>,visited=new WeakSet<object>()):void {
    if (x instanceof Ref) { set.add(x); return; }
    if (!x || typeof x!=='object' || visited.has(x)) return; visited.add(x);
    if (Array.isArray(x)) for (const e of x) getRefs(e,set,visited);
}
type Scope = Map<string,{value:string; type:keyof VariableTypes; phraseId?:string}>;
// Les tuples de deux éléments représentant une expression restent des éléments nus.
function isKeywordComplement(value:unknown):value is [string, unknown] {
    return Array.isArray(value) && value.length===2 && typeof value[0]==='string' && !['var','not','and','or'].includes(value[0]);
}
type Primitive = string | number | boolean;
function getPrimitives(x:unknown, values=new Set<Primitive>(), visited=new WeakSet<object>()):Set<Primitive> {
    if(typeof x==='string'||typeof x==='number'||typeof x==='boolean') {values.add(x);return values;}
    if(!x||typeof x!=='object'||visited.has(x))return values;
    visited.add(x);
    const visit=(value:unknown)=>getPrimitives(value,values,visited);
    if(Array.isArray(x)) {
        // Ignorer les noms de prédicats, rôles et variables : ce ne sont pas des valeurs.
        switch(x[0]) {
            case 'var':break;
            case 'switchCase':
                for(const branch of x[1] as unknown[])visit(branch);
                visit(x[2]);break;
            case 'all':case 'exists':
                if(x.length===3)visit(x[2]);else for(const value of x.slice(1))visit(value);
                break;
            case 'composition':visit(x[1]);visit(x[3]);break;
            case 'phrase':visit(x[1]);for(const complement of x.slice(3))visit(complement);break;
            case 'contient':
                if(!(Array.isArray(x[1])&&x[1][0]==='var'&&x[1].length===2))for(const complement of x[1] as unknown[])visit(complement);
                visit(x[2]);break;
            default:for(const value of x.slice(1))visit(value);
        }
    }
    return values;
}
class Compiler {
    params:Record<string,string|null> = {}; serial=0;
    rawParam(value:string|null):string {const key='p'+Object.keys(this.params).length; this.params[key]=value;return ':'+key;}
    param(x:unknown):string {return this.rawParam(pack(x));}
    predicate(alias:string,name:string|[string,string]):string {
        const [text,qualifier]=nameParts(name);
        return `${alias}.name=${this.rawParam(text)} AND ${alias}.qualifier IS ${this.rawParam(qualifier)}`;
    }
    domains(names:Variables,parent:Scope):{scope:Scope,from:string[]} {
        const scope=new Map(parent),from:string[]=[];
        for(const [name,type] of Object.entries(names)) {
            let domain:string;
            switch(type) {
                case 'Ref':domain='refs';break;
                case 'Phrase':domain='phrases';break;
                case 'Composition':domain='compositions';break;
                case 'complements':domain='(SELECT id AS idPhrase, complements AS value FROM phrases)';break;
                case 'string':case 'number':case 'boolean':
                    domain=`(SELECT value FROM primitive_values WHERE type='${type}')`;break;
                default:throw new Error('Type de variable invalide');
            }
            const a='d'+this.serial++; from.push(domain+' '+a);scope.set(name,{value:a+'.value',type,phraseId:type==='complements'?a+'.idPhrase':undefined});
        }
        return {scope,from};
    }
    term(x:any,s:Scope):string {
        if(Array.isArray(x)) {
            if(x[0]==='composition'&&x.length===4&&x[3]===undefined)x=x.slice(0,3);
            if(x[0]==='var'&&x.length===2&&s.has(x[1])) return s.get(x[1])!.value;
            if((x[0]==='all'||x[0]==='exists')&&x.length===3&&x[1]&&typeof x[1]==='object'&&!Array.isArray(x[1])) {
                const local=new Map(s);for(const k of Object.keys(x[1]))local.delete(k);
                return `json_array(json(${this.param(x[0])}),json(${this.param(x[1])}),json(${this.term(x[2],local)}))`;
            }
            return `json_array(${x.map((e:any)=>`json(${this.term(e,s)})`).join(',')})`;
        }
        return this.param(x);
    }
    expr(e:any,s:Scope):string {
        if(typeof e==='boolean')return e?'1':'0';
        switch(e[0]) {
            case 'not':return `(NOT ${this.expr(e[1],s)})`;
            case 'and':case 'or':return '('+(e.slice(1).map((x:any)=>this.expr(x,s)).join(e[0]==='and'?' AND ':' OR ')||(e[0]==='and'?'1':'0'))+')';
            case '=>':return `(NOT ${this.expr(e[1],s)} OR ${this.expr(e[2],s)})`;
            case 'switchCase':{
                if(!e[1].length)return this.expr(e[2],s);
                const cases=e[1].map((branch:any)=>`WHEN ${this.expr(branch[1],s)} THEN ${this.expr(branch[2],s)}`).join(' ');
                return `(CASE ${cases} ELSE ${this.expr(e[2],s)} END)`;
            }
            case '=':return `(${this.term(e[1],s)} = ${this.term(e[2],s)})`;
            case 'composition':return `EXISTS (SELECT 1 FROM compositions c WHERE c.owner_type IS NULL AND ${this.predicate('c',e[2])} AND c.ref=${this.term(e[1],s)} AND c.of_value=${this.term(e[3],s)})`;
            case 'phrase':{
                const binding=e.length===4 && Array.isArray(e[3]) && e[3][0]==='var' && e[3].length===2 ? s.get(e[3][1]) : undefined;
                return `EXISTS (SELECT 1 FROM phrases f WHERE f.owner_type IS NULL AND ${this.predicate('f',e[2])} AND f.subject=${this.term(e[1],s)} AND f.complements=${this.term(binding?.type==='complements'?e[3]:e.slice(3),s)})`;
            }
            case 'contient':{
                const binding=Array.isArray(e[1]) && e[1][0]==='var' && e[1].length===2 ? s.get(e[1][1]) : undefined;
                if(binding?.type==='complements') {
                    const a='c'+this.serial++;
                    const [keyword,element]=isKeywordComplement(e[2])?e[2]:[null,e[2]];
                    return `EXISTS (SELECT 1 FROM Complement ${a} WHERE ${a}.idPhrase=${binding.phraseId} AND ${a}.motClef IS ${this.rawParam(keyword)} AND ${a}.Element=${this.term(element,s)})`;
                }
                const a='j'+this.serial++;
                const list=this.term(e[1],s);
                return `EXISTS (SELECT 1 FROM json_each(${list}) ${a} WHERE (${list} -> ('$[' || ${a}.key || ']'))=${this.term(e[2],s)})`;
            }
            case 'all':case 'exists':{const d=this.domains(e[1],s);const from=d.from.length?' FROM '+d.from.join(', '):'';return `${e[0]==='all'?'NOT ':''}EXISTS (SELECT 1${from} WHERE ${e[0]==='all'?'NOT ':''}${this.expr(e[2],d.scope)})`;}
            default:throw new Error('Opérateur inconnu');
        }
    }
    compile(q:Query<any>) {
        const [,names,e]=q;
        for(const type of Object.values(names)) if(!['Ref','Phrase','Composition','string','number','boolean','complements'].includes(type as string)) throw new Error('Type de variable invalide');
        const used=usedVariables(e);
        const active=Object.fromEntries(Object.entries(names).filter(([name])=>used.has(name))) as Variables;
        const d=this.domains(active,new Map());
        const columns=Object.keys(names).map((name,i)=>`${d.scope.get(name)?.value??this.param(undefined)} AS c${i}`).join(',')||'1 AS dummy';
        const sql=`SELECT DISTINCT ${columns}${d.from.length?' FROM '+d.from.join(', '):''} WHERE ${this.expr(e,d.scope)}`;
        return {sql,params:this.params};
    }
}
export function compileQuery<T extends Variables>(q:Query<T>,known:WordLookup=bundledWordLookup){validateVariables(q[2],new Set(Object.keys(q[1])));validateComplementUsage(q[2],q[1]);validateVocabulary(q[2],known);return new Compiler().compile(q);}
export class Runtime {
    private db:DatabaseSync;
    private writing=false;
    private wordKnown:WordLookup;
    constructor(path:string) {
        this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA recursive_triggers=ON;
        CREATE TABLE IF NOT EXISTS refs(value TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS compositions(id INTEGER PRIMARY KEY, ref TEXT NOT NULL,name TEXT NOT NULL,of_value TEXT NOT NULL, value TEXT NOT NULL,qualifier TEXT,
            owner_type TEXT CHECK(owner_type IN ('composition','phrase')),owner_id INTEGER,
            CHECK((owner_type IS NULL) = (owner_id IS NULL)));
        CREATE TABLE IF NOT EXISTS phrases(id INTEGER PRIMARY KEY, subject TEXT NOT NULL,name TEXT NOT NULL,complements TEXT NOT NULL,value TEXT NOT NULL,qualifier TEXT,
            owner_type TEXT CHECK(owner_type IN ('composition','phrase')),owner_id INTEGER,
            CHECK((owner_type IS NULL) = (owner_id IS NULL)));`);
        this.wordKnown=initializeVocabulary(this.db);
        const legacyTables = ['compositions','phrases'].filter(table => !this.db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table,'qualifier'));
        if(legacyTables.length) this.transaction(()=>{
            for(const table of legacyTables) {
                if(this.db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table,'qualifier')) continue;
                const path = table==='compositions' ? '$."$composition"[1]' : '$."$phrase"[1]';
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN qualifier TEXT`);
                // Le JSON complet est la source du nom original, même s'il contient des guillemets.
                this.db.prepare(`UPDATE ${table} SET
                    name=CASE json_type(value,?) WHEN 'array' THEN json_extract(value,?) ELSE json_extract(value,?) END,
                    qualifier=CASE json_type(value,?) WHEN 'array' THEN json_extract(value,?) ELSE NULL END`)
                    .run(path,path+'[0]',path,path,path+'[1]');
            }
            this.db.exec('DROP INDEX IF EXISTS comp_lookup; DROP INDEX IF EXISTS comp_reverse; DROP INDEX IF EXISTS phrase_lookup; DROP INDEX IF EXISTS phrase_reverse;');
            this.db.exec(nameIndexes);
        });
        this.db.exec(nameIndexes);
        if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Complement'").get()) this.transaction(()=>{
            if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Complement'").get()) return;
            this.db.exec(`CREATE TABLE Complement(
                idPhrase INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
                ordre INTEGER NOT NULL,
                motClef TEXT,
                Element TEXT NOT NULL,
                PRIMARY KEY(idPhrase,ordre)
            ) WITHOUT ROWID;
            CREATE INDEX complement_lookup ON Complement(idPhrase,motClef,Element);`);
            for(const row of this.db.prepare('SELECT id,complements FROM phrases').iterate()) {
                this.storeComplements(Number(row.id),decode(JSON.parse(String(row.complements))));
            }
        });
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS phrases_delete_complements AFTER DELETE ON phrases BEGIN
            DELETE FROM Complement WHERE idPhrase=OLD.id;
        END;`);
        // Migration des mémoires existantes ; les valeurs et leur index sont atomiques.
        if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='primitive_values'").get()) {
            this.transaction(()=>{
                this.db.exec('CREATE TABLE IF NOT EXISTS primitive_values(type TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(type,value))');
                for(const table of ['compositions','phrases']) {
                    for(const row of this.db.prepare(`SELECT value FROM ${table}`).iterate()) {
                        this.storePrimitives(decode(JSON.parse(String(row.value))));
                    }
                }
            });
        }
        if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fact_arguments'").get()) this.transaction(()=>{
            if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fact_arguments'").get()) return;
            this.db.exec(`CREATE TABLE fact_arguments(
                type TEXT NOT NULL CHECK(type IN ('Ref','string','number','boolean')),
                value TEXT NOT NULL,
                fact_type TEXT NOT NULL CHECK(fact_type IN ('composition','phrase')),
                fact_id INTEGER NOT NULL,
                PRIMARY KEY(type,value,fact_type,fact_id)
            ) WITHOUT ROWID;
            CREATE INDEX fact_arguments_by_fact ON fact_arguments(fact_type,fact_id,type,value);`);
            for(const [table,type] of [['compositions','composition'],['phrases','phrase']] as const) {
                for(const row of this.db.prepare(`SELECT id,value FROM ${table}`).iterate()) {
                    this.storeArguments(type,Number(row.id),decode(JSON.parse(String(row.value))));
                }
            }
        });
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS compositions_delete_arguments AFTER DELETE ON compositions BEGIN
            DELETE FROM fact_arguments WHERE fact_type='composition' AND fact_id=OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS phrases_delete_arguments AFTER DELETE ON phrases BEGIN
            DELETE FROM fact_arguments WHERE fact_type='phrase' AND fact_id=OLD.id;
        END;`);
        // Migrer les anciennes représentations dans une seule transaction, sans
        // purger les faits ni leurs index. Les identifiants existants sont conservés.
        try {
            const legacyOwners=['compositions','phrases'].filter(table=>!this.db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table,'owner_type'));
            if (legacyOwners.length) this.transaction(()=>{
                for(const table of legacyOwners)this.db.exec(`ALTER TABLE ${table} ADD COLUMN owner_type TEXT; ALTER TABLE ${table} ADD COLUMN owner_id INTEGER;`);
                this.createFactOwnership();
                this.migrateFacts();
            });
            else this.createFactOwnership();
        } catch (error) {this.db.close();throw error;}
    }
    transaction<T>(f:()=>T):T {this.db.exec('BEGIN IMMEDIATE');this.writing=true;try{const r=f();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.writing=false;}}
    private atomic<T>(f:()=>T):T {return this.writing?f():this.transaction(f);}
    private storeRefs(x:unknown){const refs=new Set<Ref>();getRefs(x,refs);const stmt=this.db.prepare('INSERT OR IGNORE INTO refs VALUES (?)');for(const r of refs)stmt.run(pack(r));}
    private storePrimitives(x:unknown){const stmt=this.db.prepare('INSERT OR IGNORE INTO primitive_values(type,value) VALUES (?,?)');for(const value of getPrimitives(x))stmt.run(typeof value,pack(value));}
    private storeComplements(id:number,complements:Complements):void {
        const insert=this.db.prepare(`INSERT INTO Complement(idPhrase,ordre,motClef,Element) VALUES (?,?,?,?)
            ON CONFLICT(idPhrase,ordre) DO UPDATE SET motClef=excluded.motClef,Element=excluded.Element`);
        complements.forEach((complement,ordre)=>{
            const [keyword,element]=isKeywordComplement(complement)?complement:[null,complement];
            insert.run(id,ordre,keyword,pack(element));
        });
    }
    private storeArguments(type:'composition'|'phrase',id:number,fact:unknown):void {
        const insert=this.db.prepare('INSERT OR IGNORE INTO fact_arguments(type,value,fact_type,fact_id) VALUES (?,?,?,?)');
        const refs=new Set<Ref>();getRefs(fact,refs);
        for(const ref of refs) insert.run('Ref',pack(ref),type,id);
        for(const value of getPrimitives(fact)) insert.run(typeof value,pack(value),type,id);
    }
    private createFactOwnership():void {
        this.db.exec(`CREATE INDEX IF NOT EXISTS phrase_owner ON phrases(owner_type,owner_id);
        CREATE INDEX IF NOT EXISTS composition_owner ON compositions(owner_type,owner_id);
        CREATE TRIGGER IF NOT EXISTS compositions_delete_compositions AFTER DELETE ON compositions BEGIN
            DELETE FROM compositions WHERE owner_type='composition' AND owner_id=OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS phrases_delete_compositions AFTER DELETE ON phrases BEGIN
            DELETE FROM compositions WHERE owner_type='phrase' AND owner_id=OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS compositions_delete_phrases AFTER DELETE ON compositions BEGIN
            DELETE FROM phrases WHERE owner_type='composition' AND owner_id=OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS phrases_delete_phrases AFTER DELETE ON phrases BEGIN
            DELETE FROM phrases WHERE owner_type='phrase' AND owner_id=OLD.id;
        END;`);
    }
    private insertComposition(value:Composition,ownerType:'composition'|'phrase'|null=null,ownerId:number|null=null):number {
        const [text,qualifier]=nameParts(value[2]);
        const row=this.db.prepare('INSERT INTO compositions(ref,name,of_value,value,qualifier,owner_type,owner_id) VALUES (?,?,?,?,?,?,?)')
            .run(pack(value[1]),text,pack(value[3]),pack(value),qualifier,ownerType,ownerId);
        const id=Number(row.lastInsertRowid);
        this.storeRefs(value);this.storePrimitives(value);this.storeArguments('composition',id,value);
        return id;
    }
    private insertPhrase(value:Phrase,ownerType:'composition'|'phrase'|null=null,ownerId:number|null=null):number {
        const [text,qualifier]=nameParts(value[2]), complements=value.slice(3) as Complements;
        const row=this.db.prepare('INSERT INTO phrases(subject,name,complements,value,qualifier,owner_type,owner_id) VALUES (?,?,?,?,?,?,?)')
            .run(pack(value[1]),text,pack(complements),pack(value),qualifier,ownerType,ownerId);
        const id=Number(row.lastInsertRowid);
        this.storeRefs(value);this.storePrimitives(value);this.storeComplements(id,complements);this.storeArguments('phrase',id,value);
        return id;
    }
    private storeNestedFacts(value:unknown,ownerType:'composition'|'phrase',ownerId:number):void {
        const phrases=new Set(this.db.prepare('SELECT value FROM phrases WHERE owner_type=? AND owner_id=?').all(ownerType,ownerId).map(row=>String(row.value)));
        const compositions=new Set(this.db.prepare('SELECT value FROM compositions WHERE owner_type=? AND owner_id=?').all(ownerType,ownerId).map(row=>String(row.value)));
        for(const nested of collectPhrases<Phrase>(value)) {
            if(nested===value&&ownerType==='phrase')continue;
            const key=pack(nested);
            if(!phrases.has(key)){this.insertPhrase(nested,ownerType,ownerId);phrases.add(key);}
        }
        for(const nested of collectCompositions<Composition>(value)) {
            if(nested===value&&ownerType==='composition')continue;
            const key=pack(nested);
            if(!compositions.has(key)){this.insertComposition(nested,ownerType,ownerId);compositions.add(key);}
        }
    }
    private migrateFacts():void {
        const compositions=this.db.prepare('SELECT id,value,owner_type FROM compositions').all();
        const phrases=this.db.prepare('SELECT id,value,owner_type FROM phrases').all();
        for (const row of compositions) {
            const value=decode(JSON.parse(String(row.value))) as Composition;
            this.db.prepare('UPDATE compositions SET ref=?,of_value=?,value=? WHERE id=?').run(pack(value[1]),pack(value[3]),pack(value),row.id);
            this.storeArguments('composition',Number(row.id),value);this.storePrimitives(value);this.storeRefs(value);
        }
        for (const row of phrases) {
            const value=decode(JSON.parse(String(row.value))) as Phrase;
            this.db.prepare('UPDATE phrases SET subject=?,complements=?,value=? WHERE id=?').run(pack(value[1]),pack(value.slice(3)),pack(value),row.id);
            this.storeComplements(Number(row.id),value.slice(3) as Complements);
            this.storeArguments('phrase',Number(row.id),value);this.storePrimitives(value);this.storeRefs(value);
        }
        for(const row of compositions)if(row.owner_type===null)this.storeNestedFacts(decode(JSON.parse(String(row.value))),'composition',Number(row.id));
        for(const row of phrases)if(row.owner_type===null)this.storeNestedFacts(decode(JSON.parse(String(row.value))),'phrase',Number(row.id));
    }
    addMemoryComposition(ref:Element|string|number,name:Composition[2],of?:Element):Composition {return this.atomic(()=>{const c=composition(ref,name,of);validateVariables(c);validateComplementUsage(c);validateVocabulary(c,this.wordKnown);const id=this.insertComposition(c);this.storeNestedFacts(c,'composition',id);return c;});}
    addMemoryPhrase(subject:Element|undefined,name:Phrase[2],...complements:Complements):Phrase {return this.atomic(()=>{const p=phrase(subject,name,...complements);validateVariables(p);validateComplementUsage(p);validateVocabulary(p,this.wordKnown);const id=this.insertPhrase(p);this.storeNestedFacts(p,'phrase',id);return p;});}
    deleteReference(id:string) {
        return this.atomic(()=>{
            const value=pack(new Ref(id));
            this.db.exec(`CREATE TEMP TABLE IF NOT EXISTS deletion_candidates(type TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(type,value)) WITHOUT ROWID;
                DELETE FROM deletion_candidates;`);
            this.db.prepare(`INSERT OR IGNORE INTO deletion_candidates
                SELECT a.type,a.value FROM fact_arguments target JOIN fact_arguments a ON a.fact_type=target.fact_type AND a.fact_id=target.fact_id
                WHERE target.type='Ref' AND target.value=?`).run(value);
            this.db.prepare("INSERT OR IGNORE INTO deletion_candidates VALUES ('Ref',?)").run(value);
            const before=Number(this.db.prepare('SELECT count(*) AS n FROM phrases').get()!.n);
            const beforeCompositions=Number(this.db.prepare('SELECT count(*) AS n FROM compositions').get()!.n);
            this.db.prepare("DELETE FROM compositions WHERE id IN (SELECT fact_id FROM fact_arguments WHERE type='Ref' AND value=? AND fact_type='composition')").run(value);
            this.db.prepare("DELETE FROM phrases WHERE id IN (SELECT fact_id FROM fact_arguments WHERE type='Ref' AND value=? AND fact_type='phrase')").run(value);
            const phrases=before-Number(this.db.prepare('SELECT count(*) AS n FROM phrases').get()!.n);
            const compositions=beforeCompositions-Number(this.db.prepare('SELECT count(*) AS n FROM compositions').get()!.n);
            const refs=Number(this.db.prepare(`DELETE FROM refs WHERE value IN (SELECT value FROM deletion_candidates WHERE type='Ref')
                AND NOT EXISTS (SELECT 1 FROM fact_arguments a WHERE a.type='Ref' AND a.value=refs.value)`).run().changes);
            const primitiveValues=Number(this.db.prepare(`DELETE FROM primitive_values WHERE (type,value) IN (SELECT type,value FROM deletion_candidates WHERE type<>'Ref')
                AND NOT EXISTS (SELECT 1 FROM fact_arguments a WHERE a.type=primitive_values.type AND a.value=primitive_values.value)`).run().changes);
            this.db.exec('DELETE FROM deletion_candidates');
            return {refId:id,deleted:{compositions,phrases,refs,primitiveValues}};
        });
    }
    deleteReferences(ids:string[]) {
        const refIds=[...new Set(ids)];
        return this.atomic(()=>{
            const deleted={compositions:0,phrases:0,refs:0,primitiveValues:0};
            for(const id of refIds) {
                const result=this.deleteReference(id).deleted;
                for(const key of ['compositions','phrases','refs','primitiveValues'] as const) deleted[key]+=result[key];
            }
            return {refIds,deleted};
        });
    }
    query<const T extends Variables,const E extends Expression<NoInfer<T>>>(q:Query<T,E>):QueryResult<T,E>[] {const {sql,params}=compileQuery(q,this.wordKnown);const rows=this.db.prepare(sql).all(params);return rows.map(row=>Object.fromEntries(Object.keys(q[1]).map((k,i)=>[k,decode(JSON.parse(String(row['c'+i])))])) as QueryResult<T,E>);}
    memoryRef():Set<Ref>{return new Set(this.db.prepare('SELECT value FROM refs').all().map(r=>decode(JSON.parse(String(r.value)))));}
    get memoryRelation():Phrase[]{return this.db.prepare('SELECT value FROM phrases WHERE owner_type IS NULL ORDER BY id').all().map(r=>decode(JSON.parse(String(r.value))));}
    get memoryComposition():Composition[]{return this.db.prepare('SELECT value FROM compositions WHERE owner_type IS NULL ORDER BY id').all().map(r=>decode(JSON.parse(String(r.value))));}
    close(){this.db.close();}
}
export function print(...values:unknown[]){console.log(...values);}
