import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class AgentCallStore {
    private db:DatabaseSync;

    constructor(path:string) {
        this.db=new DatabaseSync(path);
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS agent_calls(
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                source TEXT NOT NULL,
                code TEXT NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('read','write')),
                status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
                http_status INTEGER,
                duration_ms INTEGER,
                response TEXT
            );
            CREATE INDEX IF NOT EXISTS agent_calls_created ON agent_calls(created_at DESC,id DESC);`);
    }

    start(source:string,code:string,mode:'read'|'write'):string {
        const id=randomUUID();
        this.db.prepare("INSERT INTO agent_calls(id,created_at,source,code,mode,status) VALUES (?,?,?,?,?,'running')")
            .run(id,new Date().toISOString(),source,code,mode);
        return id;
    }

    finish(id:string,httpStatus:number,response:Record<string,unknown>,durationMs:number):void {
        this.db.prepare('UPDATE agent_calls SET completed_at=?,status=?,http_status=?,duration_ms=?,response=? WHERE id=?')
            .run(new Date().toISOString(),httpStatus===200&&response.ok===true?'succeeded':'failed',httpStatus,durationMs,JSON.stringify(response),id);
    }

    close(){this.db.close();}
}
