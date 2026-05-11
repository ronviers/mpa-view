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
        viewTabs: document.querySelectorAll('.view-tab'),
        viewHelp: document.getElementById('view-help'),
        singleView: document.getElementById('single-view'),
        stripView: document.getElementById('strip-view'),
        stripHeader: document.getElementById('strip-header'),
        stripGrid: document.getElementById('strip-grid'),
        stripMeta: document.getElementById('strip-meta'),
        xratioView: document.getElementById('xratio-view'),
        xratioHeader: document.getElementById('xratio-header'),
        xratioPlotX: document.getElementById('xratio-plot-X'),
        xratioPlotNf: document.getElementById('xratio-plot-Nf'),
        xratioMeta: document.getElementById('xratio-meta'),
        calibrationView: document.getElementById('calibration-view'),
        calibrationSelect: document.getElementById('calibration-select'),
        calibrationHeaderMeta: document.getElementById('calibration-header-meta'),
        calibrationSteps: document.getElementById('calibration-steps'),
        calibrationStepBody: document.getElementById('calibration-step-body'),
        calibrationMeta: document.getElementById('calibration-meta'),
    };

    const state = {
        cells: [],
        filtered: [],
        activeId: null,
        viewMode: 'single',           // 'single' | 'strip' | 'xratio' | 'calibration'
        stripCache: new Map(),         // task_id -> gFDR view payload
        xratioCache: new Map(),        // task_id -> xratio view payload
        calibrations: [],              // list of CalibrationIndexEntry
        calibrationActiveId: null,
        calibrationCache: new Map(),   // cal_id -> calibration view payload
        calibrationStepId: 'L',
    };

    const VIEW_HELP = {
        single: 'one cell · all 31 τ_obs windows superimposed',
        strip:  'all cells matching the (substrate, ẋ-kind) filter · regime migration in one glance',
        xratio: 'substrate-native data mixed down to canonical X-ratio space · framework reference lines at X=0 (c) and X=1 (r, calibrated)',
        calibration: 'a sealed RFC-C calibration record · step through the substrate-conditional primitives that constitute the canonical reading',
    };

    // ── Boot ───────────────────────────────────────────────────────────

    Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/cells').then(r => r.json()),
        fetch('/api/calibrations').then(r => r.json()),
    ]).then(([health, cellsResp, calResp]) => {
        renderHealth(health);
        state.cells = cellsResp.cells || [];
        state.calibrations = calResp.records || [];
        seedFilters(state.cells);
        seedCalibrationSelect(state.calibrations);
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
        if (state.viewMode === 'strip') renderStrip();
        if (state.viewMode === 'xratio') renderXratio();
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
        };

        Plotly.newPlot(els.plot, traces, layout, {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
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

    // ── View tabs (single / strip) ─────────────────────────────────────

    for (const tab of els.viewTabs) {
        tab.addEventListener('click', () => setViewMode(tab.dataset.view));
    }
    els.viewHelp.textContent = VIEW_HELP[state.viewMode];

    function setViewMode(mode) {
        if (mode === state.viewMode) return;
        state.viewMode = mode;
        for (const tab of els.viewTabs) {
            tab.classList.toggle('active', tab.dataset.view === mode);
        }
        els.singleView.classList.toggle('active', mode === 'single');
        els.stripView.classList.toggle('active', mode === 'strip');
        els.xratioView.classList.toggle('active', mode === 'xratio');
        els.calibrationView.classList.toggle('active', mode === 'calibration');
        els.viewHelp.textContent = VIEW_HELP[mode];
        if (mode === 'strip') renderStrip();
        if (mode === 'xratio') renderXratio();
        if (mode === 'calibration' && state.calibrationActiveId) {
            renderCalibrationStep(state.calibrationStepId);
        }
    }

    // ── Calibration stepper ────────────────────────────────────────────

    function seedCalibrationSelect(records) {
        const sel = els.calibrationSelect;
        sel.innerHTML = '';
        if (records.length === 0) {
            sel.innerHTML = '<option value="">(no calibration records found)</option>';
            els.calibrationHeaderMeta.innerHTML =
                '<span class="placeholder">no sealed RFC-C calibration records on the configured roots. ' +
                'Run an mpa-engine / mpc-glass / mpc-quantum substrate to land one.</span>';
            return;
        }
        sel.innerHTML = '<option value="">(pick a calibration record)</option>';
        for (const r of records) {
            const opt = document.createElement('option');
            opt.value = r.cal_id;
            opt.textContent = `${r.substrate_class} · v${r.profile_version} · ${r.calibration_date}`;
            sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
            if (sel.value) loadCalibration(sel.value);
        });
        // Auto-select first record for first-load visual.
        if (records.length === 1) {
            sel.value = records[0].cal_id;
            loadCalibration(records[0].cal_id);
        }
    }

    function loadCalibration(calId) {
        state.calibrationActiveId = calId;
        const cached = state.calibrationCache.get(calId);
        if (cached) {
            renderCalibrationView(cached);
            return;
        }
        els.calibrationStepBody.innerHTML =
            '<p class="placeholder">loading record&hellip;</p>';
        fetch(`/api/view/calibration/${encodeURIComponent(calId)}`)
            .then(r => r.json())
            .then(view => {
                state.calibrationCache.set(calId, view);
                renderCalibrationView(view);
            })
            .catch(err => {
                els.calibrationStepBody.innerHTML =
                    `<p class="placeholder">load failed: ${escapeHtml(String(err))}</p>`;
            });
    }

    function renderCalibrationView(view) {
        // Header meta.
        const ref = view.driver_profile_ref || {};
        els.calibrationHeaderMeta.innerHTML =
            `<strong>${escapeHtml(ref.substrate_class || '?')}</strong> · ` +
            `profile v${escapeHtml(ref.profile_version || '?')} · ` +
            `sealed ${escapeHtml(view.calibration_date || '?')} · ` +
            `<span class="dim">hash:</span> <code>${escapeHtml((view.substrate_state_hash || '').slice(0, 22))}&hellip;</code>`;

        // Step buttons.
        els.calibrationSteps.innerHTML = '';
        const steps = view.steps || [];
        steps.forEach((step, i) => {
            const btn = document.createElement('button');
            btn.className = 'step-btn';
            if (step.id === state.calibrationStepId) btn.classList.add('active');
            btn.dataset.stepId = step.id;
            btn.textContent = `${i + 1} · ${stepShortLabel(step.id)}`;
            btn.addEventListener('click', () => renderCalibrationStep(step.id));
            els.calibrationSteps.appendChild(btn);
        });

        // Default to current step (or first step if current isn't in this record).
        const stepIds = steps.map(s => s.id);
        if (!stepIds.includes(state.calibrationStepId) && stepIds.length) {
            state.calibrationStepId = stepIds[0];
        }
        renderCalibrationStep(state.calibrationStepId);
    }

    function stepShortLabel(id) {
        const map = {
            'L': 'L',
            'G_0': 'G₀',
            'tau_obs_canonical': 'τ_obs',
            'gamma_AB': 'γ_AB',
            'validation': 'validation',
            'seal': 'seal',
        };
        return map[id] || id;
    }

    function renderCalibrationStep(stepId) {
        state.calibrationStepId = stepId;
        // Update active button.
        const buttons = els.calibrationSteps.querySelectorAll('.step-btn');
        for (const b of buttons) {
            b.classList.toggle('active', b.dataset.stepId === stepId);
        }

        const view = state.calibrationCache.get(state.calibrationActiveId);
        if (!view) return;
        const step = (view.steps || []).find(s => s.id === stepId);
        if (!step) {
            els.calibrationStepBody.innerHTML = '<p class="placeholder">(step not found)</p>';
            return;
        }

        els.calibrationStepBody.innerHTML = renderStepHTML(step);
    }

    function renderStepHTML(step) {
        // Three layouts: measurement step, validation, seal.
        if (step.id === 'validation') return renderValidationStep(step);
        if (step.id === 'seal') return renderSealStep(step);
        if (step.id === 'gamma_AB' && step.vacuous) return renderVacuousGammaStep(step);
        if (step.id === 'gamma_AB') return renderGammaStep(step);
        return renderMeasurementStep(step);
    }

    function renderMeasurementStep(step) {
        const m = step.measurement || {};
        const valueDisplay = m.value != null
            ? `${formatNum(m.value)}${m.uncertainty != null ? ' ± ' + formatNum(m.uncertainty) : ''}`
            : '(no value)';
        const validRangeBit = m.valid_range
            ? `<div class="step-row"><span class="step-key">valid range:</span> <span class="step-val">[${m.valid_range.map(formatNum).join(', ')}]</span></div>`
            : '';
        const retire = step.retirement || {};
        return `
            <article class="step-content">
                <h2 class="step-title">${escapeHtml(step.title)}</h2>
                <p class="step-cdv1">${escapeHtml(step.cdv1_meaning)}</p>

                <div class="step-block">
                    <div class="step-block-label">measurement</div>
                    <div class="step-value">${escapeHtml(valueDisplay)}</div>
                    ${validRangeBit}
                </div>

                <div class="step-block">
                    <div class="step-block-label">SOP reference <span class="dim">(how this primitive was measured)</span></div>
                    <p class="step-sop">${escapeHtml(m.sop_ref || '(no SOP ref)')}</p>
                </div>

                <div class="step-block">
                    <div class="step-block-label">evidence reference <span class="dim">(${escapeHtml(step.required_evidence)})</span></div>
                    <p class="step-evidence"><code>${escapeHtml(m.evidence_ref || '(no evidence)')}</code></p>
                </div>

                ${(retire.drift_max != null || retire.failure_rule) ? `
                <div class="step-block step-block-retire">
                    <div class="step-block-label">retirement trigger</div>
                    ${retire.drift_max != null ? `<div class="step-row"><span class="step-key">drift max:</span> <span class="step-val">${formatNum(retire.drift_max * 100)}%</span></div>` : ''}
                    ${retire.failure_rule ? `<p class="step-retire-rule">${escapeHtml(retire.failure_rule)}</p>` : ''}
                </div>` : ''}
            </article>
        `;
    }

    function renderVacuousGammaStep(step) {
        return `
            <article class="step-content">
                <h2 class="step-title">${escapeHtml(step.title)}</h2>
                <p class="step-cdv1">${escapeHtml(step.cdv1_meaning)}</p>

                <div class="step-block step-block-vacuous">
                    <div class="step-block-label">vacuous</div>
                    <p class="step-sop">${escapeHtml(step.vacuous_note || '')}</p>
                </div>
            </article>
        `;
    }

    function renderGammaStep(step) {
        const rowsHtml = (step.entries || []).map(e => `
            <tr>
                <td><code>${escapeHtml(e.pair)}</code></td>
                <td>${formatNum(e.value)}${e.uncertainty != null ? ' ± ' + formatNum(e.uncertainty) : ''}</td>
                <td>${escapeHtml(e.sop_ref || '—')}</td>
                <td><code>${escapeHtml(e.evidence_ref || '—')}</code></td>
            </tr>
        `).join('');
        return `
            <article class="step-content">
                <h2 class="step-title">${escapeHtml(step.title)}</h2>
                <p class="step-cdv1">${escapeHtml(step.cdv1_meaning)}</p>

                <div class="step-block">
                    <div class="step-block-label">per-pair measurements</div>
                    <table class="step-table">
                        <thead><tr><th>pair</th><th>value ± σ</th><th>SOP</th><th>evidence</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </article>
        `;
    }

    function renderValidationStep(step) {
        const intentRows = (step.intents || []).map(i => {
            const status = !i.applies
                ? '<span class="intent-na">not applicable</span>'
                : i.passed === true
                    ? '<span class="intent-pass">PASS</span>'
                    : i.passed === false
                        ? '<span class="intent-fail">FAIL</span>'
                        : '<span class="intent-unknown">?</span>';
            const metricBit = i.applies
                ? `${formatNum(i.metric_value)} ${i.threshold != null ? '(threshold ' + formatNum(i.threshold) + ')' : ''}`
                : '—';
            return `<tr><td><strong>${i.intent}</strong></td><td>${status}</td><td>${escapeHtml(metricBit)}</td></tr>`;
        }).join('');
        const refDsBit = step.reference_dataset_ref
            ? `<p class="step-sop">reference dataset: <code>${escapeHtml(step.reference_dataset_ref)}</code></p>`
            : '';
        const fwd = step.forward_residuals || {};
        const back = step.backward_residuals || {};
        const note = fwd.note || back.note;
        return `
            <article class="step-content">
                <h2 class="step-title">${escapeHtml(step.title)}</h2>
                <p class="step-cdv1">${escapeHtml(step.cdv1_meaning)}</p>

                <div class="step-block">
                    <div class="step-block-label">round-trip references</div>
                    ${refDsBit}
                    ${note ? `<p class="step-sop dim">${escapeHtml(note)}</p>` : ''}
                </div>

                <div class="step-block">
                    <div class="step-block-label">per-intent metric pass</div>
                    <table class="step-table">
                        <thead><tr><th>intent</th><th>status</th><th>metric (threshold)</th></tr></thead>
                        <tbody>${intentRows}</tbody>
                    </table>
                </div>
            </article>
        `;
    }

    function renderSealStep(step) {
        const supersedesBit = step.supersedes
            ? `<div class="step-row"><span class="step-key">supersedes:</span> <span class="step-val"><code>${escapeHtml(step.supersedes)}</code></span></div>`
            : `<div class="step-row"><span class="step-key">supersedes:</span> <span class="step-val">none (initial record)</span></div>`;
        return `
            <article class="step-content">
                <h2 class="step-title">${escapeHtml(step.title)}</h2>
                <p class="step-cdv1">${escapeHtml(step.cdv1_meaning)}</p>

                <div class="step-block step-block-seal">
                    <div class="step-block-label">seal</div>
                    <div class="step-row"><span class="step-key">authority:</span> <span class="step-val">${escapeHtml(step.calibration_authority || '?')}</span></div>
                    <div class="step-row"><span class="step-key">date:</span> <span class="step-val">${escapeHtml(step.calibration_date || '?')}</span></div>
                    <div class="step-row"><span class="step-key">profile version pinned:</span> <span class="step-val">${escapeHtml(step.profile_version_pinned || '?')}</span></div>
                    <div class="step-row"><span class="step-key">substrate state hash:</span> <span class="step-val step-hash"><code>${escapeHtml(step.substrate_state_hash || '?')}</code></span></div>
                    ${supersedesBit}
                </div>
            </article>
        `;
    }

    // ── Strip view ─────────────────────────────────────────────────────
    //
    // Renders one mini-plot per cell in `state.filtered`, ordered by the
    // substrate's "regime migration parameter" so the operator can read
    // c→s→k→r migration as a single visual sweep.

    function migrationKey(cell) {
        // glass: T (ascending = increasingly relaxed/r-side)
        // quantum: p_base (ascending = increasingly noise-dominated/r-side)
        // brain: scenario order committed→suspended→conflict→reset (c→s→k→r)
        const op = cell.operating_point || {};
        if (cell.substrate === 'glass') return op.T ?? 0;
        if (cell.substrate === 'quantum') return op.p_base ?? 0;
        if (cell.substrate === 'brain') {
            const order = {committed: 0, suspended: 1, conflict: 2, reset: 3};
            return order[op.scenario] ?? 99;
        }
        return 0;
    }

    function renderStrip() {
        const cells = [...state.filtered].sort(
            (a, b) => migrationKey(a) - migrationKey(b)
        );

        // Determine if filters constrain enough to be meaningful.
        const subs = uniq(cells.map(c => c.substrate));
        const xks = uniq(cells.map(c => c.xdot_kind));
        if (subs.length !== 1 || xks.length !== 1) {
            els.stripHeader.innerHTML =
                '<span class="placeholder">strip view needs a single substrate AND a single ẋ-kind picked in the left filters &rarr;</span>';
            els.stripGrid.innerHTML = '';
            els.stripMeta.innerHTML = '';
            return;
        }

        const sub = subs[0], xk = xks[0];
        els.stripHeader.innerHTML = `
            <span class="title">${escapeHtml(sub)} · ẋ=${escapeHtml(xk)}</span>
            <span class="dim"> · ${cells.length} cells, ordered by regime-migration parameter</span>
        `;
        els.stripGrid.innerHTML = '';
        els.stripMeta.innerHTML = `
            <strong>framework signatures (v9 §FDR):</strong>
            <span class="reading-key"><span class="r-c">●</span> c · X_c = lim χ/(C₀−C) → 0 · flat horizontal asymptote</span>
            <span class="reading-key"><span class="r-s">●</span> s · linear segment slope α_s ∈ (0,1) · CK aging ratio</span>
            <span class="reading-key"><span class="r-k">●</span> k_frust · N_f = transient-negative χ fraction · loops / non-monotonic</span>
            <span class="reading-key"><span class="r-r">●</span> r · X_r → 1 · unit-slope linear locus (equilibrium FDR)</span>
            <span class="strip-note">these are framework predictions. whether your data instances them is empirical — disagreements are calibration evidence (RFC-C). axes auto-scaled per cell because the library uses τ_env-anchored time grids of differing absolute scale (LIBRARY_SPEC §"τ_env-anchored sampling"). slopes / X-ratios are not yet computed — strip view shows the raw parametric; an X-ratio derivation view is queued.</span>
        `;

        // Render placeholders first so layout settles, then fill in.
        const placeholders = cells.map(cell => {
            const div = document.createElement('div');
            div.className = 'strip-cell clickable';
            div.dataset.taskId = cell.task_id;
            const gtColor = regimeColor(cell.gt);
            div.innerHTML = `
                <div class="strip-cell-header">
                    <span class="gt-strip" style="background: ${gtColor}">${cell.gt || '?'}</span>
                    <span class="label">${escapeHtml(cell.operating_point_label)}</span>
                    <span class="sub">n=${cell.n_realizations || '?'}</span>
                </div>
                <div class="strip-plot" id="strip-plot-${cssEscape(cell.task_id)}"></div>
            `;
            div.addEventListener('click', () => {
                setViewMode('single');
                selectCell(cell.task_id);
            });
            els.stripGrid.appendChild(div);
            return cell;
        });

        // Per-cell auto-scaling. Shared-axis comparison was attempted in
        // v0.1 but library cells use τ_env-anchored time grids whose
        // absolute scales differ by 100× across operating points (per
        // LIBRARY_SPEC); shared axes squashed below-T_c cells into
        // invisibility. τ_env-rescaling is the right deeper fix; queued.
        Promise.all(placeholders.map(c => fetchStripView(c.task_id)))
            .then(views => {
                for (let i = 0; i < placeholders.length; i++) {
                    renderStripPlot(placeholders[i], views[i], null);
                }
            })
            .catch(err => {
                els.stripGrid.innerHTML =
                    `<div style="padding: 20px; color: var(--dim)">strip load failed: ${escapeHtml(String(err))}</div>`;
            });
    }

    function fetchStripView(taskId) {
        if (state.stripCache.has(taskId)) {
            return Promise.resolve(state.stripCache.get(taskId));
        }
        return fetch(`/api/view/gfdr/${encodeURIComponent(taskId)}`)
            .then(r => r.json())
            .then(v => { state.stripCache.set(taskId, v); return v; });
    }

    function renderStripPlot(cell, view, sharedRange) {
        const targetId = `strip-plot-${cssEscape(cell.task_id)}`;
        const target = document.getElementById(targetId);
        if (!target) return;
        const tws = view.traces.map(t => t.tau_window);
        const logmin = Math.log10(Math.max(1e-9, Math.min(...tws)));
        const logmax = Math.log10(Math.max(...tws));
        const span = (logmax - logmin) || 1;
        const traces = view.traces.map(t => {
            const frac = (Math.log10(t.tau_window) - logmin) / span;
            const color = viridis(frac);
            return {
                x: t.x, y: t.y,
                mode: 'lines', type: 'scatter',
                line: {color, width: 0.8},
                showlegend: false,
                hoverinfo: 'skip',  // strip plots are scan-only; click to drill
            };
        });
        const xaxis = {
            gridcolor: '#36383b', zerolinecolor: '#36383b',
            showticklabels: true, tickfont: {size: 8},
        };
        const yaxis = {
            gridcolor: '#36383b', zerolinecolor: '#36383b',
            showticklabels: true, tickfont: {size: 8},
        };
        if (sharedRange) {
            xaxis.range = sharedRange.x;
            yaxis.range = sharedRange.y;
        }
        const layout = {
            paper_bgcolor: '#1f2123',
            plot_bgcolor: '#1f2123',
            font: {family: 'ui-monospace, monospace', color: '#e6e7e9', size: 9},
            margin: {l: 36, r: 8, t: 6, b: 22},
            xaxis, yaxis,
            showlegend: false,
        };
        Plotly.newPlot(target, traces, layout, {
            displayModeBar: false,
            responsive: true,
            staticPlot: true,
        });
    }

    function regimeColor(gt) {
        return ({c: '#3f88c5', s: '#e6af2e', k: '#a23b72', r: '#a8a8a8'})[gt] || '#555';
    }

    // ── X-ratio · canonical view ───────────────────────────────────────
    //
    // Mixes substrate-native (χ, C) data down to the canonical X-ratio
    // space the framework defines its regime invariants in. RFC-S §1
    // says the canonical representation lives at the RG-flow fixed point
    // at chosen τ_obs; this view does the analog by rescaling τ_window
    // by τ_env (the "LO mix-down") and computing X = χ/(C₀-C) at the
    // asymptotic tail of the parametric per (cell, τ_window).
    //
    // Two stacked panels:
    //   top:    log-Y X vs log(τ_window/τ_env) — handles wide dynamic
    //           range (quantum spans ~3 decades). Reference at X=1.
    //   bottom: linear N_f vs log(τ_window/τ_env) — k_frust signature.
    //
    // Markers: filled circle = asymptote reached; hollow = curving.

    function renderXratio() {
        const cells = [...state.filtered].sort(
            (a, b) => migrationKey(a) - migrationKey(b)
        );
        const subs = uniq(cells.map(c => c.substrate));
        const xks = uniq(cells.map(c => c.xdot_kind));
        if (subs.length !== 1 || xks.length !== 1) {
            els.xratioHeader.innerHTML =
                '<span class="placeholder">X-ratio view needs a single substrate AND a single ẋ-kind picked in the left filters &rarr;</span>';
            els.xratioPlotX.innerHTML = '';
            els.xratioPlotNf.innerHTML = '';
            els.xratioMeta.innerHTML = '';
            return;
        }
        const sub = subs[0], xk = xks[0];
        els.xratioHeader.innerHTML = `
            <span class="title">${escapeHtml(sub)} · ẋ=${escapeHtml(xk)} · canonical (X-ratio)</span>
            <span class="dim"> · ${cells.length} cells, color = gt regime, x-axis = τ_window / τ_env</span>
        `;
        els.xratioMeta.innerHTML = `
            <strong>top:</strong> X = lim χ/(C₀−C) per (cell, τ_window).
            <span style="color: var(--text)">filled markers</span> = asymptote reached;
            <span style="color: var(--dim)">hollow</span> = curving (limit not reached on experiment window).
            <span class="strip-note"><strong>calibration caveat:</strong> X=1 reference is in <em>calibrated</em> units (T-normalized for glass, equivalent for other substrates). Substrate-native χ and C have substrate-specific units; raw X here only matches the framework reference after a calibration record (RFC-C v0.2) supplies the normalization. <strong>Relative migration across cells is informative; absolute identification against framework references is not yet.</strong></span>
            <span class="strip-note"><strong>bottom:</strong> N_f = fraction of (t, dt) samples where χ &lt; 0. The framework's k_frust signature. Stays in [0, 1] without normalization.</span>
        `;

        Promise.all(cells.map(c => fetchXratioView(c.task_id)))
            .then(views => renderXratioPlots(cells, views))
            .catch(err => {
                els.xratioPlotX.innerHTML = `<div style="padding:20px;color:var(--dim)">load failed: ${escapeHtml(String(err))}</div>`;
            });
    }

    function fetchXratioView(taskId) {
        if (state.xratioCache.has(taskId)) {
            return Promise.resolve(state.xratioCache.get(taskId));
        }
        return fetch(`/api/view/xratio/${encodeURIComponent(taskId)}`)
            .then(r => r.json())
            .then(v => { state.xratioCache.set(taskId, v); return v; });
    }

    function renderXratioPlots(cells, views) {
        // Build per-cell traces. Each cell → one trace in X plot, one in N_f plot.
        // Markers: filled if asymptote_status === 'reached', hollow otherwise.
        const tracesX = [];
        const tracesNf = [];
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const view = views[i];
            const color = regimeColor(cell.gt);
            const points = view.points || [];
            // x-axis: τ_window_rescaled if available else τ_window raw
            const xs = points.map(p => p.tau_window_rescaled ?? p.tau_window);
            const Xs = points.map(p => p.X);
            const Nfs = points.map(p => p.N_f);
            const reached = points.map(p => p.asymptote_status === 'reached');
            const hover = points.map(p =>
                `${escapeHtml(cell.task_id)}<br>` +
                `τ_window=${formatNum(p.tau_window)} (rescaled=${formatNum(p.tau_window_rescaled)})<br>` +
                `X=${p.X==null ? 'N/A' : p.X.toExponential(3)}<br>` +
                `N_f=${formatNum(p.N_f)}<br>` +
                `asymptote=${p.asymptote_status}`
            );
            // Split into reached / curving for distinct marker styles.
            const xR = [], yR = [], hR = [], xC = [], yC = [], hC = [];
            const nR = [], nC = [];
            for (let j = 0; j < points.length; j++) {
                if (Xs[j] == null) continue;
                if (reached[j]) {
                    xR.push(xs[j]); yR.push(Xs[j]); hR.push(hover[j]);
                    nR.push(Nfs[j]);
                } else {
                    xC.push(xs[j]); yC.push(Xs[j]); hC.push(hover[j]);
                    nC.push(Nfs[j]);
                }
            }
            // X plot — reached (filled) + curving (hollow); use legendgroup so
            // the cell shows up once in legend.
            const lg = `${cell.operating_point_label} · gt=${cell.gt}`;
            tracesX.push({
                x: xR, y: yR, text: hR, hovertemplate: '%{text}<extra></extra>',
                mode: 'markers+lines', type: 'scatter',
                name: lg, legendgroup: cell.task_id,
                line: {color, width: 1},
                marker: {color, size: 7, symbol: 'circle'},
            });
            tracesX.push({
                x: xC, y: yC, text: hC, hovertemplate: '%{text}<extra></extra>',
                mode: 'markers', type: 'scatter',
                name: lg + ' · curving', legendgroup: cell.task_id, showlegend: false,
                marker: {color, size: 7, symbol: 'circle-open'},
            });
            // N_f plot — same legend group; render all points (no asymptote split).
            tracesNf.push({
                x: xs, y: Nfs,
                text: hover, hovertemplate: '%{text}<extra></extra>',
                mode: 'markers+lines', type: 'scatter',
                name: lg, legendgroup: cell.task_id, showlegend: false,
                line: {color, width: 1},
                marker: {color, size: 6},
            });
        }

        const xAxisTitle = views[0]?.tau_env_eff_source === 'tau_env_analytic'
            ? 'τ_window / τ_env_analytic'
            : 'τ_window / t_obs (fallback)';

        const layoutX = {
            paper_bgcolor: '#1f2123',
            plot_bgcolor: '#1f2123',
            font: {family: 'ui-monospace, monospace', color: '#e6e7e9', size: 11},
            margin: {l: 70, r: 30, t: 24, b: 50},
            xaxis: {
                title: {text: xAxisTitle},
                type: 'log', gridcolor: '#36383b', zerolinecolor: '#36383b',
            },
            yaxis: {
                title: {text: 'X = χ/(C_diag − C) at asymptote'},
                type: 'log', gridcolor: '#36383b', zerolinecolor: '#36383b',
            },
            shapes: [{
                type: 'line', xref: 'paper', yref: 'y',
                x0: 0, x1: 1, y0: 1, y1: 1,
                line: {color: '#e6af2e', width: 1.5, dash: 'dash'},
            }],
            annotations: [{
                xref: 'paper', yref: 'y', x: 0.99, y: 1, xanchor: 'right', yanchor: 'bottom',
                text: 'X=1 · framework r-canonical (calibrated units)',
                showarrow: false, font: {color: '#e6af2e', size: 10},
            }],
            showlegend: true,
            legend: {bgcolor: 'rgba(31,33,35,0.8)', font: {size: 10}},
        };
        const layoutNf = {
            paper_bgcolor: '#1f2123',
            plot_bgcolor: '#1f2123',
            font: {family: 'ui-monospace, monospace', color: '#e6e7e9', size: 11},
            margin: {l: 70, r: 30, t: 24, b: 50},
            xaxis: {
                title: {text: xAxisTitle},
                type: 'log', gridcolor: '#36383b', zerolinecolor: '#36383b',
            },
            yaxis: {
                title: {text: 'N_f = frac(χ < 0) per (t, dt) samples'},
                gridcolor: '#36383b', zerolinecolor: '#36383b',
                range: [0, 0.6],
            },
            showlegend: false,
        };
        Plotly.newPlot(els.xratioPlotX, tracesX, layoutX, {
            displaylogo: false, responsive: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
        Plotly.newPlot(els.xratioPlotNf, tracesNf, layoutNf, {
            displaylogo: false, responsive: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
        // Click to drill (X plot only).
        els.xratioPlotX.on('plotly_click', evt => {
            const pt = evt.points && evt.points[0];
            if (!pt) return;
            // Find matching cell by legendgroup.
            const trace = tracesX[pt.curveNumber];
            const cell = cells.find(c => c.task_id === trace.legendgroup);
            if (cell) {
                setViewMode('single');
                selectCell(cell.task_id);
            }
        });
    }

    function cssEscape(s) {
        // Plain-CSS-id-safe; task_ids contain only [a-zA-Z0-9_.\-=] in practice.
        return String(s).replace(/[^a-zA-Z0-9_-]/g, ch =>
            '_' + ch.charCodeAt(0).toString(16));
    }
})();
