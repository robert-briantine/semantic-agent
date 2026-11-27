import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ScriptInput = { name: string; code: string; mode: 'read' | 'write' };
export type ScriptSummary = { id: string; name: string; mode: 'read' | 'write'; updatedAt: string };
export type SavedScript = ScriptSummary & { code: string };

export class ScriptStore {
    private db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS saved_scripts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                code TEXT NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('read','write')),
                updated_at TEXT NOT NULL
            )`);
    }

    list(): ScriptSummary[] {
        return this.db.prepare('SELECT id,name,mode,updated_at AS updatedAt FROM saved_scripts ORDER BY name COLLATE NOCASE,name').all() as unknown as ScriptSummary[];
    }

    get(id: string): SavedScript | undefined {
        return this.db.prepare('SELECT id,name,code,mode,updated_at AS updatedAt FROM saved_scripts WHERE id=?').get(id) as unknown as SavedScript | undefined;
    }

    create(input: ScriptInput): SavedScript {
        const script = { ...input, id: randomUUID(), updatedAt: new Date().toISOString() };
        this.db.prepare('INSERT INTO saved_scripts(id,name,code,mode,updated_at) VALUES (?,?,?,?,?)')
            .run(script.id, script.name, script.code, script.mode, script.updatedAt);
        return script;
    }

    clone(input: ScriptInput): SavedScript {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const base = input.name.replace(/ — copie(?: \d+)?$/, '') || input.name;
            const exists = this.db.prepare('SELECT 1 FROM saved_scripts WHERE name=?');
            let index = 1, name: string;
            do {
                const suffix = ' — copie' + (index === 1 ? '' : ' ' + index);
                name = base.slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/, '').trimEnd() + suffix;
                index++;
            } while (exists.get(name));
            const script = this.create({ ...input, name });
            this.db.exec('COMMIT');
            return script;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    update(id: string, input: ScriptInput): SavedScript | undefined {
        const updatedAt = new Date().toISOString();
        const result = this.db.prepare('UPDATE saved_scripts SET name=?,code=?,mode=?,updated_at=? WHERE id=?')
            .run(input.name, input.code, input.mode, updatedAt, id);
        return result.changes ? { ...input, id, updatedAt } : undefined;
    }

    close() { this.db.close(); }
}
