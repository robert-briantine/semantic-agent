const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { get } = require('node:http');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { buildAgentPrompt } = require('../dist/agent-prompt');

async function server(t, publicUrl = '') {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-prompt-http-'));
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, HOST: '127.0.0.1', PORT: '0', MEMORY_DB: join(dir, 'memory.sqlite'), PUBLIC_URL: publicUrl },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill(); await exited;
        }
        rmSync(dir, { recursive: true, force: true });
    });
    return new Promise((resolve, reject) => {
        let output = '', errors = '';
        const timer = setTimeout(() => reject(Error('Démarrage trop long')), 10000);
        child.stderr.on('data', chunk => { errors += chunk; });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(Error(errors)); });
        child.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/Web app : (http:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
}

test('Prompt : les trois sources sont relues à chaque assemblage', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-prompt-sources-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'docs'));
    const instruction = join(dir, 'docs/agent-prompt.md');
    const library = join(dir, 'src/structure-langage-pour-ia.ts');
    const examples = join(dir, 'src/lg-exemple executable.ts');
    const url = 'https://memoire.example/api/agent/execute';
    writeFileSync(instruction, '# Instructions initiales\n{{EXECUTE_URL}}');
    writeFileSync(library, 'export const version = 1;');
    writeFileSync(examples, 'print("exemple initial");');
    const before = await buildAgentPrompt(dir, url);
    assert.ok(before.includes(url));
    assert.ok(before.includes('export const version = 1;'));
    assert.ok(before.includes('print("exemple initial");'));
    writeFileSync(instruction, '# Instructions actualisées\n{{EXECUTE_URL}}');
    writeFileSync(library, 'export const version = 2; // ```');
    writeFileSync(examples, 'print("exemple actualisé");');
    const after = await buildAgentPrompt(dir, url);
    assert.ok(after.includes('# Instructions actualisées'));
    assert.ok(after.includes('````typescript\nexport const version = 2; // ```\n````'));
    assert.ok(after.includes('print("exemple actualisé");'));
    assert.ok(!after.includes('exemple initial'));
    assert.ok(!after.includes('{{EXECUTE_URL}}'));
    assert.notEqual(before, after);
});

test('GET /api/prompt : texte complet, URL réelle et exemples JSON exécutables', async t => {
    const url = await server(t);
    const response = await fetch(new URL('api/prompt', url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain; charset=utf-8/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const prompt = await response.text();
    const executeUrl = new URL('api/agent/execute', url).href;
    assert.ok(prompt.startsWith(readFileSync('docs/agent-prompt.md', 'utf8').replaceAll('{{EXECUTE_URL}}', executeUrl).trimEnd()));
    for (const endpoint of ['library', 'examples']) {
        const source = await (await fetch(new URL('api/' + endpoint, url))).text();
        assert.ok(prompt.includes(source.trimEnd()), endpoint);
    }
    assert.ok(prompt.includes('URL d’exécution : ' + executeUrl));
    assert.ok(!prompt.includes('{{EXECUTE_URL}}'));
    const bodies = [...prompt.matchAll(/^```json\n(.*?)\n```/gms)].map(match => JSON.parse(match[1]));
    assert.equal(bodies.length, 3);
    const execute = async body => {
        const res = await fetch(executeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.ok, true);
        return data;
    };
    assert.deepEqual((await execute(bodies[0])).output, [[[]]]);
    assert.deepEqual((await execute(bodies[1])).output, [[[]]]);
    const created = (await execute(bodies[2])).output[0][0];
    assert.equal(typeof created.id, 'string');
    const found = (await execute(bodies[0])).output[0][0];
    assert.deepEqual(found, [{ p: created, nom: 'Alice' }]);
    assert.deepEqual((await execute(bodies[2])).output, [[[{ p: created }]]]);
    const custom = await new Promise((resolve, reject) => {
        get(new URL('api/prompt', url), { headers: { Host: 'memoire.example:8080' } }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve(body));
            res.on('error', reject);
        }).on('error', reject);
    });
    assert.ok(custom.includes('URL d’exécution : http://memoire.example:8080/api/agent/execute'));
});

test('GET /api/prompt : PUBLIC_URL conserve HTTPS et le préfixe public', async t => {
    for (const publicUrl of ['https://memoire.example/agent', 'https://memoire.example/agent/']) {
        const url = await server(t, publicUrl);
        const prompt = await (await fetch(new URL('api/prompt', url))).text();
        assert.ok(prompt.includes('URL d’exécution : https://memoire.example/agent/api/agent/execute'));
        assert.ok(!prompt.includes('{{EXECUTE_URL}}'));
    }
});
