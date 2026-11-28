import { DatabaseSync } from 'node:sqlite';
import { Runtime } from './runtime';
import { readFileSync } from 'node:fs';

function identifier(name: string): string { return '"' + name.replace(/"/g, '""') + '"'; }
function jsonValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER ? Number(value) : value.toString();
    if (value instanceof Uint8Array) return '0x' + Buffer.from(value).toString('hex');
    return value;
}

export function inspectDatabase(path: string, request: { action: 'tables' } | { action: 'agent-calls'; limit:number; offset:number } | { action:'agent-call'; id:string } | { action: 'reference'; refId: string } | { action: 'references'; refIds: string[] } | { action: 'query'; sql: string; limit: number; offset: number }) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        db.exec('PRAGMA busy_timeout=1000');
        if(request.action==='agent-calls') {
            const calls=db.prepare(`SELECT id,created_at AS createdAt,completed_at AS completedAt,
                substr(source,1,240) AS sourcePreview,mode,status,http_status AS httpStatus,duration_ms AS durationMs
                FROM agent_calls ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(request.limit+1,request.offset);
            return {calls:calls.slice(0,request.limit),limit:request.limit,offset:request.offset,hasMore:calls.length>request.limit};
        }
        if(request.action==='agent-call') {
            const call=db.prepare(`SELECT id,created_at AS createdAt,completed_at AS completedAt,source,code,mode,status,
                http_status AS httpStatus,duration_ms AS durationMs,response FROM agent_calls WHERE id=?`).get(request.id);
            return {call:call?{...call,response:call.response===null?null:JSON.parse(String(call.response))}:null};
        }
        if (request.action === 'references' || request.action === 'reference') {
            const refIds=[...new Set(request.action === 'references' ? request.refIds : [request.refId])];
            const values=JSON.stringify(refIds.map(id=>JSON.stringify({$ref:id})));
            const counts=db.prepare(`WITH matched AS (
                SELECT DISTINCT a.fact_type,a.fact_id FROM json_each(?) selected
                JOIN fact_arguments a ON a.type='Ref' AND a.value=selected.value
            ), affected AS (
                SELECT fact_type,fact_id FROM matched
                UNION SELECT 'phrase',p.id FROM phrases p JOIN matched m ON p.owner_type=m.fact_type AND p.owner_id=m.fact_id
            ) SELECT fact_type,count(*) AS n FROM affected GROUP BY fact_type`).all(values);
            const existingRefs=Number(db.prepare('SELECT count(*) AS n FROM refs WHERE value IN (SELECT value FROM json_each(?))').get(values)!.n);
            const totals={compositions:Number(counts.find(row=>row.fact_type==='composition')?.n??0),phrases:Number(counts.find(row=>row.fact_type==='phrase')?.n??0)};
            return request.action === 'references' ? {refIds,existingRefs,...totals} : {refId:request.refId,exists:existingRefs>0,...totals};
        }
        if (request.action === 'tables') {
            const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
            return { tables: tables.map(table => ({
                name: String(table.name), sql: table.sql,
                columns: db.prepare('SELECT name,type,"notnull" AS "notNull",pk FROM pragma_table_info(?) ORDER BY cid').all(String(table.name)),
                rowCount: db.prepare('SELECT count(*) AS count FROM ' + identifier(String(table.name))).get()!.count
            })) };
        }
        // La sous-requête accepte SELECT et WITH, et garde la pagination hors du SQL saisi.
        const sql = request.sql.trim().replace(/;\s*$/, '');
        const statement = db.prepare(`SELECT * FROM (\n${sql}\n) LIMIT ? OFFSET ?`);
        statement.setReadBigInts(true);
        const values = statement.all(request.limit + 1, request.offset);
        // columns() est disponible à partir de Node 22.16 ; garder la compatibilité 22.13.
        let columns: string[];
        if (typeof statement.columns === 'function') columns = statement.columns().map(column => column.name);
        else {
            // Une vue temporaire fournit aussi les colonnes d'un résultat vide sur Node 22.13.
            db.prepare(`CREATE TEMP VIEW __query_columns AS SELECT * FROM (\n${sql}\n)`).run();
            columns = db.prepare("SELECT name FROM pragma_table_info('__query_columns') ORDER BY cid").all().map(column => String(column.name));
        }
        return {
            columns,
            rows: values.slice(0, request.limit).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)]))),
            limit: request.limit, offset: request.offset, hasMore: values.length > request.limit
        };
    } finally { db.close(); }
}

export function resetDatabase(path:string) {
    const db=new DatabaseSync(path);
    try {
        db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
        try {
            // La RAZ concerne la mémoire et l’historique ; conserver scripts et dictionnaires.
            const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('saved_scripts','lexique_verbes','lexique_noms_communs','lexique_prepositions') ORDER BY name").all();
            // Compter avant les DELETE : les déclencheurs peuvent aussi supprimer des lignes.
            const deleted=Object.fromEntries(tables.map(row=>[String(row.name),Number(db.prepare('SELECT count(*) AS n FROM '+identifier(String(row.name))).get()!.n)]));
            for(const row of tables) db.exec('DELETE FROM '+identifier(String(row.name)));
            db.exec('COMMIT');
            return {deleted};
        } catch(error) {db.exec('ROLLBACK');throw error;}
    } finally {db.close();}
}

if (require.main === module) {
    try {
        const request = JSON.parse(process.argv[2] ? Buffer.from(process.argv[2], 'base64').toString('utf8') : readFileSync(0,'utf8'));
        let result;
        if(request.action==='reset') result=resetDatabase(process.env.MEMORY_DB!);
        else if(request.action==='delete-reference'||request.action==='delete-references') {
            const runtime=new Runtime(process.env.MEMORY_DB!);
            try {result=request.action==='delete-reference'?runtime.deleteReference(request.refId):runtime.deleteReferences(request.refIds);} finally {runtime.close();}
        } else result=inspectDatabase(process.env.MEMORY_DB!, request);
        process.stdout.write(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
    }
}
