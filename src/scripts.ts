import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { exampleScripts } from './example-scripts';

export type ScriptType = 'utilisateur' | 'exemple';
export type ScriptInput = { name: string; code: string; mode: 'read' | 'write' };
export type ScriptSummary = { id: string; name: string; mode: 'read' | 'write'; type: ScriptType; updatedAt: string };
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
                type TEXT NOT NULL DEFAULT 'utilisateur' CHECK(type IN ('utilisateur','exemple')),
                updated_at TEXT NOT NULL
            )`);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            if (!this.db.prepare("SELECT 1 FROM pragma_table_info('saved_scripts') WHERE name='type'").get()) {
                this.db.exec("ALTER TABLE saved_scripts ADD COLUMN type TEXT NOT NULL DEFAULT 'utilisateur' CHECK(type IN ('utilisateur','exemple'))");
            }
            const byId = this.db.prepare('SELECT name,type,code,mode FROM saved_scripts WHERE id=?');
            const byName = this.db.prepare('SELECT id FROM saved_scripts WHERE name=?');
            const insert = this.db.prepare("INSERT INTO saved_scripts(id,name,code,mode,type,updated_at) VALUES (?,?,?,?,'exemple',?)");
            const updateExample = this.db.prepare("UPDATE saved_scripts SET name=?,code=?,mode=?,updated_at=? WHERE id=? AND type='exemple'");
            for (const example of exampleScripts) {
                const existing = byId.get(example.id);
                let name: string = example.name, suffix = 2;
                while (true) {
                    const occupied = byName.get(name);
                    if (!occupied || occupied.id === example.id) break;
                    name = example.name + ' (' + suffix++ + ')';
                }
                if (existing) {
                    if (existing.type === 'exemple' && (existing.name !== name || existing.code !== example.code || existing.mode !== example.mode)) {
                        updateExample.run(name, example.code, example.mode, new Date().toISOString(), example.id);
                    }
                    continue;
                }
                insert.run(example.id, name, example.code, example.mode, new Date().toISOString());
            }
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    list(): ScriptSummary[] {
        return this.db.prepare('SELECT id,name,mode,type,updated_at AS updatedAt FROM saved_scripts ORDER BY name COLLATE NOCASE,name').all() as unknown as ScriptSummary[];
    }

    get(id: string): SavedScript | undefined {
        return this.db.prepare('SELECT id,name,code,mode,type,updated_at AS updatedAt FROM saved_scripts WHERE id=?').get(id) as unknown as SavedScript | undefined;
    }

    create(input: ScriptInput): SavedScript {
        const script: SavedScript = { ...input, type: 'utilisateur', id: randomUUID(), updatedAt: new Date().toISOString() };
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
        if (this.get(id)?.type === 'exemple') throw new Error('Clonez cet exemple pour le modifier.');
        const updatedAt = new Date().toISOString();
        const result = this.db.prepare('UPDATE saved_scripts SET name=?,code=?,mode=?,updated_at=? WHERE id=?')
            .run(input.name, input.code, input.mode, updatedAt, id);
        return result.changes ? { ...input, type: 'utilisateur', id, updatedAt } : undefined;
    }

    delete(id: string): boolean {
        if (this.get(id)?.type === 'exemple') throw new Error('Les exemples ne peuvent pas être supprimés.');
        return this.db.prepare("DELETE FROM saved_scripts WHERE id=? AND type='utilisateur'").run(id).changes !== 0;
    }

    close() { this.db.close(); }
}
