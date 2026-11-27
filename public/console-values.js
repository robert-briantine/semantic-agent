const removed = new Set();
const available = new Set(), selected = new Set();
let deleting = false;
let writeAllowed = false, modeVersion = 0, outputVersion = 0;

export function setReferenceWriteMode(allowed) {
    if (writeAllowed !== allowed) modeVersion++;
    writeAllowed = allowed;
    if (!allowed) selected.clear();
    updateSelection();
}

export function referenceId(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return null;
    if (typeof value.$ref === 'string') return value.$ref;
    // Les Ref retournées par l’exécuteur utilisent actuellement la forme { id: string }.
    if (typeof value.id === 'string') return value.id;
    return null;
}
export function parseConsoleValue(value) {
    if (typeof value === 'string') {
        try { const parsed = JSON.parse(value); if (parsed !== null && typeof parsed === 'object') value = parsed; } catch {}
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value.$undefined === true) return undefined;
    return value;
}
export function resetReferenceActions() {
    removed.clear(); available.clear(); selected.clear(); outputVersion++;
    updateSelection();
}
function configureCheckbox(checkbox) {
    const id = checkbox.dataset.ref, deleted = removed.has(id);
    checkbox.disabled = !writeAllowed || deleting || deleted;
    checkbox.checked = !deleted && selected.has(id);
    checkbox.title = deleted ? 'Référence supprimée' : writeAllowed ? 'Sélectionner la référence ' + id : 'Passez en mode Écriture pour sélectionner les références.';
    checkbox.setAttribute('aria-label', checkbox.title);
    checkbox.parentElement?.classList.toggle('reference-removed', deleted);
}
function updateSelection() {
    for (const checkbox of document.querySelectorAll('.reference-select')) configureCheckbox(checkbox);
    const toolbar = document.getElementById('referenceActions');
    if (!toolbar) return;
    const count = [...available].filter(id => !removed.has(id)).length;
    toolbar.hidden = !available.size;
    document.getElementById('referenceSelectAll').disabled = !writeAllowed || deleting || selected.size === count;
    document.getElementById('referenceSelectNone').disabled = !writeAllowed || deleting || !selected.size;
    document.getElementById('referenceDeleteSelected').disabled = !writeAllowed || deleting || !selected.size;
    document.getElementById('referenceSelectionCount').textContent = selected.size + ' / ' + count + ' référence(s) sélectionnée(s)' + (writeAllowed ? '' : ' · Lecture seule');
}
export function initReferenceActions() {
    document.getElementById('referenceSelectAll').addEventListener('click', () => {
        if (!writeAllowed || deleting) return;
        for (const id of available) if (!removed.has(id)) selected.add(id);
        updateSelection();
    });
    document.getElementById('referenceSelectNone').addEventListener('click', () => {
        if (!writeAllowed || deleting) return;
        selected.clear(); updateSelection();
    });
    document.getElementById('referenceDeleteSelected').addEventListener('click', deleteSelection);
    updateSelection();
}
async function deleteSelection() {
    if (!writeAllowed || deleting || !selected.size) return;
    const refIds = [...selected], version = modeVersion, output = outputVersion;
    deleting = true; updateSelection();
    const current = () => writeAllowed && version === modeVersion && output === outputVersion;
    const message = text => window.dispatchEvent(new CustomEvent('semantic:reference-status', { detail: text }));
    const markRemoved = () => {
        if (output !== outputVersion) return;
        for (const id of refIds) { removed.add(id); selected.delete(id); }
    };
    try {
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const response = await fetch('/api/refs/preview', { ...options, body: JSON.stringify({ refIds }) });
        const usage = await response.json();
        if (!response.ok || !usage.ok) throw Error(usage.error || 'HTTP ' + response.status);
        if (!current()) return;
        if (!usage.existingRefs && !usage.compositions && !usage.phrases) {
            markRemoved(); message('Ces références et leurs faits ont déjà été supprimés.'); return;
        }
        if (!confirm(refIds.length + ' référence(s) sélectionnée(s).\n\nSupprimer ' + usage.compositions + ' composition(s) et ' + usage.phrases + ' phrase(s) liées à cette sélection, y compris dans les compléments et propositions imbriquées ? Les faits communs sont comptés une seule fois.')) return;
        if (!current()) return;
        const deletion = await fetch('/api/refs/delete', { ...options, body: JSON.stringify({ refIds, mode: 'write' }) });
        const result = await deletion.json();
        if (!deletion.ok || !result.ok) throw Error(result.error || 'HTTP ' + deletion.status);
        markRemoved();
        message(result.deleted.compositions + ' composition(s) et ' + result.deleted.phrases + ' phrase(s) supprimées pour ' + refIds.length + ' référence(s). La sortie affichée est conservée ; relancez une lecture pour l’actualiser.');
        window.dispatchEvent(new CustomEvent('semantic:memory-changed', { detail: result }));
    } catch (error) { message('Suppression impossible : ' + error.message); }
    finally { deleting = false; updateSelection(); }
}
function appendJson(parent, value, depth = 0) {
    value = parseConsoleValue(value);
    const id = referenceId(value);
    if (id !== null) {
        available.add(id);
        const label = document.createElement('label'); label.className = 'reference-value';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'reference-select'; checkbox.dataset.ref = id;
        checkbox.addEventListener('change', () => {
            if (writeAllowed && !deleting && !removed.has(id)) {
                if (checkbox.checked) selected.add(id); else selected.delete(id);
            }
            updateSelection();
        });
        label.append(checkbox, document.createTextNode(JSON.stringify(value)));
        configureCheckbox(checkbox); parent.append(label); return;
    }
    if (value !== null && typeof value === 'object') {
        const array = Array.isArray(value), entries = Object.entries(value);
        parent.append(document.createTextNode(array ? '[' : '{'));
        entries.forEach(([key, child], index) => {
            parent.append(document.createTextNode('\n' + '  '.repeat(depth + 1) + (array ? '' : JSON.stringify(key) + ': ')));
            appendJson(parent, child, depth + 1);
            if (index < entries.length - 1) parent.append(document.createTextNode(','));
        });
        parent.append(document.createTextNode((entries.length ? '\n' + '  '.repeat(depth) : '') + (array ? ']' : '}')));
    } else parent.append(document.createTextNode(JSON.stringify(value) ?? 'undefined'));
}
export function appendConsoleValue(parent, input) {
    const value = parseConsoleValue(input), pre = document.createElement('pre');
    if (value !== null && typeof value === 'object') appendJson(pre, value);
    else pre.textContent = typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined';
    parent.append(pre); updateSelection();
}
