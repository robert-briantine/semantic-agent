import * as monaco from 'monaco-editor/editor';
import { initDatabaseBrowser } from './database-browser.js';
import { initAgentHistory } from './agent-history.js';
import { appendConsoleValue, parseConsoleValue, referenceId, resetReferenceActions, setReferenceWriteMode, initReferenceActions } from './console-values.js';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typescript from 'monaco-editor/languages/features/typescript/register';

self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
        return new Worker(label === 'typescript' || label === 'javascript' ? '/assets/ts.worker.js' : '/assets/editor.worker.js', { type: 'module' });
    }
};

const $ = id => document.getElementById(id);
const code = $('code'), results = $('results');
const sample = `// Rechercher les personnes enregistrées\nconst personnes = query(\n    select({ p: "Ref" },\n        est(variable("p"), "Personne")\n    )\n)\nprint(personnes)`;
let editor, libraryEditor;
function layoutEditors() {
    requestAnimationFrame(() => { editor?.layout(); libraryEditor?.layout(); });
}
function toggleConsolePane(name) {
    const pane = $(name + 'Pane');
    pane.hidden = !pane.hidden;
    const button = $(name === 'editor' ? 'toggleEditor' : 'toggleOutput');
    button.setAttribute('aria-expanded', String(!pane.hidden));
    button.textContent = (pane.hidden ? 'Afficher' : 'Masquer') + (name === 'editor' ? ' l’éditeur' : ' la sortie');
    $('consolePanel').dataset[name + 'Hidden'] = String(pane.hidden);
    $('consoleEmpty').hidden = !($('editorPane').hidden && $('outputPane').hidden);
    layoutEditors();
}
$('toggleEditor').addEventListener('click', () => toggleConsolePane('editor'));
$('toggleOutput').addEventListener('click', () => toggleConsolePane('output'));
const consoleVisibilityObserver = new MutationObserver(() => {
    $('consoleVisibility').hidden = $('consolePanel').hidden;
});
consoleVisibilityObserver.observe($('consolePanel'), { attributes: true, attributeFilter: ['hidden'] });
const scriptModel = monaco.editor.createModel(sample, 'typescript', monaco.Uri.parse('file:///script.ts'));
let last = null, busy = false;
const headers = { 'Content-Type': 'application/json' };
let activeScriptId = null, scriptList = [], scriptsBusy = false, listBusy = false, replacingScript = false, listRequest = 0;
let activeScriptType = 'utilisateur';
let scriptCatalogType = 'utilisateur';
const scriptCatalogs = [
    { type: 'utilisateur', tab: 'userScriptsTab', panel: 'userScriptsPanel', select: 'savedScripts', open: 'openScript', refresh: 'refreshScripts' },
    { type: 'exemple', tab: 'exampleScriptsTab', panel: 'exampleScriptsPanel', select: 'savedExamples', open: 'openExample', refresh: 'refreshExamples' }
];
let savedScriptState = { name: '', code: sample, mode: 'read' };
const scriptState = () => ({ name: $('scriptName').value.trim(), code: scriptModel.getValue(), mode: $('mode').value });
const scriptDirty = () => {
    const state = scriptState();
    return Object.keys(state).some(key => state[key] !== savedScriptState[key]);
};
function updateScriptControls() {
    setReferenceWriteMode($('mode').value === 'write');
    const unavailable = !editor || scriptsBusy || busy;
    $('resetDatabase').disabled = busy || scriptsBusy;
    $('saveScript').disabled = unavailable || activeScriptType === 'exemple' || !$('scriptName').value.trim();
    $('saveScript').title = activeScriptType === 'exemple' ? 'Clonez cet exemple pour enregistrer vos modifications.' : '';
    $('cloneScript').disabled = unavailable;
    $('newScript').disabled = unavailable;
    $('scriptName').readOnly = activeScriptType === 'exemple';
    for (const catalog of scriptCatalogs) {
        $(catalog.tab).disabled = unavailable;
        $(catalog.select).disabled = unavailable || !scriptList.some(script => script.type === catalog.type);
        $(catalog.open).disabled = unavailable || !$(catalog.select).value;
        $(catalog.refresh).disabled = unavailable || listBusy;
    }
    $('deleteScript').disabled = unavailable || !scriptList.some(script => script.id === $('savedScripts').value && script.type === 'utilisateur');
}
function scriptChanged() {
    updateScriptControls();
    if (replacingScript) return;
    $('scriptStatus').textContent = activeScriptType === 'exemple' ? 'Exemple : cliquez sur « Cloner » pour créer une copie modifiable.' : scriptDirty() ? 'Modifications non enregistrées.' :
        activeScriptId ? 'Toutes les modifications sont enregistrées.' : 'Donnez un nom au script pour l’enregistrer sur le serveur.';
}
function canReplaceScript() {
    return !scriptDirty() || confirm('Les modifications du script ne sont pas enregistrées. Les abandonner ?');
}
function replaceScript({ id = null, name = '', code, mode = 'read', type = 'utilisateur' }) {
    replacingScript = true;
    activeScriptId = id;
    activeScriptType = type;
    editor.updateOptions({ readOnly: type === 'exemple', domReadOnly: type === 'exemple' });
    scriptModel.setValue(code);
    $('scriptName').value = name;
    $('mode').value = mode;
    savedScriptState = scriptState();
    replacingScript = false;
    selectTab('script');
    selectScriptCatalog(type);
    updateScriptControls();
    editor.focus();
}
function renderScriptList(selected = activeScriptId) {
    for (const catalog of scriptCatalogs) {
        const select = $(catalog.select), previous = select.value;
        const scripts = scriptList.filter(script => script.type === catalog.type).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        const label = catalog.type === 'exemple' ? 'exemple' : 'script utilisateur';
        select.replaceChildren(el('option', scripts.length ? `Choisir un ${label}…` : `Aucun ${label}`));
        select.firstChild.value = '';
        scripts.forEach(script => {
            const option = el('option', script.name + (script.mode === 'write' ? ' · Écriture' : ''));
            option.value = script.id;
            select.append(option);
        });
        select.value = scripts.some(script => script.id === selected) ? selected : scripts.some(script => script.id === previous) ? previous : '';
    }
    updateScriptControls();
}
function selectScriptCatalog(type, focus = false) {
    scriptCatalogType = type;
    for (const catalog of scriptCatalogs) {
        const selected = catalog.type === type;
        $(catalog.tab).setAttribute('aria-selected', String(selected));
        $(catalog.tab).tabIndex = selected ? 0 : -1;
        $(catalog.panel).hidden = !selected;
        if (selected && focus) $(catalog.tab).focus();
    }
    layoutEditors();
}
async function scriptRequest(path, options = {}) {
    const response = await fetch(path, { ...options, headers });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'HTTP ' + response.status);
    return data;
}
async function refreshScripts() {
    if (scriptsBusy) return;
    const request = ++listRequest;
    listBusy = true;
    updateScriptControls();
    try {
        const list = await scriptRequest('/api/scripts');
        if (request !== listRequest) return;
        scriptList = list;
        renderScriptList($('savedScripts').value || activeScriptId);
        scriptChanged();
    } catch (error) {
        if (request === listRequest) {
            scriptList = [];
            renderScriptList();
            $('scriptStatus').textContent = error.message;
        }
    } finally {
        if (request === listRequest) { listBusy = false; updateScriptControls(); }
    }
}
async function saveCurrentScript() {
    if (!editor || scriptsBusy) return;
    if (activeScriptType === 'exemple') { $('scriptStatus').textContent = 'Clonez cet exemple pour enregistrer vos modifications.'; return; }
    const state = scriptState();
    if (!state.name) { $('scriptName').focus(); return; }
    scriptsBusy = true;
    updateScriptControls();
    $('scriptStatus').textContent = 'Enregistrement…';
    // Une réponse de liste antérieure ne doit pas effacer le script qui vient d’être créé.
    ++listRequest;
    listBusy = false;
    try {
        const script = await scriptRequest(activeScriptId ? '/api/scripts/' + activeScriptId : '/api/scripts', {
            method: activeScriptId ? 'PUT' : 'POST', body: JSON.stringify(state)
        });
        activeScriptId = script.id;
        savedScriptState = state;
        scriptList = scriptList.filter(item => item.id !== script.id);
        scriptList.push(script);
        selectScriptCatalog('utilisateur');
        renderScriptList(script.id);
        $('scriptStatus').textContent = scriptDirty() ? 'Script enregistré. De nouvelles modifications restent à enregistrer.' : `Script « ${script.name} » enregistré sur le serveur.`;
        $('status').textContent = 'Script enregistré';
    } catch (error) {
        $('scriptStatus').textContent = error.message;
    } finally { scriptsBusy = false; updateScriptControls(); }
}
async function openSavedScript(type = scriptCatalogType) {
    const catalog = scriptCatalogs.find(catalog => catalog.type === type);
    const id = $(catalog.select).value;
    if (!id || scriptsBusy || !canReplaceScript()) return;
    const previousState = scriptState();
    scriptsBusy = true;
    updateScriptControls();
    $('scriptStatus').textContent = 'Chargement du script…';
    try {
        const script = await scriptRequest('/api/scripts/' + id);
        // Conserver d’éventuelles modifications saisies pendant le chargement.
        if (JSON.stringify(scriptState()) !== JSON.stringify(previousState) && !canReplaceScript()) { scriptChanged(); return; }
        replaceScript(script);
        $('scriptStatus').textContent = script.type === 'exemple' ?
            'Exemple chargé. Exécutez-le ou cliquez sur « Cloner » pour créer une copie modifiable.' :
            `Script « ${script.name} » chargé. Cliquez sur « Exécuter le script » pour le rejouer.`;
        $('status').textContent = 'Script chargé';
    } catch (error) {
        $('scriptStatus').textContent = error.message;
    } finally { scriptsBusy = false; updateScriptControls(); }
}
async function deleteSelectedScript() {
    const script = scriptList.find(script => script.id === $('savedScripts').value && script.type === 'utilisateur');
    if (!script || scriptsBusy || busy) return;
    const unsaved = activeScriptId === script.id && scriptDirty() ? ' Les modifications non enregistrées seront également abandonnées.' : '';
    if (!confirm(`Supprimer le script « ${script.name} » ?${unsaved}`)) return;
    scriptsBusy = true;
    ++listRequest;
    listBusy = false;
    updateScriptControls();
    try {
        await scriptRequest('/api/scripts/' + script.id, { method: 'DELETE' });
        scriptList = scriptList.filter(item => item.id !== script.id);
        if (activeScriptId === script.id) replaceScript({ code: '' });
        renderScriptList();
        $('scriptStatus').textContent = `Script « ${script.name} » supprimé.`;
    } catch (error) { $('scriptStatus').textContent = error.message; }
    finally { scriptsBusy = false; updateScriptControls(); }
}
async function cloneCurrentScript() {
    if (!editor || scriptsBusy) return;
    const state = scriptState();
    scriptsBusy = true;
    ++listRequest;
    listBusy = false;
    updateScriptControls();
    $('scriptStatus').textContent = 'Création de la copie…';
    try {
        const script = await scriptRequest('/api/scripts/clone', {
            method: 'POST', body: JSON.stringify({ ...state, name: state.name || 'Script' })
        });
        scriptList.push(script);
        if (JSON.stringify(scriptState()) === JSON.stringify(state)) {
            replaceScript(script);
            renderScriptList(script.id);
            $('scriptStatus').textContent = `Copie « ${script.name} » enregistrée et chargée dans l’éditeur.`;
        } else {
            renderScriptList();
            $('scriptStatus').textContent = `Copie « ${script.name} » enregistrée. Les modifications saisies pendant le clonage sont conservées dans le script courant.`;
        }
        $('status').textContent = 'Script cloné';
    } catch (error) { $('scriptStatus').textContent = error.message; }
    finally { scriptsBusy = false; updateScriptControls(); }
}
function el(tag, text, cls) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; }
function selectTab(name, focusTab = false) {
    for (const tab of ['script', 'library']) {
        const selected = tab === name;
        $(tab + 'Tab').setAttribute('aria-selected', String(selected));
        $(tab + 'Tab').tabIndex = selected ? 0 : -1;
        $(tab + 'Panel').hidden = !selected;
    }
    (name === 'script' ? editor : libraryEditor)?.layout();
    if (focusTab) $(name + 'Tab').focus();
}
for (const name of ['script', 'library']) {
    $(name + 'Tab').addEventListener('click', () => selectTab(name));
    $(name + 'Tab').addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        selectTab(event.key === 'Home' ? 'script' : event.key === 'End' ? 'library' : name === 'script' ? 'library' : 'script', true);
    });
}
async function initEditor() {
    try {
        const [source, declarations] = await Promise.all(['/editor/structure-langage-pour-ia.ts', '/editor/structure-langage.d.ts'].map(async path => {
            const response = await fetch(path);
            if (!response.ok) throw Error('Chargement de la librairie : HTTP ' + response.status);
            return response.text();
        }));
        typescript.typescriptDefaults.setCompilerOptions({
            target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.CommonJS,
            moduleResolution: typescript.ModuleResolutionKind.NodeJs, strict: true,
            lib: ['lib.es2022.d.ts'], noEmit: true
        });
        typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
        typescript.typescriptDefaults.addExtraLib(declarations, 'file:///lib/structure-langage.d.ts');
        // Le source consultable conserve son import Node ; seul son type est nécessaire ici.
        typescript.typescriptDefaults.addExtraLib('declare module "node:crypto" { export function randomUUID(): string; }', 'file:///lib/node-crypto.d.ts');
        typescript.typescriptDefaults.setEagerModelSync(true);
        const options = { theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false },
            fontSize: 14, lineHeight: 22, scrollBeyondLastLine: false, tabSize: 4, padding: { top: 14 },
            quickSuggestions: { other: true, comments: false, strings: true },
            fixedOverflowWidgets: true };
        code.replaceChildren();
        editor = monaco.editor.create(code, { ...options, model: scriptModel, ariaLabel: 'Code TypeScript à exécuter' });
        editor.onDidType(text => {
            if (text !== '"' && text !== "'") return;
            const position = editor.getPosition();
            // Après l’ouverture d’une chaîne avec fermeture automatique, proposer ses valeurs.
            if (scriptModel.getLineContent(position.lineNumber)[position.column - 1] === text) {
                const version = scriptModel.getVersionId();
                // Laisser Monaco terminer le traitement de la frappe avant d’ouvrir la liste.
                setTimeout(() => {
                    const current = editor.getPosition();
                    if (scriptModel.getVersionId() === version && editor.hasTextFocus() &&
                        current.lineNumber === position.lineNumber && current.column === position.column) {
                        editor.trigger('semantic', 'editor.action.triggerSuggest', {});
                    }
                }, 50);
            }
        });
        editor.addAction({ id: 'semantic.execute', label: 'Exécuter le script',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run });
        editor.addAction({ id: 'semantic.save', label: 'Enregistrer le script',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: saveCurrentScript });
        libraryEditor = monaco.editor.create($('libraryCode'), { ...options,
            model: monaco.editor.createModel(source, 'typescript', monaco.Uri.parse('file:///source/structure-langage-pour-ia.ts')),
            readOnly: true, domReadOnly: true, ariaLabel: 'Librairie structure-langage-pour-ia.ts en lecture seule' });
        $('run').disabled = false;
        $('editorStatus').textContent = 'TypeScript · autocomplétion et vérification des types · Ctrl + Espace pour les suggestions';
        updateScriptControls();
        refreshScripts();
    } catch (error) {
        $('status').textContent = 'Erreur';
        $('editorStatus').textContent = 'Impossible de charger l’éditeur : ' + error.message + '. Rechargez la page pour réessayer.';
        code.replaceChildren(el('p', 'Éditeur indisponible.', 'error editor-loading'));
    }
}
function object(v) { return v!==null && typeof v==='object' && !Array.isArray(v); }
function renderValue(parent, value) {
    // Les chaînes contenant du JSON sont également reconnues.
    value=parseConsoleValue(value);
    if(referenceId(value)!==null){appendConsoleValue(parent,value);return;}
    if(Array.isArray(value) && value.length===0) {parent.append(el('div','Aucun résultat','empty'));return;}
    let rows=null;
    if(Array.isArray(value) && value.every(v=>referenceId(v)!==null)) rows=value.map(ref=>({Référence:ref}));
    else if(Array.isArray(value) && value.every(object)) rows=value;
    else if(object(value)) rows=[value];
    else if(Array.isArray(value) && value.every(v=>v===null||typeof v!=='object')) rows=value.map(v=>({Valeur:v}));
    else if(Array.isArray(value) && value.every(Array.isArray) && value.every(v=>v.length===value[0].length)) rows=value.map(v=>Object.fromEntries(v.map((x,i)=>['Colonne '+(i+1),x])));
    if(rows) {
        const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
        if(keys.length) {
            const wrap=el('div',undefined,'table-wrap'), table=el('table'), head=el('thead'), tr=el('tr');
            keys.forEach(k=>{const th=el('th',k);th.scope='col';tr.append(th);}); head.append(tr);table.append(head);
            const body=el('tbody'); rows.forEach(row=>{const tr=el('tr');keys.forEach(k=>{const td=el('td');const v=parseConsoleValue(Object.hasOwn(row,k)?row[k]:undefined);if(v!==null&&typeof v==='object')appendConsoleValue(td,v);else td.textContent=v===undefined?(Object.hasOwn(row,k)?'undefined':'—'):String(v);tr.append(td);});body.append(tr);});table.append(body);wrap.append(table);parent.append(wrap);return;
        }
    }
    parent.append(el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)??'undefined'));
}
function show(data) {
    resetReferenceActions();
    last=data;results.replaceChildren();$('raw').textContent=JSON.stringify(data,null,2);$('rawPanel').hidden=false;$('copy').disabled=false;
    if(!data.ok) {results.append(el('pre',data.error||'Erreur inconnue','error'));return;}
    const output=Array.isArray(data.output)?data.output:[];
    if(!output.length){results.append(el('p','Script exécuté sans appel à print().','empty'));return;}
    output.forEach((args,i)=>{const block=el('div',undefined,'result');block.append(el('h3','print() '+(i+1)));(Array.isArray(args)?args:[args]).forEach(v=>renderValue(block,v));results.append(block);});
}
async function run() {
    if(busy || !editor || $('editorPane').hidden || $('scriptPanel').hidden || $('consolePanel').hidden)return;
    if($('mode').value==='write'&&!confirm('Ce script peut modifier la mémoire SQLite. Confirmer l’exécution ?'))return;
    busy=true;updateScriptControls();$('run').disabled=true;$('status').textContent='Exécution…';$('meta').textContent='Script en cours…';results.replaceChildren();resetReferenceActions();$('rawPanel').hidden=true;$('copy').disabled=true;last=null;
    const start=performance.now();
    try {const response=await fetch('/api/execute',{method:'POST',headers,body:JSON.stringify({code:scriptModel.getValue(),mode:$('mode').value})});const data=await response.json();show(data);$('status').textContent=data.ok?'Terminé':'Erreur';$('meta').textContent=`HTTP ${response.status} · ${Math.round(performance.now()-start)} ms · ${data.ok?(data.output?.length??0)+' sortie(s)':'Échec'}`;}
    catch(e){show({ok:false,error:String(e)});$('status').textContent='Erreur';$('meta').textContent='Impossible de joindre le serveur ou réponse invalide.';}
    finally{busy=false;$('run').disabled=false;updateScriptControls();}
}
$('run').addEventListener('click',run);
$('resetDatabase').addEventListener('click', async () => {
    if (busy || scriptsBusy) return;
    if (!confirm('RAZ : vider la mémoire et l’historique de l’agent ? Les scripts enregistrés et le code de l’éditeur seront conservés. Cette action est irréversible.')) return;
    busy = true;
    $('run').disabled = true;
    updateScriptControls();
    $('status').textContent = 'Remise à zéro…';
    try {
        const response = await fetch('/api/database/reset', { method: 'POST', headers, body: JSON.stringify({ confirm: 'RAZ' }) });
        const data = await response.json();
        if (!response.ok || !data.ok) throw Error(data.error || 'HTTP ' + response.status);
        $('clear').click();
        $('status').textContent = 'Base remise à zéro';
        $('meta').textContent = 'Mémoire et historique de l’agent vidés. Les scripts enregistrés et le code courant sont conservés.';
        window.dispatchEvent(new Event('semantic:database-reset'));
        window.dispatchEvent(new Event('semantic:memory-changed'));
    } catch (error) { $('status').textContent = 'RAZ impossible'; $('meta').textContent = error.message; }
    finally { busy = false; $('run').disabled = !editor; updateScriptControls(); }
});
window.addEventListener('semantic:reference-status',event=>{$('meta').textContent=event.detail;});
$('clear').addEventListener('click',()=>{results.replaceChildren();resetReferenceActions();$('rawPanel').hidden=true;$('copy').disabled=true;last=null;$('meta').textContent='Résultats effacés.';});
$('copy').addEventListener('click',async()=>{if(last===null)return;try{await navigator.clipboard.writeText(JSON.stringify(last,null,2));$('status').textContent='JSON copié';}catch{$('rawPanel').open=true;$('status').textContent='Copie manuelle disponible';}});
scriptModel.onDidChangeContent(scriptChanged);
$('scriptName').addEventListener('input',scriptChanged);
$('mode').addEventListener('change',scriptChanged);
$('savedScripts').addEventListener('change',updateScriptControls);
$('savedExamples').addEventListener('change',updateScriptControls);
$('saveScript').addEventListener('click',saveCurrentScript);
$('cloneScript').addEventListener('click',cloneCurrentScript);
$('openScript').addEventListener('click',()=>openSavedScript('utilisateur'));
$('openExample').addEventListener('click',()=>openSavedScript('exemple'));
$('deleteScript').addEventListener('click',deleteSelectedScript);
$('refreshScripts').addEventListener('click',refreshScripts);
$('refreshExamples').addEventListener('click',refreshScripts);
for (const catalog of scriptCatalogs) {
    $(catalog.tab).addEventListener('click',()=>selectScriptCatalog(catalog.type));
    $(catalog.tab).addEventListener('keydown',event=>{
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const type = event.key === 'Home' ? 'utilisateur' : event.key === 'End' ? 'exemple' : catalog.type === 'utilisateur' ? 'exemple' : 'utilisateur';
        selectScriptCatalog(type, true);
    });
}
$('newScript').addEventListener('click',()=>{if(!canReplaceScript())return;replaceScript({code:''});$('savedScripts').value='';scriptChanged();$('scriptName').focus();});
window.addEventListener('beforeunload',event=>{if(scriptDirty()){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',e=>{
    if($('consolePanel').hidden)return;
    if(!(e.ctrlKey||e.metaKey))return;
    if(e.key==='Enter'){e.preventDefault();run();}
    if(e.key.toLowerCase()==='s'&&!$('editorPane').hidden&&!$('scriptPanel').hidden){e.preventDefault();saveCurrentScript();}
});
initReferenceActions();
initDatabaseBrowser(layoutEditors, initAgentHistory());
initEditor();
