const $ = id => document.getElementById(id);
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };

export function initDatabaseBrowser(onConsole, onHistory) {
    let tables = [], selectedTable = '', opened = false, loadingTables = false;
    let result = null, executedSql = '', queryVersion = 0, controller;
    let tablesVersion = 0, tablesController;
    const views = ['console', 'database', 'history'];

    function selectView(name, focus = false) {
        for (const view of views) {
            const selected = view === name;
            $(view + 'Tab').setAttribute('aria-selected', String(selected));
            $(view + 'Tab').tabIndex = selected ? 0 : -1;
            $(view + 'Panel').hidden = !selected;
        }
        if (focus) $(name + 'Tab').focus();
        if (name === 'console') onConsole();
        if (name === 'history') onHistory();
        if (name === 'database' && !opened) { opened = true; refreshTables(true); }
    }
    const viewFromHash = () => views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'console';
    function openView(name, focus = false) {
        history.replaceState(null, '', name === 'console' ? location.pathname + location.search : '#' + name);
        selectView(name, focus);
    }
    views.forEach((view, index) => {
        $(view + 'Tab').addEventListener('click', () => openView(view));
        $(view + 'Tab').addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            openView(event.key === 'Home' ? views[0] : event.key === 'End' ? views.at(-1) : views[(index + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length], true);
        });
    });
    window.addEventListener('hashchange', () => selectView(viewFromHash()));

    function tableGrid(parent, columns, rows) {
        parent.replaceChildren();
        if (!columns.length) { parent.append(element('p', 'Aucune colonne à afficher.')); return; }
        const table = element('table'), head = element('thead'), heading = element('tr');
        for (const name of columns) { const th = element('th', name); th.scope = 'col'; heading.append(th); }
        head.append(heading); table.append(head);
        const body = element('tbody');
        for (const row of rows) {
            const tr = element('tr');
            for (const name of columns) {
                const td = element('td'), value = row[name];
                const text = value === null ? 'NULL' : value === undefined ? '—' : String(value);
                const cell = element('pre', text);
                if (value === null) cell.className = 'hint';
                td.append(cell); tr.append(td);
            }
            body.append(tr);
        }
        if (!rows.length) {
            const tr = element('tr'), td = element('td', 'Aucune ligne.');
            td.colSpan = columns.length; td.className = 'empty'; tr.append(td); body.append(tr);
        }
        table.append(body); parent.append(table);
    }
    function renderSchema() {
        const table = tables.find(table => table.name === selectedTable);
        $('databaseSchema').hidden = !table;
        if (!table) return;
        $('databaseSchemaTitle').textContent = 'Colonnes de ' + table.name;
        tableGrid($('databaseColumns'), ['Colonne', 'Type', 'Contrainte'], table.columns.map(column => ({
            Colonne: column.name, Type: column.type,
            Contrainte: [column.pk ? 'Clé primaire (' + column.pk + ')' : '', column.notNull ? 'NOT NULL' : ''].filter(Boolean).join(' · ') || '—'
        })));
    }
    function renderTables() {
        $('databaseTables').replaceChildren();
        for (const table of tables) {
            const button = element('button'); button.type = 'button'; button.className = 'database-table';
            button.setAttribute('aria-pressed', String(table.name === selectedTable));
            button.append(element('strong', table.name), element('span', table.rowCount + ' ligne(s)'));
            button.addEventListener('click', () => openTable(table));
            $('databaseTables').append(button);
        }
        renderSchema();
    }
    function openTable(table) {
        selectedTable = table.name;
        const quote = name => '"' + name.replace(/"/g, '""') + '"';
        const keys = table.columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => quote(column.name));
        $('databaseSql').value = 'SELECT * FROM ' + quote(table.name) + (keys.length ? '\nORDER BY ' + keys.join(', ') : '') + ';';
        renderTables(); runQuery();
    }
    async function refreshTables(selectFirst = false, force = false) {
        if (loadingTables && !force) return;
        const version = ++tablesVersion;
        tablesController?.abort();
        tablesController = new AbortController();
        loadingTables = true; $('databaseRefresh').disabled = true;
        $('databaseTablesStatus').textContent = 'Chargement des tables…';
        try {
            const response = await fetch('/api/database/tables', { cache: 'no-store', signal: tablesController.signal });
            const data = await response.json();
            if (version !== tablesVersion) return;
            if (!response.ok || !data.ok) throw Error(data.error || 'HTTP ' + response.status);
            tables = data.tables; renderTables();
            $('databaseTablesStatus').textContent = tables.length + ' table(s) · compteurs actualisés';
            if (selectFirst && tables.length) openTable(tables[0]);
            else if (result) runQuery();
        } catch (error) { if (version === tablesVersion && error.name !== 'AbortError') $('databaseTablesStatus').textContent = error.message; }
        finally { if (version === tablesVersion) { loadingTables = false; $('databaseRefresh').disabled = false; } }
    }
    function updatePagination(loading = false) {
        const current = result && executedSql === $('databaseSql').value && result.limit === Number($('databaseLimit').value);
        $('databasePrevious').disabled = loading || !current || result.offset === 0;
        $('databaseNext').disabled = loading || !current || !result.hasMore;
    }
    async function runQuery(offset = 0) {
        const sql = $('databaseSql').value;
        const limit = Number($('databaseLimit').value);
        const version = ++queryVersion;
        controller?.abort(); controller = new AbortController();
        result = null; $('databaseCopy').disabled = true; $('databaseRun').disabled = true;
        $('databaseResults').replaceChildren(); $('databaseResults').setAttribute('aria-busy', 'true');
        $('databaseStatus').textContent = 'Requête en cours…'; $('databaseStatus').classList.remove('error');
        $('databasePage').textContent = 'Chargement…'; updatePagination(true);
        const start = performance.now();
        try {
            const response = await fetch('/api/database/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ sql, limit, offset })
            });
            const data = await response.json();
            if (version !== queryVersion) return;
            if (!response.ok || !data.ok) throw Error(data.error || 'HTTP ' + response.status);
            result = data; executedSql = sql;
            tableGrid($('databaseResults'), data.columns, data.rows);
            $('databaseStatus').textContent = data.rows.length + ' ligne(s) affichée(s) · ' + Math.round(performance.now() - start) + ' ms';
            $('databasePage').textContent = data.rows.length ? 'Lignes ' + (offset + 1) + ' à ' + (offset + data.rows.length) + (data.hasMore ? ' · suite disponible' : '') : 'Aucune ligne à cette page';
            $('databaseCopy').disabled = false;
        } catch (error) {
            if (version !== queryVersion || error.name === 'AbortError') return;
            $('databaseStatus').textContent = error.message; $('databaseStatus').classList.add('error');
            $('databasePage').textContent = 'Aucun résultat';
        } finally {
            if (version === queryVersion) {
                $('databaseRun').disabled = false; $('databaseResults').setAttribute('aria-busy', 'false'); updatePagination();
            }
        }
    }
    $('databaseRun').addEventListener('click', () => runQuery());
    $('databaseRefresh').addEventListener('click', () => refreshTables());
    window.addEventListener('semantic:memory-changed', () => { if (opened) refreshTables(); });
    window.addEventListener('semantic:database-reset', () => {
        ++queryVersion; controller?.abort();
        result = null; executedSql = '';
        $('databaseResults').replaceChildren();
        $('databaseResults').setAttribute('aria-busy', 'false');
        $('databaseCopy').disabled = true; $('databaseRun').disabled = false;
        $('databaseStatus').textContent = 'Mémoire et historique de l’agent vidés. Les scripts enregistrés sont conservés.';
        $('databasePage').textContent = 'Aucun résultat';
        updatePagination();
        if (opened) refreshTables(false, true);
    });
    $('databasePrevious').addEventListener('click', () => { if (result) runQuery(Math.max(0, result.offset - result.limit)); });
    $('databaseNext').addEventListener('click', () => { if (result) runQuery(result.offset + result.limit); });
    $('databaseSql').addEventListener('input', () => updatePagination($('databaseRun').disabled));
    $('databaseLimit').addEventListener('change', () => runQuery());
    $('databaseSql').addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!$('databaseRun').disabled) runQuery(); }
    });
    $('databaseCopy').addEventListener('click', async () => {
        if (!result) return;
        try { await navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2)); $('databaseStatus').textContent = 'Résultats copiés en JSON.'; }
        catch { $('databaseStatus').textContent = 'La copie dans le presse-papiers a échoué.'; }
    });
    selectView(viewFromHash());
}
