import type { DatabaseSync } from 'node:sqlite';
import french from './lexicon/french.json';
import links from './lexicon/prepositions.json';

export const vocabularyTables = ['lexique_verbes', 'lexique_noms_communs', 'lexique_prepositions'] as const;
export type WordKind = 'verbe' | 'nom' | 'preposition';
export type WordLookup = (kind: WordKind, word: string) => boolean;
export const normalizeWord = (word: string) => word.normalize('NFC').trim().toLocaleLowerCase('fr').replaceAll('’', "'");
const lists = {
    verbe: new Set(french.verbes.map(normalizeWord)),
    nom: new Set(french.nomsCommuns.map(normalizeWord)),
    preposition: new Set([...links.prepositions, ...links.conjonctions].map(normalizeWord))
};
export const bundledWordLookup: WordLookup = (kind, word) => lists[kind].has(normalizeWord(word));

// Chargement local, transactionnel et versionné ; les dictionnaires survivent à la RAZ.
export function initializeVocabulary(db: DatabaseSync): WordLookup {
    const groups = [
        { table: vocabularyTables[0], source: french.version, words: french.verbes, nature: 'verbe' },
        { table: vocabularyTables[1], source: french.version, words: french.nomsCommuns, nature: 'nom' },
        { table: vocabularyTables[2], source: links.version, words: links.prepositions, nature: 'préposition' },
        { table: vocabularyTables[2], source: links.version, words: links.conjonctions, nature: 'conjonction' }
    ];
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const group of groups) {
            db.exec(`CREATE TABLE IF NOT EXISTS ${group.table} (
                mot TEXT PRIMARY KEY, source TEXT NOT NULL, nature TEXT NOT NULL
            ) WITHOUT ROWID`);
            if (db.prepare(`SELECT 1 FROM ${group.table} WHERE source=? AND nature=? LIMIT 1`).get(group.source, group.nature)) continue;
            const insert = db.prepare(`INSERT INTO ${group.table}(mot,source,nature) VALUES (?,?,?)
                ON CONFLICT(mot) DO UPDATE SET source=excluded.source,nature=excluded.nature`);
            for (const word of group.words) insert.run(normalizeWord(word), group.source, group.nature);
        }
        db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const statements = {
        verbe: db.prepare('SELECT 1 FROM lexique_verbes WHERE mot=?'),
        nom: db.prepare('SELECT 1 FROM lexique_noms_communs WHERE mot=?'),
        preposition: db.prepare('SELECT 1 FROM lexique_prepositions WHERE mot=?')
    };
    return (kind, word) => !!statements[kind].get(normalizeWord(word));
}

function checkWord(kind: WordKind, word: unknown, known: WordLookup): void {
    const valid = typeof word === 'string' && word.length > 0 && known(kind, word);
    if (valid) return;
    const message = kind === 'verbe' ? 'Verbe ou forme conjuguée inconnue' :
        kind === 'nom' ? 'Nom commun inconnu ou non singulier' : 'Préposition ou locution inconnue';
    const table = vocabularyTables[kind === 'verbe' ? 0 : kind === 'nom' ? 1 : 2];
    throw new Error(`${message} : « ${String(word)} ». Consultez ${table}.`);
}

function checkName(kind: 'verbe' | 'nom', value: unknown, known: WordLookup): void {
    if (Array.isArray(value)) {
        if (value.length !== 2 || typeof value[1] !== 'string') throw new Error('Nom qualifié invalide');
        checkWord(kind, value[0], known);
    } else checkWord(kind, value, known);
}

function complement(value: unknown, known: WordLookup): void {
    if (Array.isArray(value) && value.length === 2 && value[0] === 'var' && typeof value[1] === 'string') return;
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' &&
        !['not', 'and', 'or'].includes(value[0])) {
        checkWord('preposition', value[0], known);
        validateVocabulary(value[1], known);
    } else validateVocabulary(value, known);
}

// Ne contrôler que les mots grammaticaux, jamais les noms propres, textes et valeurs des faits.
export function validateVocabulary(value: unknown, known: WordLookup = bundledWordLookup): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        if (value[0] === 'var' && value.length === 2) return;
        if (value[0] === 'phrase' && value.length >= 3) {
            checkName('verbe', value[2], known);
            validateVocabulary(value[1], known);
            for (const child of value.slice(3)) complement(child, known);
        } else if (value[0] === 'composition' && value.length >= 3) {
            checkName('nom', value[2], known);
            validateVocabulary(value[1], known); validateVocabulary(value[3], known);
        } else if (value[0] === 'contient' && value.length === 3) {
            if (Array.isArray(value[1]) && value[1][0] !== 'var') {
                for (const child of value[1]) complement(child, known);
            }
            complement(value[2], known);
        } else if ((value[0] === 'all' || value[0] === 'exists') && value.length === 3 &&
            value[1] && typeof value[1] === 'object' && !Array.isArray(value[1])) {
            validateVocabulary(value[2], known);
        } else for (const child of value) validateVocabulary(child, known);
    } else if ('subject' in value && 'name' in value) {
        checkName('verbe', value.name, known);
        validateVocabulary(value.subject, known);
        if ('complements' in value && Array.isArray(value.complements)) {
            for (const child of value.complements) complement(child, known);
        }
    } else if ('ref' in value && 'name' in value) {
        checkName('nom', value.name, known);
        validateVocabulary(value.ref, known);
        if ('of' in value) validateVocabulary(value.of, known);
    }
}
