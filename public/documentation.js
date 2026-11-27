import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/markdown/register';

self.MonacoEnvironment = { getWorker: () => new Worker('/assets/editor.worker.js', { type: 'module' }) };
const $ = id => document.getElementById(id);
const documents = {
    library: { title: 'Librairie pour l’agent', endpoint: '/api/library', filename: 'structure-langage-pour-ia.ts', language: 'typescript',
        description: 'Source TypeScript de la librairie fournie à l’agent.' },
    prompt: { title: 'Prompt complet de l’agent', endpoint: '/api/prompt', filename: 'agent-prompt.md', language: 'markdown',
        description: 'Texte assemblé à chaque requête : instructions, URL d’exécution, librairie et exemples actuels. Copiez ou téléchargez ce document pour configurer l’agent.' },
    examples: { title: 'Exemples', endpoint: '/api/examples', filename: 'lg-exemple executable.ts', language: 'typescript',
        description: 'Exemples TypeScript d’insertion et de recherche, tels qu’ils sont fournis aux clients de l’API.' }
};
const tabs = [...document.querySelectorAll('[data-document]')];
const editor = monaco.editor.create($('documentEditor'), {
    model: null, theme: 'vs-dark', readOnly: true, domReadOnly: true,
    automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
    fontSize: 14, lineHeight: 22, padding: { top: 14 }, fixedOverflowWidgets: true,
    ariaLabel: 'Document retourné par l’API en lecture seule'
});
let active = 'library', model = null, content = null, controller = null, revision = 0;

function resourceFromHash() {
    const name = location.hash.slice(1);
    return Object.hasOwn(documents, name) ? name : 'library';
}
function clearContent() {
    content = null;
    $('copy').disabled = true;
    $('download').disabled = true;
    $('documentEditor').hidden = true;
    editor.setModel(null);
    model?.dispose();
    model = null;
}
function message(text, error = false) {
    $('documentMessage').textContent = text;
    $('documentMessage').hidden = false;
    $('documentMessage').classList.toggle('error', error);
    $('documentMessage').setAttribute('role', error ? 'alert' : 'status');
}
async function loadDocument(name) {
    active = name;
    controller?.abort();
    controller = new AbortController();
    const request = ++revision;
    const resource = documents[name];
    clearContent();
    tabs.forEach(tab => {
        const selected = tab.dataset.document === name;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    $('documentPanel').setAttribute('aria-labelledby', name + 'Tab');
    $('documentPanel').setAttribute('aria-busy', 'true');
    $('documentTitle').textContent = resource.title;
    $('documentDescription').textContent = resource.description;
    $('documentEndpoint').textContent = resource.endpoint;
    $('documentMeta').textContent = 'Le contenu est chargé directement depuis l’API.';
    $('status').textContent = 'Chargement…';
    document.title = resource.title + ' — Documentation API — Semantic Agent';
    message('Chargement du document…');
    try {
        const response = await fetch(resource.endpoint, {
            signal: controller.signal, cache: 'no-store'
        });
        if (request !== revision) return;
        if (!response.ok) throw Error('Impossible de charger le document (HTTP ' + response.status + ').');
        const text = await response.text();
        if (request !== revision) return;
        content = text;
        model = monaco.editor.createModel(text, resource.language, monaco.Uri.parse('inmemory:///documentation/' + resource.filename));
        editor.setModel(model);
        editor.updateOptions({ wordWrap: name === 'prompt' ? 'on' : 'off', lineNumbers: name === 'prompt' ? 'off' : 'on',
            ariaLabel: resource.title + ' — document de l’API en lecture seule' });
        $('documentMessage').hidden = true;
        $('documentEditor').hidden = false;
        editor.layout();
        $('copy').disabled = false;
        $('download').disabled = false;
        const lines = text ? text.split('\n').length : 0;
        $('documentMeta').textContent = `HTTP ${response.status} · ${resource.filename} · ${lines} ligne(s) · ${text.length} caractères`;
        $('status').textContent = 'Document chargé';
    } catch (error) {
        if (request !== revision || error.name === 'AbortError') return;
        message(error instanceof TypeError ? 'Impossible de joindre le serveur. Cliquez sur Actualiser pour réessayer.' : error.message, true);
        $('documentMeta').textContent = 'Le document n’a pas pu être chargé.';
        $('status').textContent = 'Erreur';
    } finally {
        if (request === revision) $('documentPanel').setAttribute('aria-busy', 'false');
    }
}
function selectDocument(name) {
    if (location.hash === '#' + name) loadDocument(name);
    else location.hash = name;
}
tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectDocument(tab.dataset.document));
    tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[next].focus();
        selectDocument(tabs[next].dataset.document);
    });
});
$('reload').addEventListener('click', () => loadDocument(active));
$('copy').addEventListener('click', async () => {
    if (content === null) return;
    try { await navigator.clipboard.writeText(content); $('status').textContent = 'Document copié'; }
    catch {
        if (!model) return;
        editor.focus();
        editor.setSelection(model.getFullModelRange());
        $('status').textContent = 'Texte sélectionné : Ctrl / ⌘ + C pour copier';
    }
});
$('download').addEventListener('click', () => {
    if (content === null) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = documents[active].filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('hashchange', () => loadDocument(resourceFromHash()));
window.addEventListener('pagehide', () => { controller?.abort(); });
loadDocument(resourceFromHash());
