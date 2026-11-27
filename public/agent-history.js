const $ = id => document.getElementById(id);
const labels = { running: 'En cours', succeeded: 'Réussi', failed: 'Échec' };

export function initAgentHistory() {
    let offset = 0, calls = [], selected = null, hasMore = false, revision = 0, detailRevision = 0;
    let listController, detailController;
    const limit = 25;
    function clearDetail() {
        ++detailRevision;
        detailController?.abort();
        selected = null;
        $('historyDetail').hidden = true;
        $('historyEmpty').hidden = false;
        $('historyEmpty').textContent = 'Sélectionnez un appel pour consulter son texte source, son code et sa réponse.';
        for (const id of ['historySummary', 'historySource', 'historyCode', 'historyResponse']) $(id).textContent = '';
    }
    function renderCalls() {
        $('historyCalls').replaceChildren();
        for (const call of calls) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'history-call';
            button.setAttribute('aria-pressed', String(selected === call.id));
            const source = document.createElement('strong');
            source.textContent = call.sourcePreview;
            const meta = document.createElement('span');
            meta.textContent = `${new Date(call.createdAt).toLocaleString('fr-FR')} · ${call.mode} · ${labels[call.status] || call.status}`;
            button.append(source, meta);
            button.addEventListener('click', () => loadDetail(call.id));
            $('historyCalls').append(button);
        }
    }
    async function loadDetail(id) {
        clearDetail();
        selected = id;
        renderCalls();
        const version = detailRevision;
        detailController = new AbortController();
        $('historyEmpty').textContent = 'Chargement de l’appel…';
        try {
            const response = await fetch('/api/agent/calls/' + encodeURIComponent(id), { cache: 'no-store', signal: detailController.signal });
            const data = await response.json();
            if (version !== detailRevision) return;
            if (!response.ok || !data.ok || !data.call) throw Error(data.error || 'Appel introuvable.');
            const call = data.call;
            $('historySummary').textContent = `${call.id} · ${new Date(call.createdAt).toLocaleString('fr-FR')} · ${call.mode} · ${labels[call.status] || call.status} · HTTP ${call.httpStatus ?? '—'} · ${call.durationMs ?? '—'} ms`;
            $('historySource').textContent = call.source;
            $('historyCode').textContent = call.code;
            $('historyResponse').textContent = call.response === null ? 'En attente de la réponse.' : JSON.stringify(call.response, null, 2);
            $('historyEmpty').hidden = true;
            $('historyDetail').hidden = false;
        } catch (error) {
            if (version === detailRevision && error.name !== 'AbortError') $('historyEmpty').textContent = error.message;
        }
    }
    async function refresh() {
        const version = ++revision;
        listController?.abort();
        listController = new AbortController();
        $('historyRefresh').disabled = true;
        $('historyPrevious').disabled = true;
        $('historyNext').disabled = true;
        $('historyStatus').textContent = 'Chargement de l’historique…';
        try {
            const response = await fetch(`/api/agent/calls?limit=${limit}&offset=${offset}`, { cache: 'no-store', signal: listController.signal });
            const data = await response.json();
            if (version !== revision) return;
            if (!response.ok || !data.ok) throw Error(data.error || 'HTTP ' + response.status);
            calls = data.calls; hasMore = data.hasMore;
            if (selected && !calls.some(call => call.id === selected)) clearDetail();
            renderCalls();
            $('historyStatus').textContent = calls.length ? `Appels ${offset + 1} à ${offset + calls.length}` : 'Aucun appel de l’agent enregistré.';
            if (selected) loadDetail(selected);
        } catch (error) {
            if (version === revision && error.name !== 'AbortError') $('historyStatus').textContent = error.message;
        } finally {
            if (version === revision) {
                $('historyRefresh').disabled = false;
                $('historyPrevious').disabled = offset === 0;
                $('historyNext').disabled = !hasMore;
            }
        }
    }
    $('historyRefresh').addEventListener('click', refresh);
    $('historyPrevious').addEventListener('click', () => { offset = Math.max(0, offset - limit); clearDetail(); refresh(); });
    $('historyNext').addEventListener('click', () => { if (hasMore) { offset += limit; clearDetail(); refresh(); } });
    window.addEventListener('semantic:database-reset', () => {
        ++revision; listController?.abort(); clearDetail();
        offset = 0; calls = []; hasMore = false;
        renderCalls();
        $('historyStatus').textContent = 'Aucun appel de l’agent enregistré.';
        $('historyRefresh').disabled = false;
        $('historyPrevious').disabled = true;
        $('historyNext').disabled = true;
    });
    return refresh;
}
