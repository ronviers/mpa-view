/* mpa-view shell — single-page app, no framework.
   - Loads /api/cells on boot, builds the picker.
   - On cell click, fetches /api/view/gfdr/<id> and renders Plotly trace.
   - URL hash `#<task_id>` deep-links to a cell.
*/
(() => {
    const els = {
        health: document.getElementById('health'),
        substrateFilter: document.getElementById('substrate-filter'),
        gtFilter: document.getElementById('gt-filter'),
        xdotFilter: document.getElementById('xdot-filter'),
        cellCount: document.getElementById('cell-count'),
        cellList: document.getElementById('cell-list'),
        cellHeader: document.getElementById('cell-header'),
        plot: document.getElementById('plot'),
        cellMeta: document.getElementById('cell-meta'),
    };

    const state = {
        cells: [],
        filtered: [],
        activeId: null,
    };

    // ── Boot ───────────────────────────────────────────────────────────

    Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/cells').then(r => r.json()),
    ]).then(([health, cellsResp]) => {
        renderHealth(health);
        state.cells = cellsResp.cells || [];
        seedFilters(state.cells);
        applyFilters();
        // Deep-link via #task_id
        const initial = decodeURIComponent(location.hash.replace(/^#/, ''));
        if (initial && state.cells.find(c => c.task_id === initial)) {
            selectCell(initial);
        }
    }).catch(err => {
        els.health.textContent = `boot failed: ${err}`;
    });

    // ── Health line ────────────────────────────────────────────────────

    function renderHealth(h) {
        const subs = Object.entries(h.per_substrate || {})
            .map(([k, v]) => `${k}=${v}`).join(' · ');
        const gts = Object.entries(h.per_gt || {})
            .map(([k, v]) => `${k}=${v}`).join(' ');
        const warn = h.unreachable_cells && h.unreachable_cells.length
            ? ` · ${h.unreachable_cells.length} unreachable!`
            : '';
        els.health.textContent =
            `library: ${h.n_cells} cells · ${subs} · gt(${gts})${warn}`;
    }

    // ── Filters ────────────────────────────────────────────────────────

    function seedFilters(cells) {
        const subs = uniq(cells.map(c => c.substrate)).sort();
        for (const s of subs) {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            els.substrateFilter.appendChild(opt);
        }
        const xks = uniq(cells.map(c => c.xdot_kind)).sort();
        for (const x of xks) {
            const opt = document.createElement('option');
            opt.value = x; opt.textContent = x;
            els.xdotFilter.appendChild(opt);
        }
        for (const f of [els.substrateFilter, els.gtFilter, els.xdotFilter]) {
            f.addEventListener('change', applyFilters);
        }
    }

    function uniq(arr) {
        return Array.from(new Set(arr)).filter(x => x != null && x !== '');
    }

    function applyFilters() {
        const sub = els.substrateFilter.value;
        const gt = els.gtFilter.value;
        const xk = els.xdotFilter.value;
        state.filtered = state.cells.filter(c =>
            (!sub || c.substrate === sub) &&
            (!gt || c.gt === gt) &&
            (!xk || c.xdot_kind === xk)
        );
        renderCellList();
    }

    function renderCellList() {
        els.cellCount.textContent =
            `${state.filtered.length} of ${state.cells.length} cells`;
        els.cellList.innerHTML = '';
        for (const c of state.filtered) {
            const li = document.createElement('li');
            li.dataset.taskId = c.task_id;
            if (c.task_id === state.activeId) li.classList.add('active');
            li.innerHTML = `
                <span class="gt-badge gt-${c.gt || ''}">${c.gt || '?'}</span>
                <div>
                    <div class="cell-line-1">${escapeHtml(c.substrate)} · ${escapeHtml(c.operating_point_label)}</div>
                    <div class="cell-line-2">ẋ=${escapeHtml(c.xdot_kind)} · n=${c.n_realizations || '?'}</div>
                </div>
            `;
            li.addEventListener('click', () => selectCell(c.task_id));
            els.cellList.appendChild(li);
        }
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c =>
            ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // ── Cell selection + plot ──────────────────────────────────────────

    function selectCell(taskId) {
        state.activeId = taskId;
        location.hash = encodeURIComponent(taskId);
        // re-render list to highlight
        renderCellList();
        // scroll active into view
        const li = els.cellList.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
        if (li) li.scrollIntoView({block: 'nearest'});

        els.cellHeader.innerHTML = '<span class="placeholder">loading…</span>';
        els.plot.innerHTML = '';
        els.cellMeta.innerHTML = '';

        fetch(`/api/view/gfdr/${encodeURIComponent(taskId)}`)
            .then(r => r.json())
            .then(view => {
                renderHeader(view);
                renderMeta(view);
                renderPlot(view);
            }).catch(err => {
                els.cellHeader.textContent = `load failed: ${err}`;
            });
    }

    function renderHeader(view) {
        const gt = view.gt || '?';
        const color = view.regime_overlay.color;
        els.cellHeader.innerHTML = `
            <span class="gt-large" style="background: ${color}">${gt}</span>
            <span class="title">${escapeHtml(view.substrate)} · ${escapeHtml(view.operating_point_label)} · ẋ=${escapeHtml(view.xdot_kind)}</span>
            <span class="subtitle">${view.traces.length} τ-window curves · n_real=${view.n_realizations || '?'}</span>
        `;
    }

    function renderMeta(view) {
        const items = [
            ['substrate', view.substrate],
            ['operating point', view.operating_point_label],
            ['ẋ-kind', view.xdot_kind],
            ['gt regime', view.gt || '—'],
            ['τ_env (analytic)', formatNum(view.tau_env_analytic)],
            ['τ_env method', view.tau_env_method || '—'],
            ['t_w', formatNum(view.schedule.t_w)],
            ['t_obs', formatNum(view.schedule.t_obs)],
            ['n_sample_times', view.schedule.n_sample_times],
            ['n_realizations', view.n_realizations],
        ];
        els.cellMeta.innerHTML = items.map(([k, v]) =>
            `<div><span class="meta-key">${escapeHtml(k)}:</span> <span class="meta-val">${escapeHtml(String(v == null ? '—' : v))}</span></div>`
        ).join('');
    }

    function formatNum(n) {
        if (n == null) return null;
        if (Math.abs(n) >= 1000) return n.toPrecision(4);
        if (Math.abs(n) < 0.01) return n.toExponential(2);
        return Number(n.toPrecision(4)).toString();
    }

    function renderPlot(view) {
        // Color scale: τ_window log-mapped to viridis-ish ramp.
        const tws = view.traces.map(t => t.tau_window);
        const logmin = Math.log10(Math.max(1e-9, Math.min(...tws)));
        const logmax = Math.log10(Math.max(...tws));
        const span = (logmax - logmin) || 1;

        const traces = view.traces.map((t, i) => {
            const frac = (Math.log10(t.tau_window) - logmin) / span;
            const color = viridis(frac);
            // Hover text per point — show (t, dt, τ_window)
            const text = t.x.map((_, j) =>
                `t=${formatNum(t.sample_t[j])} · dt=${formatNum(t.sample_dt[j])}`
                + ` · τ_window=${formatNum(t.tau_window)}`);
            return {
                x: t.x,
                y: t.y,
                mode: 'lines+markers',
                type: 'scatter',
                name: `τ=${formatNum(t.tau_window)}`,
                line: {color, width: 1},
                marker: {color, size: 4},
                text,
                hovertemplate: '%{text}<br>x=%{x:.4g}<br>y=%{y:.4g}<extra></extra>',
                showlegend: false,
            };
        });

        const layout = {
            paper_bgcolor: '#161719',
            plot_bgcolor: '#1f2123',
            font: {family: 'ui-monospace, monospace', color: '#e6e7e9', size: 11},
            margin: {l: 60, r: 30, t: 20, b: 50},
            xaxis: {
                title: {text: view.axes.x_label},
                gridcolor: '#36383b',
                zerolinecolor: '#36383b',
            },
            yaxis: {
                title: {text: view.axes.y_label},
                gridcolor: '#36383b',
                zerolinecolor: '#36383b',
            },
            shapes: regimeReferenceShapes(view),
            annotations: regimeAnnotations(view),
        };

        Plotly.newPlot(els.plot, traces, layout, {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
    }

    // Reference lines for the gFDR signature classes.
    // r-regime: unit-slope FDR (slope ≈ 1/T-effective). We don't know T_eff
    // without calibration, so we draw a broken line at slope 1 through the
    // data centroid as a visual anchor — labeled "slope 1 (r-FDR)".
    function regimeReferenceShapes(view) {
        const allX = view.traces.flatMap(t => t.x);
        const allY = view.traces.flatMap(t => t.y);
        if (!allX.length) return [];
        const xMin = Math.min(...allX), xMax = Math.max(...allX);
        const yMid = (Math.min(...allY) + Math.max(...allY)) / 2;
        const xMid = (xMin + xMax) / 2;
        // y = (x - xMid) + yMid → slope-1 anchor.
        return [{
            type: 'line',
            xref: 'x', yref: 'y',
            x0: xMin, y0: yMid + (xMin - xMid),
            x1: xMax, y1: yMid + (xMax - xMid),
            line: {color: '#666', width: 1, dash: 'dot'},
        }];
    }

    function regimeAnnotations(view) {
        return [{
            xref: 'paper', yref: 'paper',
            x: 0.99, y: 0.02,
            xanchor: 'right', yanchor: 'bottom',
            text: 'dotted: slope-1 reference (r-regime FDR)',
            showarrow: false,
            font: {color: '#666', size: 10},
        }];
    }

    // Viridis-ish colormap (4 stops).
    function viridis(t) {
        t = Math.max(0, Math.min(1, t));
        const stops = [
            [0.00, [68, 1, 84]],
            [0.33, [59, 82, 139]],
            [0.66, [33, 145, 140]],
            [1.00, [253, 231, 37]],
        ];
        for (let i = 0; i < stops.length - 1; i++) {
            const [t0, c0] = stops[i], [t1, c1] = stops[i+1];
            if (t <= t1) {
                const f = (t - t0) / (t1 - t0 || 1);
                const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
                const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
                const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
                return `rgb(${r},${g},${b})`;
            }
        }
        return 'rgb(253,231,37)';
    }

    // ── Hash navigation ────────────────────────────────────────────────

    window.addEventListener('hashchange', () => {
        const id = decodeURIComponent(location.hash.replace(/^#/, ''));
        if (id && id !== state.activeId) selectCell(id);
    });
})();
