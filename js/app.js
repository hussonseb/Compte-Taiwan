/* Comptes Taiwan - interface. */
(function () {
  'use strict';
  var E = window.FinEngine, P = window.FinPatch, D = window.FinDrive;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- etat ----------
  var state = {
    mode: null, file: null, bytes: null, baseData: null, data: null, res: null,
    ops: loadJSON('fin_ops', []), settings: loadJSON('fin_settings', { offline: true, theme: 'auto' }),
    view: 'dash', sel: null, year: null, txFilter: { q: '', compte: '', cat: '', year: '', pending: false, limit: 80 }, yearCompte: '*', busy: false
  };
  function loadJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- IndexedDB (copie hors-ligne du classeur) ----------
  function idb() {
    return new Promise(function (res, rej) {
      try { var r = indexedDB.open('comptes-taiwan', 1); r.onupgradeneeded = function () { r.result.createObjectStore('kv'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); }
    });
  }
  async function idbOp(mode, fn) { var db = await idb(); return new Promise(function (res, rej) { var tx = db.transaction('kv', mode); var st = tx.objectStore('kv'); var rq = fn(st); tx.oncomplete = function () { res(rq && rq.result); }; tx.onerror = function () { rej(tx.error); }; }); }
  var idbGet = function (k) { return idbOp('readonly', function (s) { return s.get(k); }).catch(function () { return null; }); };
  var idbSet = function (k, v) { return idbOp('readwrite', function (s) { return s.put(v, k); }).catch(function () {}); };
  var idbClear = function () { return idbOp('readwrite', function (s) { return s.clear(); }).catch(function () {}); };

  // ---------- formats ----------
  var nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  var nfc = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  var pf = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
  // ---------- mode confidentialite ----------
  // 'off' | 'blur' (montants floutes) | 'demo' (montants multiplies par un facteur secret, coherents entre eux)
  var privacy = loadJSON('fin_privacy', { mode: 'off', k: 1 });
  function pkPriv() { return privacy.mode === 'demo' ? privacy.k : 1; }
  // affichage en euros (bouton NT$/€) : tous les montants NT$ sont convertis au taux du classeur
  var curEUR = false;
  function fx() { return curEUR && state.data && state.data.rate ? 1 / state.data.rate : 1; }
  function pk() { return pkPriv() * fx(); }
  function sym() { return curEUR ? '€' : 'NT$'; }
  function raw0(v) { if (v == null || isNaN(v)) return '–'; v = v * pkPriv(); if (Math.round(v) === 0) v = 0; return nf0.format(Math.round(v)).replace(/\u202f/g, '\u00a0'); }
  function setPrivacy(mode) {
    privacy = { mode: mode, k: mode === 'demo' ? +(Math.random() < 0.5 ? 0.4 + Math.random() * 0.35 : 1.4 + Math.random() * 1.1).toFixed(4) : 1 };
    saveJSON('fin_privacy', privacy); applyPrivacy(); renderAll();
    toast(mode === 'off' ? 'Montants réels affichés' : mode === 'blur' ? 'Montants floutés' : 'Mode démo : montants fictifs');
  }
  function applyPrivacy() {
    document.body.classList.toggle('priv-blur', privacy.mode === 'blur');
    document.body.classList.toggle('priv-demo', privacy.mode === 'demo');
    var b = $('#btnPriv'); if (b) { b.textContent = privacy.mode === 'off' ? '👁' : privacy.mode === 'blur' ? 'Flou' : 'Démo'; b.classList.toggle('accent', privacy.mode !== 'off'); }
  }
  function n0(v) { if (v != null && !isNaN(v)) { v = v * pk(); if (Math.round(v) === 0) v = 0; } return v == null || isNaN(v) ? '–' : nf0.format(Math.round(v)).replace(/ /g, ' '); }
  function ntd(v) { return n0(v) + '\u00a0' + sym(); }
  function eur(v) { return raw0(v) + '\u00a0€'; } // montant deja en euros : jamais reconverti
  function signed(v) { return (Math.round(v * pk()) > 0 ? '+' : '') + n0(v); }
  function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dstr(serial) { if (serial == null) return ''; var p = E.serialToParts(serial); return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y; }
  function dinput(serial) { if (serial == null) return ''; var p = E.serialToParts(serial); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); }
  function fromInput(v) { if (!v) return null; var a = v.split('-').map(Number); return E.partsToSerial(a[0], a[1], a[2]); }
  function parseAmount(s) { if (s == null) return NaN; s = String(s).replace(/[\s  ]/g, '').replace(',', '.'); return s === '' ? NaN : Number(s); }
  var MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600); }
  function banner(msg, isErr) { var b = $('#banner'); if (!msg) { b.hidden = true; return; } b.innerHTML = msg; b.className = 'banner' + (isErr ? ' err' : ''); b.hidden = false; }

  // ---------- theme ----------
  function applyTheme() { var t = state.settings.theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  // ---------- simulation des modifications non enregistrees ----------
  function clone(d) { return typeof structuredClone === 'function' ? structuredClone(d) : JSON.parse(JSON.stringify(d)); }
  function simulate(base, ops) {
    var d = clone(base);
    ops.forEach(function (op, i) {
      if (op.type === 'addTx') {
        var t = Object.assign({ row: 'new' + i, isNew: true, opIndex: i }, normTx(op.data)); d.tx.unshift(t);
      } else if (op.type === 'editTx' || op.type === 'deleteTx') {
        var r = d.tx.find(function (x) { return x.row === op.row; }); if (!r) return;
        if (op.type === 'deleteTx') { Object.assign(r, normTx({ date: null })); r.deleted = true; }
        else Object.assign(r, normTx(op.data));
        r.opIndex = i; r.edited = true;
      } else if (op.type === 'addInv') {
        d.inv.unshift({ row: 'new' + i, isNew: true, type: op.data.type, date: op.data.date, devise: op.data.devise, montant: +op.data.montant, empty: false });
      } else if (op.type === 'setPlatform') {
        var p = d.platforms.find(function (x) { return x.type === op.name; }); if (p) { p.value = op.value === null || op.value === '' ? null : +op.value; p.devise = op.devise || p.devise; }
      } else if (op.type === 'setFR') { d.fr.value = op.value === null || op.value === '' ? null : +op.value; d.fr.devise = op.devise || d.fr.devise; }
      else if (op.type === 'setRate') { d.rate = +op.value; if (op.date != null) d.rateDate = op.date; }
      else if (op.type === 'addSnapshot' && d.snaps) { d.snaps.rows.push({ row: 'new' + i, isNew: true, date: op.data.date, rate: op.data.rate, assets: op.data.assets }); }
    });
    return E.enrich(d);
  }
  function normTx(x) {
    var t = { date: x.date == null ? null : x.date, compte: x.compte || '', objet: x.objet || '', force: x.force || '', credit: +x.credit || 0, debit: +x.debit || 0, carte: x.carte || '', achat: x.achat == null ? null : x.achat };
    t.empty = t.date === null && !t.compte && !t.objet && !t.force && !t.credit && !t.debit && !t.carte && t.achat === null; return t;
  }
  function recompute() {
    if (!state.baseData) return;
    state.data = simulate(state.baseData, state.ops);
    state.res = E.compute(state.data);
    if (state.year == null) state.year = E.serialToParts(state.res.today).y;
  }
  function setOps(ops) { state.ops = ops; saveJSON('fin_ops', ops); recompute(); renderAll(); }

  // ---------- chargement ----------
  async function loadBytes(bytes, file, mode, opts) {
    opts = opts || {};
    var zip = await JSZip.loadAsync(bytes);
    var loaded = await E.load(zip);
    state.bytes = bytes; state.baseData = loaded.data; state.file = file; state.mode = mode;
    if (loaded.data.warnings.length) banner(loaded.data.warnings.map(esc).join('<br>'));
    if (state.settings.offline && !opts.fromCache) await idbSet('file', { bytes: bytes, file: file, mode: mode, savedAt: Date.now() });
    recompute(); renderAll();
  }
  async function openLocal(f) {
    try {
      var buf = new Uint8Array(await f.arrayBuffer());
      if (state.ops.length && !confirm('Des modifications non enregistrées existent. Les conserver et les appliquer à ce fichier ?')) setOps([]);
      await loadBytes(buf, { name: f.name, local: true, openedAt: Date.now() }, 'local');
      toast('Fichier ouvert : ' + f.name); show('dash');
    } catch (e) { banner('Impossible de lire ce fichier : ' + esc(e.message), true); }
  }
  async function pickDrive() {
    if (!D.configured()) { toast('Google Drive n\'est pas configuré (LISEZMOI.md, étape 2).', 4000); return; }
    try {
      var f = await D.pick(); setBusy(true, 'Téléchargement…');
      var meta = await D.meta(f.id); var buf = new Uint8Array(await D.download(f.id));
      await loadBytes(buf, meta, 'drive'); banner(''); toast('Fichier chargé depuis Drive'); show('dash');
    } catch (e) { banner(esc(e.message), true); } finally { setBusy(false); }
  }
  async function syncDrive(silent) {
    if (state.mode !== 'drive' || !state.file) return;
    try {
      setBusy(true, 'Vérification…');
      var meta = await D.meta(state.file.id);
      if (meta.version === state.file.version && state.bytes) { if (!silent) toast('Déjà à jour'); return; }
      var buf = new Uint8Array(await D.download(state.file.id));
      await loadBytes(buf, meta, 'drive'); banner(''); toast('Nouvelle version chargée depuis Drive');
    } catch (e) { if (!silent) banner(esc(e.message), true); } finally { setBusy(false); }
  }
  function setBusy(b, label) {
    state.busy = b; var s = $('#btnSync');
    if (b) { s.innerHTML = '<span class="spin"></span> ' + esc(label || ''); s.disabled = true; } else { s.textContent = 'Actualiser'; s.disabled = false; }
  }

  // ---------- enregistrement ----------
  async function buildPatched(bytes) {
    var zip = await JSZip.loadAsync(bytes);
    var out = await P.applyOps(zip, state.ops);
    var okCount = out.results.filter(function (r) { return r.ok; }).length;
    var data = okCount ? await out.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }) : bytes;
    return { bytes: data, results: out.results, okCount: okCount };
  }
  function remainingOps(results) {
    return state.ops.map(function (op, i) { var r = results[i]; return r && !r.ok ? Object.assign({}, op, { error: r.error }) : null; }).filter(Boolean);
  }
  function downloadBytes(bytes, name) {
    var blob = new Blob([bytes], { type: D.XLSX_MIME }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function outName() { var n = (state.file && state.file.name) || 'Comptes.xlsx'; return n.replace(/\.xlsx$/i, '') + '.xlsx'; }
  async function saveDrive() {
    if (!state.ops.length) return;
    try {
      setBusy(true, 'Enregistrement…');
      var meta = await D.meta(state.file.id);
      var changed = meta.version !== state.file.version;
      var latest = new Uint8Array(await D.download(state.file.id));
      var r = await buildPatched(latest);
      if (!r.okCount) { setOps(remainingOps(r.results)); banner('Aucune modification n\'a pu être appliquée. Voir le détail dans « modif. ».', true); return; }
      var today = new Date().toISOString().slice(0, 10), kept = loadJSON('fin_kept', {});
      if (kept[state.file.id] !== today && meta.headRevisionId) { try { await D.keepRevision(state.file.id, meta.headRevisionId); kept[state.file.id] = today; saveJSON('fin_kept', kept); } catch (e) {} }
      var newMeta = await D.upload(state.file.id, r.bytes);
      var rest = remainingOps(r.results);
      state.ops = rest; saveJSON('fin_ops', rest);
      await loadBytes(r.bytes, newMeta, 'drive');
      var msg = r.okCount + ' modification(s) enregistrée(s) dans Drive.';
      if (changed) msg += ' Le fichier avait changé sur Drive depuis l\'ouverture : vos modifications ont été appliquées sur la dernière version.';
      if (rest.length) banner(esc(msg) + '<br>' + rest.length + ' modification(s) refusée(s) : ' + rest.map(function (o) { return esc(o.error); }).join(' · '), true);
      else { banner(changed ? esc(msg) : ''); toast(msg, 3500); }
      closeDlg();
    } catch (e) { banner('Enregistrement impossible : ' + esc(e.message) + ' — vos modifications restent sur l\'appareil.', true); }
    finally { setBusy(false); }
  }
  async function saveLocal() {
    try {
      var r = await buildPatched(state.bytes);
      downloadBytes(r.bytes, outName());
      var rest = remainingOps(r.results);
      state.ops = rest; saveJSON('fin_ops', rest);
      await loadBytes(r.bytes, Object.assign({}, state.file, { openedAt: Date.now() }), 'local');
      toast(r.okCount + ' modification(s) intégrée(s) au fichier téléchargé', 3500);
      if (rest.length) banner(rest.length + ' modification(s) refusée(s) : ' + rest.map(function (o) { return esc(o.error); }).join(' · '), true);
      closeDlg();
    } catch (e) { banner('Export impossible : ' + esc(e.message), true); }
  }
  async function downloadCopy() {
    if (!state.bytes) return;
    var r = state.ops.length ? await buildPatched(state.bytes) : { bytes: state.bytes };
    downloadBytes(r.bytes, outName());
  }

  // ---------- rendu general ----------
  var charts = {};
  function chart(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    var el = document.getElementById(id); if (!el || !window.Chart) return;
    charts[id] = new Chart(el, cfg);
  }
  function renderHeader() {
    var has = !!state.baseData;
    $('#fileLabel').textContent = has ? (state.file.name + (state.mode === 'drive' ? ' · Drive' : ' · fichier local')) : 'Aucun fichier';
    $('#btnSync').hidden = state.mode !== 'drive';
    var b = $('#btnChanges'); b.hidden = !state.ops.length; b.textContent = state.ops.length + ' modif.' + (state.ops.some(function (o) { return o.error; }) ? ' ⚠' : '');
    $('#tabs').hidden = !has; $('#fab').hidden = !has || !!state.sel || !(state.view === 'tx' || state.view === 'dash');
  }
  function renderAll() {
    renderHeader();
    if (!state.baseData) { show('setup'); return; }
    var fn = { dash: renderDash, tx: renderTx, year: renderYear, bud: renderBudget, hist: renderHist, inv: renderInv }[state.view];
    if (fn) fn();
  }
  function show(view) {
    if (view !== 'setup' && !state.baseData) view = 'setup';
    state.view = view; if (view !== 'tx') { state.sel = null; var sb = $('#selbar'); if (sb) sb.hidden = true; }
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    if (view === 'setup') { $('#driveNotConfigured').hidden = D.configured(); $('#btnPickDrive').disabled = !D.configured(); renderHeader(); return; }
    renderAll(); window.scrollTo(0, 0);
  }

  // ---------- options de graphiques ----------
  function baseOpts(extra) {
    var ink3 = css('--ink-3'), grid = css('--grid');
    var o = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ' : ' + n0(c.parsed.y != null ? c.parsed.y : c.parsed.x); } } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink3, maxRotation: 0, autoSkipPadding: 8 }, border: { color: grid } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink3, callback: function (v) { return nfc.format(v * pk()); } } }
      }
    };
    return Object.assign(o, extra || {});
  }
  function legend(items) { return '<div class="legend">' + items.map(function (i) { return '<span><i style="background:' + i[1] + '"></i>' + esc(i[0]) + '</span>'; }).join('') + '</div>'; }
  function barDs(label, data, color, stacked) {
    return { label: label, data: data, backgroundColor: color, borderRadius: stacked ? 0 : 4, borderSkipped: 'start', maxBarThickness: 22, borderColor: css('--surface'), borderWidth: stacked ? { top: 2 } : 0 };
  }

  // ---------- Accueil ----------
  function renderDash() {
    var r = state.res, d = state.data, y = state.year, C = d.config;
    var ann = r.annual.find(function (a) { return a.year === y; }) || {};
    var bal = r.balances, comptes = Object.keys(bal);
    var pend = r.pendingRows;
    var ok1 = Math.abs(r.controls.transfersInternal) < 0.5, ok2 = Math.abs(r.controls.ecart) < 0.5;
    var html = '';
    // Controles : uniquement en cas d'anomalie
    if (!ok1 || !ok2) {
      html += '<div class="card alert"><b>⚠ Contrôle de cohérence à vérifier</b><ul>' +
        (!ok1 ? '<li>Transferts internes SCB / Richart / Taishin : <b>' + signed(r.controls.transfersInternal) + '</b> (doit être 0) — un virement n\'a qu\'un seul côté saisi.</li>' : '') +
        (!ok2 ? '<li>Écart avec le total des comptes : <b>' + signed(r.controls.ecart) + '</b> (doit être 0).</li>' : '') + '</ul></div>';
    }
    // 1. Resume
    html += '<div class="grid sum">';
    html += '<div class="card kpi hero"><div class="l">Patrimoine total</div><div class="v">' + ntd(r.netWorthNtd) + '</div><div class="s">' + (curEUR ? raw0(r.netWorthNtd) + '\u00a0NT$' : eur(r.netWorthEur)) + ' · 1 € = ' + nf2.format(r.rate) + ' NT$' + (r.pendingTotal ? '<br>lignes en attente déduites (' + n0(r.pendingTotal) + ')' : '') + '</div></div>';
    html += '<div class="card kpi"><div class="l">P&amp;L placements</div><div class="v ' + cls(r.plNtd) + '">' + signed(r.plNtd) + '</div><div class="s">' + (r.platInvNtd ? pf.format(r.plNtd / r.platInvNtd) : '') + ' sur ' + nfc.format(r.platInvNtd * pk()) + '</div></div>';
    html += '<div class="card kpi"><div class="l">Bilan ' + y + '</div><div class="v ' + cls(ann.bilan) + '">' + signed(ann.bilan || 0) + '</div><div class="s">Épargne ' + n0(ann.epargne) + ' · taux ' + pctOk(ann.tauxEpargneBudget) + '</div></div>';
    html += '<div class="card accts"><table class="t compact"><thead><tr><th>Comptes</th><th class="n">Solde</th><th class="n">Appli</th></tr></thead><tbody>' +
      comptes.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="n">' + n0(bal[c].all) + '</td><td class="n muted">' + n0(bal[c].all - bal[c].pending) + '</td></tr>'; }).join('') +
      '<tr class="total"><td>Total</td><td class="n">' + n0(r.tracked) + '</td><td class="n">' + n0(r.tracked - r.pendingTotal) + '</td></tr></tbody></table>' +
      '<div class="small muted acc-foot">En attente : <b class="' + cls(r.pendingTotal) + '">' + n0(r.pendingTotal) + '</b> · ' + pend.length + ' ligne(s)' + (C.hasCard && r.cb.count ? ' dont CB ' + n0(r.cb.pendingTotal) : '') + '</div></div>';
    html += '</div>';

    // 2. Les deux graphiques
    html += '<div class="grid g2 stack-sm section">';
    html += '<div class="card"><div class="chart-head"><h2>Revenus et dépenses ' + y + '</h2></div>' + legend([['Revenus', css('--s1')], ['Dépenses', css('--s2')]]) + '<div class="chart"><canvas id="cMonthly"></canvas></div><p class="small muted">Hors virements, investissements et business.</p></div>';
    html += '<div class="card"><h2>Dépenses – 12 derniers mois</h2>' + legend([['Loyer + GLF', css('--s1')], ['Vie quot. + fixes', css('--s2')], ['Extras', css('--s3')]]) + '<div class="chart"><canvas id="cRolling"></canvas></div></div>';
    html += '</div>';

    // 3. Carte de credit puis lignes en attente
    html += '<div class="grid g2 stack-sm section">';
    if (C.hasCard && r.cb.count) {
      html += '<div class="card"><div class="chart-head"><h2>Carte de crédit à prélever</h2><span class="small muted"><b>' + n0(-r.cb.pendingTotal) + '</b></span></div><div class="cyclist">' +
        r.cb.cycles.map(function (c, i) {
          var lbl = c.prevu != null ? 'Prélèvement du <b>' + dstr(c.prevu) + '</b>' : 'Sans date d\'achat';
          return '<div class="cyc"><div class="cyc-l">' + lbl + '<div class="small muted">' + c.rows.length + ' ligne(s) · <b>' + n0(c.total) + '</b></div></div><button type="button" class="btn" data-cyc="' + i + '">Rapprocher</button></div>';
        }).join('') + '</div></div>';
    }
    if (pend.length) {
      html += '<div class="card"><div class="chart-head"><h2>Lignes en attente</h2><button class="linkbtn" data-goto-pending>Tout voir (' + pend.length + ')</button></div><ul class="txlist">' +
        pend.slice(0, 4).map(txItem).join('') + '</ul></div>';
    }
    html += '</div>';
    $('#view-dash').innerHTML = html;

    var m = r.monthly(y), mo = baseOpts();
    var lastM = 12; while (lastM > 1 && !m[lastM - 1].revenus && !m[lastM - 1].depenses) lastM--; // pas de mois vides en fin d'annee
    chart('cMonthly', { type: 'bar', data: { labels: MONTHS_SHORT.slice(0, lastM), datasets: [barDs('Revenus', m.slice(0, lastM).map(function (x) { return Math.round(x.revenus); }), css('--s1')), barDs('Dépenses', m.slice(0, lastM).map(function (x) { return Math.round(x.depenses); }), css('--s2'))] }, options: mo });
    var ro = r.rolling, so = baseOpts();
    so.scales.x.stacked = true; so.scales.y.stacked = true;
    so.plugins.tooltip.callbacks.footer = function (items) { var s = 0; items.forEach(function (i) { s += i.parsed.y; }); return 'Total : ' + n0(s); };
    chart('cRolling', { type: 'bar', data: { labels: ro.map(function (x) { return MONTHS_SHORT[x.month - 1] + (x.month === 1 ? ' ' + String(x.year).slice(2) : ''); }), datasets: [barDs('Loyer + GuanLiFei', ro.map(function (x) { return x.loyerGlf; }), css('--s1'), true), barDs('Vie quotidienne + fixes', ro.map(function (x) { return x.vqDf; }), css('--s2'), true), barDs('Extras', ro.map(function (x) { return x.extras; }), css('--s3'), true)] }, options: so });
    bindTxItems($('#view-dash'));
    $$('[data-cyc]').forEach(function (b) { b.onclick = function () { reconcileCycle(r.cb.cycles[+b.dataset.cyc]); }; });
    var gp = $('[data-goto-pending]'); if (gp) gp.onclick = function () { state.txFilter = Object.assign(state.txFilter, { q: '', compte: '', cat: '', year: '', pending: true }); show('tx'); };
  }

  // ---------- Lignes ----------
  function txItem(t) {
    var key = String(t.row);
    var tags = '';
    if (t.pending) tags += '<span class="tag pend">En attente' + (t.prevu != null ? ' → ' + dstr(t.prevu).slice(0, 5) : '') + '</span>';
    if ((t.carte || '').toUpperCase() === 'CB') tags += '<span class="tag cb">CB</span>';
    if (t.isNew) tags += '<span class="tag new">Nouveau</span>'; else if (t.edited) tags += '<span class="tag new">' + (t.deleted ? 'Supprimé' : 'Modifié') + '</span>';
    var op = t.opIndex != null ? state.ops[t.opIndex] : null; if (op && op.error) tags += '<span class="tag err">Refusé</span>';
    if (t.force) tags += '<span class="tag" title="Catégorie forcée">' + esc(t.cat) + ' •</span>'; else tags += '<span class="tag">' + esc(t.cat) + '</span>';
    return '<li data-row="' + esc(key) + '"><span class="o">' + esc(t.objet || '(sans objet)') + '</span><span class="a ' + cls(t.net) + '">' + signed(t.net) + '</span>' +
      '<span class="m">' + (t.date != null ? dstr(t.date) : '—') + ' · ' + esc(t.compte) + ' ' + tags + '</span><span></span></li>';
  }
  function bindTxItems(root) {
    $$('.txlist li[data-row]', root).forEach(function (li) {
      li.onclick = function () {
        if (state.sel && root.id === 'view-tx') { var k = li.dataset.row; if (state.sel.has(k)) state.sel.delete(k); else state.sel.add(k); li.classList.toggle('picked'); renderSelBar(); return; }
        openTxForm(li.dataset.row);
      };
    });
  }
  // ---------- selection multiple et datation groupee ----------
  function next9(offset) { var n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1; if (n.getDate() > 9) m++; m += offset || 0; while (m > 12) { m -= 12; y++; } return E.partsToSerial(y, m, 9); }
  function selRows() { return state.data.tx.filter(function (t) { return state.sel && state.sel.has(String(t.row)) && !t.deleted; }); }
  function reconcileCycle(c) {
    if (privacy.mode !== 'off') return toast('Repassez en montants réels (bouton 👁) pour modifier');
    state.txFilter = Object.assign(state.txFilter, { q: '', compte: '', cat: '', year: '', month: null, pending: true, limit: 500 });
    show('tx');
    state.sel = new Set(c.rows.map(function (t) { return String(t.row); })); renderTx();
    openBulkDate(c.prevu != null ? c.prevu : undefined);
  }
  function renderSelBar() {
    var bar = $('#selbar'); if (!bar) return;
    if (!state.sel) { bar.hidden = true; return; }
    var rows = selRows(), tot = rows.reduce(function (s, t) { return s + t.net; }, 0);
    bar.hidden = false;
    bar.innerHTML = '<span><b>' + rows.length + '</b> sélectionnée(s) · net <b class="' + cls(tot) + '">' + signed(tot) + '</b></span><span class="sb-actions"><button type="button" class="btn" id="sbCancel">Annuler</button><button type="button" class="btn primary" id="sbDate"' + (rows.length ? '' : ' disabled') + '>Dater…</button></span>';
    $('#sbCancel').onclick = function () { state.sel = null; renderTx(); };
    $('#sbDate').onclick = function () { openBulkDate(); };
  }
  function openBulkDate(preset) {
    var rows = selRows(); if (!rows.length) return;
    var a = typeof preset === 'number' ? preset : next9(0), b = typeof preset === 'number' ? next9(0) : next9(1), today = E.todaySerial();
    var chip = function (v, l) { return '<button type="button" class="btn chipd" data-d="' + v + '">' + l + '</button>'; };
    dlg('<h2>Dater ' + rows.length + ' ligne(s)</h2><p class="small muted">Même date de débit pour toutes les lignes sélectionnées (ex. prélèvement de la carte de crédit).</p>' +
      '<div class="chips">' + chip(a, 'Prélèvement CB ' + dstr(a)) + (b !== a ? chip(b, 'Prélèvement CB ' + dstr(b)) : '') + chip(today, 'Aujourd\'hui') + '</div>' +
      '<label class="f"><span>Date</span><input type="date" id="bdDate" value="' + dinput(a) + '"></label>' +
      '<label class="f"><span>Montant débité par la banque (facultatif, pour vérifier)</span><input type="text" inputmode="decimal" id="bdBank" autocomplete="off" placeholder="ex. 42818"></label>' +
      '<div id="bdCheck" class="recon"></div>' +
      '<div class="actions"><button type="button" class="btn" id="bdCancel">Annuler</button><button type="button" class="btn primary" id="bdOk">Appliquer</button></div>', function (f) {
      $$('.chipd', f).forEach(function (c) { c.onclick = function () { $('#bdDate', f).value = dinput(+c.dataset.d); $$('.chipd', f).forEach(function (x) { x.classList.toggle('primary', x === c); }); }; });
      $('#bdCancel', f).onclick = closeDlg;
      var selNet = rows.reduce(function (s, t) { return s + t.debit - t.credit; }, 0);
      var check = function () {
        var bank = parseAmount($('#bdBank', f).value), box = $('#bdCheck', f);
        if (isNaN(bank)) { box.innerHTML = '<span class="muted">Lignes sélectionnées : <b>' + n0(selNet) + '</b> ' + sym() + ' à débiter</span>'; box.className = 'recon'; return; }
        var diff = Math.round((Math.abs(bank) - selNet) * 100) / 100;
        if (diff === 0) { box.className = 'recon ok'; box.innerHTML = '✓ Concorde : lignes ' + n0(selNet) + ' = banque ' + n0(Math.abs(bank)); return; }
        var hint = state.data.tx.filter(function (t) { return t.pending && !t.deleted && Math.abs(t.debit - t.credit - Math.abs(diff)) < 0.5; });
        box.className = 'recon bad';
        box.innerHTML = '✕ Écart : banque ' + n0(Math.abs(bank)) + ' − lignes ' + n0(selNet) + ' = <b>' + signed(diff) + '</b>' +
          (diff > 0 ? '<br><span class="small">La banque a débité plus : ligne oubliée, frais en devise, cotisation… ' : '<br><span class="small">Les lignes dépassent le relevé : une ligne appartient sans doute au cycle suivant, ou un remboursement manque. ') +
          (hint.length ? 'Ligne(s) en attente de ce montant : ' + hint.slice(0, 3).map(function (t) { return esc(t.objet) + ' (' + n0(t.debit - t.credit) + ')' + (state.sel.has(String(t.row)) ? ' — sélectionnée' : ' — non sélectionnée'); }).join(', ') : '') + '</span>';
      };
      $('#bdBank', f).oninput = check; check();
      $('#bdOk', f).onclick = function () {
        var bk = parseAmount($('#bdBank', f).value);
        if (!isNaN(bk) && Math.round((Math.abs(bk) - selNet) * 100) !== 0 && !confirm('Le total ne correspond pas au montant de la banque. Dater quand même ?')) return;
        var d = fromInput($('#bdDate', f).value); if (d == null) return;
        var ops = state.ops.slice();
        rows.forEach(function (t) {
          var data = { date: d, compte: t.compte, objet: t.objet, force: t.force, credit: t.credit, debit: t.debit, carte: t.carte, achat: t.achat };
          if (t.isNew) { ops[t.opIndex] = Object.assign({}, ops[t.opIndex], { data: data }); delete ops[t.opIndex].error; return; }
          var base = state.baseData.tx.find(function (x) { return x.row === t.row; });
          var op = { type: 'editTx', row: t.row, data: data, expect: { date: base.date, objet: base.objet, credit: base.credit, debit: base.debit, compte: base.compte } };
          var i = ops.findIndex(function (o) { return (o.type === 'editTx' || o.type === 'deleteTx') && o.row === t.row; });
          if (i >= 0) ops[i] = op; else ops.push(op);
        });
        state.sel = null; closeDlg(); setOps(ops); toast(rows.length + ' ligne(s) datée(s) au ' + dstr(d) + ' — à enregistrer', 3500);
      };
    });
  }
  function filteredTx() {
    var f = state.txFilter, q = f.q.trim().toLowerCase();
    return state.data.tx.filter(function (t) {
      if (t.empty && !t.deleted) return false;
      if (t.deleted) return !f.pending;
      if (f.pending === true && !t.pending) return false;
      if (f.pending === 'done' && t.pending) return false;
      if (f.compte && t.compte !== f.compte) return false;
      if (f.cat && t.cat !== f.cat) return false;
      if (f.year && String(t.year) !== f.year) return false;
      if (f.month && t.month !== f.month) return false;
      if (q && (t.objet + ' ' + t.cat + ' ' + n0(t.net) + ' ' + Math.abs(t.net)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(function (t, i) { return [t, i]; }).sort(function (A, B) {
      // nouvelles lignes non enregistrees, puis en attente (achat le plus recent), puis par date decroissante
      var a = A[0], b = B[0], ga = a.isNew ? 0 : a.date == null ? 1 : 2, gb = b.isNew ? 0 : b.date == null ? 1 : 2;
      if (ga !== gb) return ga - gb;
      if (ga === 1) return (b.achat || 0) - (a.achat || 0) || A[1] - B[1];
      if (ga === 2) return b.date - a.date || A[1] - B[1];
      return A[1] - B[1];
    }).map(function (x) { return x[0]; });
  }
  function renderTx() {
    var d = state.data, f = state.txFilter, C = d.config;
    var cats = C.categories.slice(); if (cats.indexOf('Transfert') < 0) cats.push('Transfert');
    var years = state.res.years.slice().reverse();
    var opt = function (v, l, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var html = '<div class="toolbar"><input class="grow" type="search" id="txq" placeholder="Rechercher (objet, montant…)" value="' + esc(f.q) + '">' +
      '<select id="txc">' + opt('', 'Tous comptes', !f.compte) + C.comptes.map(function (c) { return opt(c, c, f.compte === c); }).join('') + '</select>' +
      '<select id="txk">' + opt('', 'Toutes catégories', !f.cat) + cats.map(function (c) { return opt(c, c, f.cat === c); }).join('') + '</select>' +
      '<select id="txy">' + opt('', 'Toutes années', !f.year) + years.map(function (y) { return opt(String(y), String(y), f.year === String(y)); }).join('') + '</select>' +
      '<select id="txp">' + opt('', 'Tous statuts', !f.pending) + opt('pend', 'En attente', f.pending === true) + opt('done', 'Débitées (datées)', f.pending === 'done') + '</select></div>';
    var rows = filteredTx(), tot = rows.reduce(function (s, t) { return s + (t.deleted ? 0 : t.net); }, 0);
    if (f.month) html += '<p class="small muted">Filtre mois : ' + MONTHS_SHORT[f.month - 1] + ' <button class="linkbtn" id="txclrm">retirer</button></p>';
    html += '<div class="card"><div class="chart-head"><h2>' + rows.length + ' ligne(s)</h2><span class="small muted">Net : <b class="' + cls(tot) + '">' + signed(tot) + '</b> · ' +
      (state.sel ? '<button class="linkbtn" id="txall">Tout sélectionner</button>' : '<button class="linkbtn" id="txsel">Sélectionner</button>') + '</span></div>';
    html += rows.length ? '<ul class="txlist' + (state.sel ? ' selecting' : '') + '">' + rows.slice(0, f.limit).map(function (t) { var h = txItem(t); return state.sel && state.sel.has(String(t.row)) ? h.replace('<li ', '<li class="picked" ') : h; }).join('') + '</ul>' : '<div class="empty">Aucune ligne.</div>';
    if (rows.length > f.limit) html += '<button class="btn more" id="txmore">Afficher plus (' + (rows.length - f.limit) + ')</button>';
    html += '</div>';
    $('#view-tx').innerHTML = html;
    var upd = function (k, v) { f[k] = v; f.limit = 80; renderTx(); };
    var qi = $('#txq'); qi.oninput = function () { f.q = qi.value; f.limit = 80; clearTimeout(qi._t); qi._t = setTimeout(function () { var pos = qi.selectionStart; renderTx(); var n = $('#txq'); n.focus(); n.setSelectionRange(pos, pos); }, 200); };
    $('#txc').onchange = function (e) { upd('compte', e.target.value); };
    $('#txk').onchange = function (e) { upd('cat', e.target.value); };
    $('#txy').onchange = function (e) { upd('year', e.target.value); };
    $('#txp').onchange = function (e) { upd('pending', e.target.value === 'pend' ? true : e.target.value === 'done' ? 'done' : false); };
    var cm = $('#txclrm'); if (cm) cm.onclick = function () { upd('month', null); };
    var mo = $('#txmore'); if (mo) mo.onclick = function () { f.limit += 200; renderTx(); };
    bindTxItems($('#view-tx'));
    var ts = $('#txsel'); if (ts) ts.onclick = function () { if (privacy.mode !== 'off') return toast('Repassez en montants réels (bouton 👁) pour modifier'); state.sel = new Set(); if (!f.pending && state.res.pendingRows.length) { f.pending = true; } renderTx(); };
    var ta = $('#txall'); if (ta) ta.onclick = function () { rows.slice(0, f.limit).forEach(function (t) { if (!t.deleted) state.sel.add(String(t.row)); }); renderTx(); };
    renderSelBar(); renderHeader();
  }

  // ---------- formulaire ligne ----------
  function dlg(html, onReady) { var f = $('#dlgForm'); f.innerHTML = html; var d = $('#dlg'); if (!d.open) d.showModal(); if (onReady) onReady(f); }
  function closeDlg() { var d = $('#dlg'); if (d.open) d.close(); }
  function objetSuggestions() {
    var cnt = new Map(); state.data.tx.slice(0, 900).forEach(function (t) { if (t.objet) cnt.set(t.objet, (cnt.get(t.objet) || 0) + 1); });
    return Array.from(cnt.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 300).map(function (e) { return e[0]; });
  }
  function openTxForm(rowKey, opts) {
    opts = opts || {};
    if (privacy.mode !== 'off') { toast('Repassez en montants réels (bouton 👁) pour saisir ou modifier'); return; }
    var d = state.data, C = d.config, isNewForm = rowKey == null;
    var t = isNewForm ? null : d.tx.find(function (x) { return String(x.row) === String(rowKey); });
    if (!isNewForm && !t) return;
    var isNewRow = t && t.isNew;
    var v = t ? { date: t.date, compte: t.compte, objet: t.objet, force: t.force, credit: t.credit, debit: t.debit, carte: t.carte || '', achat: t.achat } : { date: E.todaySerial(), compte: loadJSON('fin_lastCompte', C.comptes[0] || ''), objet: '', force: '', credit: 0, debit: 0, carte: '', achat: null };
    var isCB = (v.carte || '').toUpperCase() === 'CB';
    if (opts.setDate && v.date == null) v.date = E.todaySerial();
    var isCredit = v.credit > 0 && !v.debit;
    var amount = isCredit ? v.credit : v.debit;
    var cats = C.categories.slice(); if (cats.indexOf('Transfert') < 0) cats.push('Transfert');
    var html = '<h2>' + (isNewForm ? 'Nouvelle ligne' : (t.pending ? 'Ligne en attente' : 'Modifier la ligne')) + '</h2>' +
      '<div class="f"><div class="seg" id="fSens"><button type="button" data-v="debit"' + (!isCredit ? ' class="on"' : '') + '>Dépense (débit)</button><button type="button" data-v="credit"' + (isCredit ? ' class="on"' : '') + '>Revenu (crédit)</button></div></div>' +
      '<label class="f amount"><span>Montant (NT$)</span><input id="fAmt" type="text" inputmode="decimal" autocomplete="off" value="' + (amount ? esc(String(amount)) : '') + '" placeholder="0"></label>' +
      '<label class="f"><span>Objet</span><input id="fObj" type="text" list="objList" autocomplete="off" value="' + esc(v.objet) + '" placeholder="ex. 7-Eleven, Loyer…"><datalist id="objList">' + objetSuggestions().map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist></label>' +
      '<div class="f"><span>Compte</span><div class="seg" id="fCpt">' + C.comptes.map(function (c) { return '<button type="button" data-v="' + esc(c) + '"' + (v.compte === c ? ' class="on"' : '') + '>' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '<div class="row2"><label class="f"><span>Date</span><input id="fDate" type="date" value="' + dinput(v.date) + '"' + (v.date == null ? ' disabled' : '') + '></label>' +
      '<label class="f"><span>Catégorie</span><select id="fCat"><option value="">Automatique</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (v.force === c ? ' selected' : '') + '>Forcer : ' + esc(c) + '</option>'; }).join('') + '</select></label></div>' +
      (C.hasCard ? '<div class="cbbox"><label class="check" style="margin-top:0"><input type="checkbox" id="fCB"' + (isCB ? ' checked' : '') + '> <b>Carte de crédit (CB)</b></label>' +
        '<div id="fCBx"' + (isCB ? '' : ' hidden') + '><label class="f" style="margin:8px 0 4px"><span>Date d\'achat</span><input type="date" id="fAchat" value="' + dinput(v.achat) + '"></label><div class="hint" id="fPrev"></div></div></div>' : '') +
      '<label class="check"><input type="checkbox" id="fPend"' + (v.date == null ? ' checked' : '') + '> Pas encore débité (en attente, sans date)</label>' +
      '<div class="hint" id="fCatHint"></div><div class="err-msg" id="fErr"></div>' +
      '<div class="actions">' + (!isNewForm ? '<button type="button" class="btn danger" id="fDel">' + (isNewRow ? 'Retirer' : 'Supprimer') + '</button>' : '') + '<button type="button" class="btn" id="fCancel">Annuler</button><button type="button" class="btn primary" id="fOk">' + (isNewForm ? 'Ajouter' : 'Valider') + '</button></div>';
    dlg(html, function (f) {
      var sens = isCredit ? 'credit' : 'debit', compte = v.compte;
      $$('#fSens button', f).forEach(function (b) { b.onclick = function () { sens = b.dataset.v; $$('#fSens button', f).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
      $$('#fCpt button', f).forEach(function (b) { b.onclick = function () { compte = b.dataset.v; $$('#fCpt button', f).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
      var pend = $('#fPend', f), date = $('#fDate', f);
      pend.onchange = function () { date.disabled = pend.checked; if (!pend.checked && !date.value) date.value = dinput(E.todaySerial()); };
      var cbx = $('#fCB', f);
      var prevHint = function () {
        if (!cbx) return; var ach = fromInput($('#fAchat', f).value);
        var pv = cbx.checked && ach != null ? E.prevu({ carte: 'CB', achat: ach }, C) : null;
        $('#fPrev', f).textContent = pv ? 'Prélèvement prévu le ' + dstr(pv) + (pend.checked ? ' — la ligne reste « en attente » jusque-là.' : '') : (cbx.checked ? 'Indiquez la date d\'achat pour calculer le prélèvement.' : '');
      };
      if (cbx) {
        cbx.onchange = function () {
          $('#fCBx', f).hidden = !cbx.checked;
          if (cbx.checked) { if (!$('#fAchat', f).value) $('#fAchat', f).value = date.value || dinput(E.todaySerial()); if (isNewForm || v.date == null) { pend.checked = true; date.disabled = true; } }
          prevHint();
        };
        $('#fAchat', f).onchange = prevHint; pend.addEventListener('change', prevHint); prevHint();
      }
      var hint = function () {
        var force = $('#fCat', f).value, obj = $('#fObj', f).value;
        if (force) { $('#fCatHint', f).textContent = 'Catégorie forcée : ' + force + '. Cet objet sera appris pour les prochaines fois.'; return; }
        var c = E.categorize({ objet: obj, force: '' }, d.rules, d.learned);
        var why = c.src === 'rule' ? ' (mot-clé « ' + c.rule.keyword + ' »)' : c.src === 'learned' ? ' (objet appris)' : ' (par défaut)';
        $('#fCatHint', f).textContent = obj ? 'Catégorie automatique : ' + c.cat + why : '';
      };
      $('#fObj', f).oninput = hint; $('#fCat', f).onchange = hint; hint();
      $('#fCancel', f).onclick = closeDlg;
      if (!isNewForm) $('#fDel', f).onclick = function () {
        if (isNewRow) { var ops = state.ops.slice(); ops.splice(t.opIndex, 1); setOps(ops); closeDlg(); toast('Ligne retirée'); return; }
        if (!confirm('Supprimer cette ligne du classeur ? (les cellules de saisie seront vidées)')) return;
        upsertBaseOp(t, { type: 'deleteTx' }); closeDlg(); toast('Suppression prête à être enregistrée');
      };
      $('#fOk', f).onclick = function () {
        var amt = parseAmount($('#fAmt', f).value), obj = $('#fObj', f).value.trim();
        var err = !(amt > 0) ? 'Montant invalide.' : !obj ? 'Objet obligatoire.' : !compte ? 'Choisissez un compte.' : (!pend.checked && !date.value) ? 'Date obligatoire (ou cochez « en attente »).' : '';
        if (err) { $('#fErr', f).textContent = err; return; }
        var cbOn = cbx ? cbx.checked : isCB;
        var data = { date: pend.checked ? null : fromInput(date.value), compte: compte, objet: obj, force: $('#fCat', f).value, credit: sens === 'credit' ? amt : 0, debit: sens === 'debit' ? amt : 0,
          carte: cbOn ? 'CB' : '', achat: cbOn && cbx ? fromInput($('#fAchat', f).value) : (cbOn ? v.achat : null) };
        saveJSON('fin_lastCompte', compte);
        if (isNewForm) { setOps(state.ops.concat([{ type: 'addTx', data: data }])); toast('Ligne ajoutée — à enregistrer'); }
        else if (isNewRow) { var ops = state.ops.slice(); ops[t.opIndex] = Object.assign({}, ops[t.opIndex], { data: data }); delete ops[t.opIndex].error; setOps(ops); toast('Ligne mise à jour'); }
        else { upsertBaseOp(t, { type: 'editTx', data: data }); toast('Modification prête à être enregistrée'); }
        closeDlg();
      };
      setTimeout(function () { var el = opts.setDate ? date : (isNewForm ? $('#fAmt', f) : null); if (el) el.focus(); }, 50);
    });
  }
  function upsertBaseOp(t, op) {
    var base = state.baseData.tx.find(function (x) { return x.row === t.row; });
    op.row = t.row;
    op.expect = { date: base.date, objet: base.objet, credit: base.credit, debit: base.debit, compte: base.compte };
    var ops = state.ops.slice(), i = ops.findIndex(function (o) { return (o.type === 'editTx' || o.type === 'deleteTx') && o.row === t.row; });
    if (i >= 0) ops[i] = op; else ops.push(op);
    setOps(ops);
  }

  // ---------- Annee ----------
  function renderYear() {
    var r = state.res, d = state.data, y = state.year, cpt = state.yearCompte;
    var years = r.years.slice(); var cy = E.serialToParts(r.today).y; if (years.indexOf(cy) < 0) years.push(cy);
    var ys = r.yearSheet(y, cpt), ann = r.annual.find(function (a) { return a.year === y; }) || {};
    var months = d.config.months.length === 12 ? d.config.months : MONTHS_SHORT;
    var html = '<div class="toolbar"><select id="ySel">' + years.slice().reverse().map(function (x) { return '<option' + (x === y ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
      '<div class="seg" id="yCpt">' + ['*'].concat(d.config.comptes).map(function (c) { return '<button type="button" data-v="' + esc(c) + '"' + (cpt === c ? ' class="on"' : '') + '>' + (c === '*' ? 'Tous comptes' : esc(c)) + '</button>'; }).join('') + '</div></div>';
    html += '<div class="grid g4">' +
      kpi('Revenus', ntd(ann.revenus), 'dont retenue estimée ' + n0(ann.retenueEstimee)) +
      kpi('Dépenses', ntd(ann.depenses), 'hors invest. et business') +
      kpi('Bilan (comptes TW)', '<span class="' + cls(ann.bilan) + '">' + signed(ann.bilan || 0) + '</span>', 'Taux d\'épargne ' + (ann.tauxEpargne == null ? '–' : pf.format(ann.tauxEpargne))) +
      kpi('Investissements', ntd(ann.investissements), 'Impôts ' + n0(ann.impots)) + '</div>';
    html += '<div class="card section"><div class="chart-head"><h2>Onglet ' + y + (cpt !== '*' ? ' – ' + esc(cpt) : '') + '</h2><span class="small muted">Touchez un montant pour voir les lignes</span></div><div class="tablewrap only-desk"><table class="t"><thead><tr><th class="sticky">Catégorie</th>' +
      months.map(function (m, i) { return '<th class="n">' + MONTHS_SHORT[i] + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>';
    ys.categories.forEach(function (c, ci) {
      html += '<tr><td class="sticky">' + esc(c) + '</td>';
      ys.matrix[c].forEach(function (x, mi) { var v = ci === 0 ? x.credit - x.debit : x.credit - x.debit; html += '<td class="n ' + (v ? cls(v) : 'zero') + '" data-cat="' + esc(c) + '" data-m="' + (mi + 1) + '" style="cursor:pointer">' + (v ? n0(v) : '·') + '</td>'; });
      html += '<td class="n"><b>' + n0(ys.totals[c]) + '</b></td></tr>';
    });
    var mt = []; for (var i = 0; i < 12; i++) { var s = 0; ys.categories.forEach(function (c) { s += ys.matrix[c][i].credit - ys.matrix[c][i].debit; }); mt.push(s); }
    html += '<tr class="total"><td class="sticky">Bilan</td>' + mt.map(function (v) { return '<td class="n ' + cls(v) + '">' + (v ? n0(v) : '·') + '</td>'; }).join('') + '<td class="n ' + cls(ys.bilan) + '">' + n0(ys.bilan) + '</td></tr>';
    html += '</tbody></table></div>';
    var cyNow = E.serialToParts(r.today);
    var lastData = 0; ys.categories.forEach(function (c) { ys.matrix[c].forEach(function (x, i) { if ((x.credit || x.debit) && i + 1 > lastData) lastData = i + 1; }); });
    var ym = state.yearMonth != null ? state.yearMonth : (lastData || (y === cyNow.y ? cyNow.m : 12));
    html += '<div class="only-phone"><div class="seg-scroll" id="yMon">' + MONTHS_SHORT.map(function (mn, i) { return '<button type="button" data-m="' + (i + 1) + '"' + (ym === i + 1 ? ' class="on"' : '') + '>' + mn + '</button>'; }).join('') + '</div>' +
      '<table class="t compact"><thead><tr><th>Catégorie</th><th class="n">' + MONTHS_SHORT[ym - 1] + '</th><th class="n">Année</th></tr></thead><tbody>' +
      ys.categories.map(function (c) { var x = ys.matrix[c][ym - 1], v = x.credit - x.debit; return '<tr><td>' + esc(c) + '</td><td class="n ' + (v ? cls(v) : 'zero') + '" data-cat="' + esc(c) + '" data-m="' + ym + '">' + (v ? n0(v) : '·') + '</td><td class="n"><b>' + n0(ys.totals[c]) + '</b></td></tr>'; }).join('') +
      '<tr class="total"><td>Bilan</td><td class="n ' + cls(mt[ym - 1]) + '">' + n0(mt[ym - 1]) + '</td><td class="n ' + cls(ys.bilan) + '">' + n0(ys.bilan) + '</td></tr></tbody></table></div>';
    html += '<p class="small muted">Comme les onglets annuels : virements internes exclus ; le total « Salaire » ne compte que les crédits.</p></div>';
    // depenses par categorie
    var spend = {}; d.tx.forEach(function (t) { if (t.year !== y || t.cat === 'Transfert' || !t.debit) return; if (cpt !== '*' && t.compte !== cpt) return; spend[t.cat] = (spend[t.cat] || 0) + t.debit; });
    var sp = Object.keys(spend).map(function (k) { return [k, spend[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    html += '<div class="card section"><h2>Débits par catégorie – ' + y + '</h2><div class="chart" style="height:' + Math.max(160, sp.length * 30 + 40) + 'px"><canvas id="cCat"></canvas></div></div>';
    $('#view-year').innerHTML = html;
    $('#ySel').onchange = function (e) { state.year = +e.target.value; state.yearMonth = null; renderYear(); };
    $$('#yCpt button').forEach(function (b) { b.onclick = function () { state.yearCompte = b.dataset.v; renderYear(); }; });
    $$('#yMon button').forEach(function (b) { b.onclick = function () { state.yearMonth = +b.dataset.m; renderYear(); }; });
    var onb = $('#yMon .on'); if (onb) onb.scrollIntoView({ block: 'nearest', inline: 'center' });
    $$('#view-year td[data-cat]').forEach(function (td) { td.onclick = function () { state.txFilter = { q: '', compte: cpt === '*' ? '' : cpt, cat: td.dataset.cat, year: String(y), month: +td.dataset.m, pending: false, limit: 80 }; show('tx'); }; });
    var o = baseOpts({ indexAxis: 'y' }); o.scales = { x: { grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--ink-3'), callback: function (v) { return nfc.format(v * pk()); } } }, y: { grid: { display: false }, ticks: { color: css('--ink-2') } } };
    o.interaction = { mode: 'nearest', axis: 'y', intersect: false };
    o.plugins.tooltip.callbacks.label = function (c) { return ' ' + n0(c.parsed.x) + ' ' + sym(); };
    chart('cCat', { type: 'bar', data: { labels: sp.map(function (x) { return x[0]; }), datasets: [Object.assign(barDs('Débits', sp.map(function (x) { return x[1]; }), css('--s1')), { borderSkipped: 'start' })] }, options: o });
  }
  function pctOk(v) { return v == null || !isFinite(v) || Math.abs(v) > 1.5 ? '–' : pf.format(v); }
  function nc(v) { return v == null || isNaN(v) ? '–' : nfc.format(v * pk()); }
  function kpi(l, v, s) { return '<div class="card kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }

  // ---------- Historique ----------
  function renderHist() {
    var r = state.res, a = r.annual;
    var html = snapSection(r) + '<div class="grid g2 stack-sm section"><div class="card"><h2>Revenus et dépenses par année</h2>' + legend([['Revenus', css('--s1')], ['Dépenses', css('--s2')]]) + '<div class="chart"><canvas id="cYears"></canvas></div></div>' +
      '<div class="card"><h2>Épargne cumulée (comptes TW)</h2><div class="chart"><canvas id="cCum"></canvas></div></div></div>';
    var types = ['Comptes TW'].concat(r.platforms.map(function (p) { return p.type; })).concat(['Compte FR']);
    var cols = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(css);
    html += '<div class="card section"><h2>Évolution du patrimoine (soldes et montants investis, au 31/12)</h2>' + legend(types.map(function (t, i) { return [t, cols[i % 8]]; })) + '<div class="chart tall"><canvas id="cWealth"></canvas></div><p class="small muted">Montants investis (pas la valeur de marché), comme l\'onglet Analysis. L\'année en cours inclut les lignes en attente et le Compte FR.</p></div>';
    html += '<div class="card section"><h2>Bilan par année</h2><div class="only-phone"><table class="t compact"><thead><tr><th>Année</th><th class="n">Revenus</th><th class="n">Dépenses</th><th class="n">Bilan</th><th class="n">Taux ép.</th></tr></thead><tbody>' +
      a.slice().reverse().map(function (y) { return '<tr class="click" data-y="' + y.year + '"><td><b>' + y.year + '</b></td><td class="n">' + nc(y.revenus) + '</td><td class="n">' + nc(y.depenses) + '</td><td class="n ' + cls(y.bilan) + '">' + nc(y.bilan) + '</td><td class="n">' + pctOk(y.tauxEpargneBudget) + '</td></tr>'; }).join('') + '</tbody></table><p class="small muted">Touchez une année pour le détail. Tableau complet sur grand écran.</p></div><div class="tablewrap only-desk"><table class="t"><thead><tr><th class="sticky">Année</th><th class="n">Revenus</th><th class="n">Dépenses</th><th class="n">Bilan</th><th class="n">Taux d\'épargne</th><th class="n">Épargne</th><th class="n">Taux d\'épargne réel</th><th class="n">Épargne cumulée</th><th class="n">Investissements</th><th class="n">Impôts</th><th class="n">Loyer+GLF</th><th class="n">Vie quot.</th><th class="n">Extras</th><th class="n">Business net</th></tr></thead><tbody>' +
      a.slice().reverse().map(function (y) { return '<tr class="click" data-y="' + y.year + '"><td class="sticky"><b>' + y.year + '</b></td><td class="n">' + n0(y.revenus) + '</td><td class="n">' + n0(y.depenses) + '</td><td class="n ' + cls(y.bilan) + '">' + signed(y.bilan) + '</td><td class="n">' + (y.tauxEpargne == null ? '–' : pf.format(y.tauxEpargne)) + '</td><td class="n ' + cls(y.epargne) + '">' + signed(y.epargne) + '</td><td class="n">' + pctOk(y.tauxEpargneBudget) + '</td><td class="n">' + n0(y.cumul) + '</td><td class="n">' + n0(y.investissements) + '</td><td class="n">' + n0(y.impots) + '</td><td class="n">' + n0(y.loyerGlf) + '</td><td class="n">' + n0(y.vieQuotidienne) + '</td><td class="n">' + n0(y.extras) + '</td><td class="n ' + cls(y.business) + '">' + signed(y.business) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
    html += avgSection(r);
    $('#view-hist').innerHTML = html;
    $$('#view-hist tr[data-y]').forEach(function (tr) { tr.onclick = function () { state.year = +tr.dataset.y; show('year'); }; });
    var labels = a.map(function (y) { return String(y.year); });
    chart('cYears', { type: 'bar', data: { labels: labels, datasets: [barDs('Revenus', a.map(function (y) { return Math.round(y.revenus); }), css('--s1')), barDs('Dépenses', a.map(function (y) { return Math.round(y.depenses); }), css('--s2'))] }, options: baseOpts() });
    var lo = baseOpts();
    chart('cCum', { type: 'line', data: { labels: labels, datasets: [{ label: 'Épargne cumulée', data: a.map(function (y) { return y.cumul; }), borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: css('--surface'), pointBorderWidth: 2, tension: 0 }] }, options: lo });
    var w = r.wealth, wo = baseOpts(); wo.scales.x.stacked = true; wo.scales.y.stacked = true;
    wo.plugins.tooltip.callbacks.footer = function (items) { var s = 0; items.forEach(function (i) { s += i.parsed.y; }); return 'Total : ' + n0(s); };
    var ds = types.map(function (t, i) { return barDs(t, w.map(function (x) { return t === 'Comptes TW' ? x.comptesTW : t === 'Compte FR' ? x.compteFR : (x.byType[t] || 0); }), cols[i % 8], true); });
    chart('cWealth', { type: 'bar', data: { labels: w.map(function (x) { return String(x.year); }), datasets: ds }, options: wo });
    bindSnap(r);
  }
  function snapSection(r) {
    if (!r.snapshots) return '';
    var sn = r.snapshots, live = r.liveSnap, last = sn[sn.length - 1];
    var h = '<div class="card"><div class="chart-head"><h2>Patrimoine à valeur de marché (relevés)</h2><button type="button" class="btn primary" id="btnSnap">+ Enregistrer un relevé</button></div>';
    h += '<div class="grid g4" style="margin-bottom:12px">' + kpi('Aujourd\'hui (live)', n0(live.totalNtd), eur(live.totalEur) + (r.pendingTotal ? '<br>lignes en attente non déduites' : '')) + kpi('Plus-value latente', '<span class="' + cls(live.latent) + '">' + signed(live.latent) + '</span>', 'investi ' + n0(live.invested)) +
      kpi('Dernier relevé', last ? n0(last.totalNtd) : '–', last ? dstr(last.date) : 'aucun') + kpi('Depuis le dernier relevé', last ? '<span class="' + cls(live.totalNtd - last.totalNtd) + '">' + signed(live.totalNtd - last.totalNtd) + '</span>' : '–', '') + '</div>';
    if (sn.length > 1) h += legend([['Patrimoine total', css('--s1')], ['Investi cumulé', css('--s2')]]) + '<div class="chart"><canvas id="cSnap"></canvas></div>';
    else h += '<p class="small muted">Le graphique d\'évolution apparaît à partir de 2 relevés (un par mois suffit).</p>';
    h += '<div class="only-phone section">' + sn.slice().reverse().map(function (x) { return '<div class="li2"><div><b>' + dstr(x.date) + '</b>' + (x.isNew ? ' <span class="tag new">Nouveau</span>' : '') + '<div class="small muted">taux ' + nf2.format(x.rate) + ' · plus-value <span class="' + cls(x.latent) + '">' + signed(x.latent) + '</span></div></div><div class="r"><b class="num">' + n0(x.totalNtd) + '</b><div class="small ' + cls(x.variation) + '">' + signed(x.variation) + '</div></div></div>'; }).join('') + '</div>';
    h += '<div class="tablewrap section only-desk"><table class="t"><thead><tr><th class="sticky">Date</th><th class="n">Taux</th><th class="n">Patrimoine ' + sym() + '</th><th class="n">Patrimoine €</th><th class="n">Comptes TW</th><th class="n">Investi cumulé</th><th class="n">Plus-value</th><th class="n">Variation</th></tr></thead><tbody>' +
      sn.slice().reverse().map(function (x) { return '<tr><td class="sticky">' + dstr(x.date) + (x.isNew ? ' <span class="tag new">Nouveau</span>' : '') + '</td><td class="n">' + nf2.format(x.rate) + '</td><td class="n"><b>' + n0(x.totalNtd) + '</b></td><td class="n">' + raw0(x.totalEur) + '</td><td class="n">' + n0(x.tw) + '</td><td class="n">' + n0(x.invested) + '</td><td class="n ' + cls(x.latent) + '">' + signed(x.latent) + '</td><td class="n ' + cls(x.variation) + '">' + signed(x.variation) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="small muted">Un relevé fige les valeurs du jour (valeurs actuelles des plateformes, Compte FR, taux de change). Mettez d\'abord à jour les valeurs dans « Patrimoine ». Comptes TW = lignes datées uniquement ; Family investment au coût.</p></div>';
    return h;
  }
  function bindSnap(r) {
    var b = $('#btnSnap'); if (!b) return;
    b.onclick = function () {
      if (privacy.mode !== 'off') return toast('Repassez en montants réels (bouton 👁) pour modifier');
      var live = r.liveSnap, last = r.snapshots[r.snapshots.length - 1];
      if (last && last.date > live.date) return toast('Le dernier relevé est daté après aujourd\'hui.');
      if (last && last.date === live.date && !confirm('Un relevé existe déjà aujourd\'hui. En ajouter un autre ?')) return;
      var assets = {}; Object.keys(live.assets).forEach(function (k) { assets[k] = Math.round(live.assets[k] * 100) / 100; });
      setOps(state.ops.concat([{ type: 'addSnapshot', data: { date: live.date, rate: live.rate, assets: assets } }]));
      toast('Relevé ajouté — à enregistrer');
    };
    if (r.snapshots.length > 1) {
      var sn = r.snapshots;
      chart('cSnap', { type: 'line', data: { labels: sn.map(function (x) { return dstr(x.date); }), datasets: [
        { label: 'Patrimoine total', data: sn.map(function (x) { return Math.round(x.totalNtd); }), borderColor: css('--s1'), backgroundColor: css('--s1'), borderWidth: 2, pointRadius: 4, pointBorderColor: css('--surface'), pointBorderWidth: 2 },
        { label: 'Investi cumulé', data: sn.map(function (x) { return Math.round(x.invested); }), borderColor: css('--s2'), backgroundColor: css('--s2'), borderWidth: 2, pointRadius: 4, pointBorderColor: css('--surface'), pointBorderWidth: 2 }] }, options: baseOpts() });
    }
  }


  // Depenses mensuelles moyennes par categorie et par annee (Transactions P42:X56)
  function avgSection(r) {
    var A = r.monthlyAverages(), C = [['rev', 'Revenus (brut)'], ['vq', 'Dépenses quotidiennes'], ['log', 'Logement'], ['ext', 'Extras'], ['inv', 'Investissements'], ['imp', 'Impôts'], ['df', 'Dépenses fixes']];
    var kept = A.years.filter(function (o) { return o.kept; }), excl = A.years.filter(function (o) { return !o.kept; });
    var h = '<div class="card section"><div class="chart-head"><h2>Dépenses mensuelles moyennes par catégorie</h2><span class="small muted">par mois rempli</span></div>';
    // PC : une ligne par annee
    h += '<div class="tablewrap only-desk"><table class="t"><thead><tr><th class="sticky">Année</th>' + C.map(function (c) { return '<th class="n">' + c[1] + '</th>'; }).join('') + '<th class="n">Mois retenus</th></tr></thead><tbody>' +
      kept.slice().reverse().map(function (o) { return '<tr><td class="sticky"><b>' + o.year + '</b></td>' + C.map(function (c) { return '<td class="n">' + n0(o[c[0]]) + '</td>'; }).join('') + '<td class="n">' + o.months + '</td></tr>'; }).join('') +
      '<tr class="total"><td class="sticky">Moyenne</td>' + C.map(function (c) { return '<td class="n">' + n0(A.avg[c[0]]) + '</td>'; }).join('') + '<td class="n">' + A.avg.months + '</td></tr></tbody></table></div>';
    // telephone : une ligne par categorie, une colonne par annee
    var ys = kept.slice(-3);
    h += '<div class="only-phone"><table class="t compact"><thead><tr><th></th>' + ys.map(function (o) { return '<th class="n">' + o.year + '</th>'; }).join('') + '<th class="n">Moy.</th></tr></thead><tbody>' +
      C.map(function (c) { var sh = { rev: 'Revenus', vq: 'Quotidien', log: 'Logement', ext: 'Extras', inv: 'Investis.', imp: 'Impôts', df: 'Dép. fixes' }[c[0]]; return '<tr' + (c[0] === 'rev' ? ' class="total"' : '') + '><td>' + sh + '</td>' + ys.map(function (o) { return '<td class="n">' + nc(o[c[0]]) + '</td>'; }).join('') + '<td class="n"><b>' + nc(A.avg[c[0]]) + '</b></td></tr>'; }).join('') +
      '<tr><td class="muted">Mois</td>' + ys.map(function (o) { return '<td class="n muted">' + o.months + '</td>'; }).join('') + '<td class="n muted">' + A.avg.months + '</td></tr></tbody></table></div>';
    h += '<p class="small muted">Comme le tableau Excel (Transactions, « Dépenses mensuelles moyennes ») : un mois compte s\'il a au moins ' + A.minEntries + ' lignes datées, une année est retenue à partir de ' + A.minMonths + ' mois remplis' +
      (excl.length ? ' (non retenue : ' + excl.map(function (o) { return o.year + ', ' + o.months + ' mois'; }).join(' ; ') + ')' : '') +
      '. Revenus = salaire brut reconstitué + bonus ; Logement = loyer + GuanLiFei ; Impôts = impôts payés + retenue à la source estimée ; lignes en attente exclues.</p></div>';
    return h;
  }

  // ---------- Budget & Prevision ----------
  // Liste budget pour petit ecran : chaque poste = montant, barre, puis lignes libellees (une info par ligne)
  function budList(b, h) {
    var K = { mois: { r: 'E', b: 'D', e: 'F', rl: 'Réel du mois', bl: 'Budget du mois' }, cumul: { r: 'H', b: 'G', e: 'I', rl: 'Réel cumulé', bl: 'Budget cumulé' }, annee: { r: 'M', b: 'N', e: 'O', rl: 'Prévision fin d\'année', bl: 'Budget annuel' } }[h];
    var py = b.year - 1, per = (b.month === 1 ? '' : 'Janv.–') + MONTHS_SHORT[b.month - 1] + ' ' + py;
    var kv = function (k, v) { return '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>'; };
    var item = function (l, o, strong, kind) {
      kind = kind || o.kind;
      var real = o[K.r], bud = o[K.b], ec = o[K.e];
      var pct = bud ? Math.max(0, real / bud) : 0, fav = ec == null ? null : ec >= 0;
      var rows = '';
      rows += kv(K.bl, bud != null ? n0(bud) : '<span class="muted">non budgété</span>');
      if (ec != null) rows += kv('Écart', '<span class="' + cls(ec) + '">' + signed(ec) + '</span>');
      if (h === 'cumul' && o.J != null) rows += kv(per, n0(o.J) + (o.K != null && isFinite(o.K) ? ' <span class="' + cls(kind === 'dep' ? -o.K : o.K) + '">(' + (o.K > 0 ? '+' : '') + pf.format(o.K) + ')</span>' : ''));
      if (h === 'annee') {
        if (o.method) rows += kv('Prévision', o.method === 'Comme N-1' ? 'comme ' + py : n0(o.L) + '/mois (6 mois)');
        if (o.P != null) rows += kv('Année ' + py, n0(o.P));
      }
      return '<div class="bi' + (strong ? ' strong' : '') + '"><div class="bi-h"><span>' + l + '</span><span class="num">' + n0(real) + '</span></div>' +
        (bud ? '<div class="bar' + (fav === false ? ' bad' : '') + '"><i style="width:' + (Math.min(pct, 1) * 100).toFixed(1) + '%"></i></div><div class="bar-l">' + Math.round(pct * 100) + ' % du budget</div>' : '') +
        '<div class="kvs">' + rows + '</div></div>';
    };
    var o = '<div class="only-phone budlist"><div class="bl-head small muted">Gros chiffre = ' + K.rl.toLowerCase() + '. Barre = part du budget. Écart vert = favorable.</div><h3>Revenus</h3>';
    b.lines.filter(function (l) { return l.kind === 'rev'; }).forEach(function (l) { o += item(esc(l.label), l); });
    o += item('Total revenus', b.totalRev, true) + '<h3>Dépenses</h3>';
    b.lines.filter(function (l) { return l.kind === 'dep'; }).forEach(function (l) { o += item(esc(l.label), l); });
    o += item('Total dépenses', b.totalDep, true, 'dep') + '<h3>Épargne</h3>';
    o += item('Épargne (taux ' + pctOk(b.savingsRate[K.r]) + ')', b.savings, true);
    b.lines.filter(function (l) { return l.kind === 'inv'; }).forEach(function (l) { o += item(esc(l.label) + ' (placé)', l); });
    return o + '</div>';
  }
  function renderBudget() {
    var r = state.res, d = state.data;
    if (!d.budget) { $('#view-bud').innerHTML = '<div class="card empty">Pas d\'onglet « Budget & Prevision » dans ce classeur.</div>'; return; }
    var tp0 = E.serialToParts(r.today), cur0 = true;
    var B = state.bud || (state.bud = cur0 ? { year: tp0.y, month: tp0.m, h: 'mois' } : { year: r.lastFullMonth.year, month: r.lastFullMonth.month, h: 'mois' });
    var b = r.budget(B.year, B.month);
    var first = d.tx.filter(function (t) { return t.date != null; }).reduce(function (m, t) { return Math.min(m, t.date); }, Infinity);
    var fp = isFinite(first) ? E.serialToParts(first) : { y: r.lastFullMonth.year, m: r.lastFullMonth.month }, opts = [];
    // le mois en cours est propose (marque « en cours ») des qu'il contient une ligne datee
    var tpn = E.serialToParts(r.today), curHas = true; // le mois en cours est toujours propose
    var yy = curHas ? tpn.y : r.lastFullMonth.year, mm = curHas ? tpn.m : r.lastFullMonth.month;
    while (yy > fp.y || (yy === fp.y && mm >= fp.m)) { opts.push([yy, mm]); mm--; if (mm < 1) { mm = 12; yy--; } }
    var H = { mois: { cols: [['D', 'Budget'], ['E', 'Réel'], ['F', 'Écart']], title: 'Le mois : ' + MONTHS_SHORT[B.month - 1] + ' ' + B.year + (B.year === tp0.y && B.month === tp0.m ? ' (en cours, jour ' + tp0.d + ')' : '') },
      cumul: { cols: [['G', 'Budget cumulé'], ['H', 'Réel cumulé'], ['I', 'Écart'], ['J', 'N-1 même période'], ['K', 'Évol. vs N-1']], title: 'Cumul janvier → ' + MONTHS_SHORT[B.month - 1] + ' ' + B.year },
      annee: { cols: [['L', 'Rythme / mois (6 mois)'], ['M', 'Prévision fin d\'année'], ['N', 'Budget annuel'], ['O', 'Écart prévision'], ['P', 'Réel N-1']], title: 'Année ' + B.year + ' complète (' + b.rest + ' mois restants prévus)' } }[B.h];
    var fmt = function (k, v) { if (v == null) return '<span class="muted">–</span>'; if (k === 'K') return '<span class="' + cls(v) + '">' + (v > 0 ? '+' : '') + pf.format(v) + '</span>'; if ('FIO'.indexOf(k) >= 0) return '<span class="' + cls(v) + '">' + signed(v) + '</span>'; return n0(v); };
    var row = function (lab, o, extra, cl) { return '<tr' + (cl ? ' class="' + cl + '"' : '') + '><td class="sticky">' + lab + (extra || '') + '</td>' + H.cols.map(function (c) { return '<td class="n">' + fmt(c[0], o[c[0]]) + '</td>'; }).join('') + '</tr>'; };
    var mtag = function (l) { return B.h === 'annee' ? ' <span class="tag">' + esc(l.method) + '</span>' : ''; };
    var rows = '';
    b.lines.filter(function (l) { return l.kind === 'rev'; }).forEach(function (l) { rows += row(esc(l.label), l, mtag(l)); });
    rows += row('<b>Total revenus</b>', b.totalRev, '', 'total');
    b.lines.filter(function (l) { return l.kind === 'dep'; }).forEach(function (l) { rows += row(esc(l.label), l, mtag(l)); });
    rows += row('<b>Total dépenses</b>', b.totalDep, '', 'total');
    rows += row('<b>Épargne</b>', b.savings, '', 'total');
    rows += '<tr><td class="sticky">Taux d\'épargne</td>' + H.cols.map(function (c) { var v = b.savingsRate[c[0]]; return '<td class="n">' + pctOk(v) + '</td>'; }).join('') + '</tr>';
    b.lines.filter(function (l) { return l.kind === 'inv'; }).forEach(function (l) { rows += row(esc(l.label) + ' <span class="small muted">(épargne placée)</span>', l, mtag(l)); });
    var sv = b.savings, sr = b.savingsRate;
    var html = '<div class="toolbar"><select id="bMonth">' + opts.map(function (o) { return '<option value="' + o[0] + '-' + o[1] + '"' + (o[0] === B.year && o[1] === B.month ? ' selected' : '') + '>' + MONTHS_SHORT[o[1] - 1] + ' ' + o[0] + (o[0] === tpn.y && o[1] === tpn.m ? ' (en cours)' : '') + '</option>'; }).join('') + '</select>' +
      '<div class="seg" id="bH">' + [['mois', 'Mois'], ['cumul', 'Cumul'], ['annee', 'Année']].map(function (x) { return '<button type="button" data-v="' + x[0] + '"' + (B.h === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div></div>';
    html += '<div class="grid g4">' +
      kpi('Épargne du mois', '<span class="' + cls(sv.E) + '">' + signed(sv.E) + '</span>', 'budget ' + n0(sv.D) + ' · taux ' + pctOk(sr.E)) +
      kpi('Épargne cumulée ' + B.year, '<span class="' + cls(sv.H) + '">' + signed(sv.H) + '</span>', 'budget ' + n0(sv.G) + ' · écart ' + signed(sv.I)) +
      kpi('Prévision épargne ' + B.year, '<span class="' + cls(sv.M) + '">' + signed(sv.M) + '</span>', 'budget ' + n0(sv.N) + ' · taux ' + pctOk(sr.M)) +
      kpi('Dépenses prévues ' + B.year, ntd(b.totalDep.M), 'budget ' + n0(b.totalDep.N) + ' · écart ' + signed(b.totalDep.O)) + '</div>';
    html += '<div class="card section"><div class="chart-head"><h2>' + H.title + '</h2><span class="small muted only-desk">Écart positif = favorable</span></div><div class="tablewrap only-desk"><table class="t"><thead><tr><th class="sticky">Poste</th>' + H.cols.map(function (c) { return '<th class="n">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + budList(b, B.h) +
      '<p class="small muted">Budgets issus de l\'onglet Situations. Bonus : budget annuel placé en ' + MONTHS_SHORT[(d.config.bonusMonth || 1) - 1] + ' (versé en une fois). Impôts : régularisation N-1 budgétée en ' + MONTHS_SHORT[(d.config.taxMonth || 6) - 1] + '. Retenue à la source estimée sur le salaire (déjà déduite du net) : ' + n0((b.withholdingInfo[{ mois: 'E', cumul: 'H', annee: 'M' }[B.h]]) || 0) + ' ' + sym() + '.</p></div>';
    html += '<div class="card section"><h2>Épargne : budget vs réel / prévision</h2>' + legend([['Budget', css('--s1')], ['Réel / prévision', css('--s2')]]) + '<div class="chart"><canvas id="cBud"></canvas></div></div>';
    $('#view-bud').innerHTML = html;
    $('#bMonth').onchange = function (e) { var p = e.target.value.split('-'); B.year = +p[0]; B.month = +p[1]; renderBudget(); };
    $$('#bH button').forEach(function (x) { x.onclick = function () { B.h = x.dataset.v; renderBudget(); }; });
    chart('cBud', { type: 'bar', data: { labels: ['Mois', 'Cumul ' + B.year, 'Année (prév.)'], datasets: [barDs('Budget', [sv.D, sv.G, sv.N].map(Math.round), css('--s1')), barDs('Réel / prévision', [sv.E, sv.H, sv.M].map(Math.round), css('--s2'))] }, options: baseOpts() });
  }


  // ---------- Patrimoine ----------
  function renderInv() {
    var r = state.res, d = state.data, devs = d.config.devises.length ? d.config.devises : ['NTD', 'EUR'];
    var devSel = function (id, cur) { return '<select id="' + id + '">' + devs.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>'; };
    var html = '<div class="grid g4">' + kpi('Patrimoine total', ntd(r.netWorthNtd), eur(r.netWorthEur)) + kpi('Liquidités', ntd(r.liquidNtd), 'SCB + Richart + Compte FR') +
      kpi('Valeur des placements', ntd(r.platValueNtd), 'Investi ' + n0(r.platInvNtd)) + kpi('P&amp;L', '<span class="' + cls(r.plNtd) + '">' + signed(r.plNtd) + '</span>', r.platInvNtd ? pf.format(r.plNtd / r.platInvNtd) : '') + '</div>';
    html += '<div class="card section"><div class="chart-head"><h2>Plateformes d\'investissement</h2><span class="small muted">Valeur affichée par vos applis</span></div><div class="plats">' +
      r.platforms.map(function (p, i) {
        return '<div class="plat"><div class="pl-n"><b>' + esc(p.type) + '</b>' + (p.status !== 'OK' ? ' <span class="tag pend">À renseigner</span>' : '') + '<div class="small muted">investi ' + n0(p.investedNtd) + '</div></div>' +
          '<div class="pl-in">' + (p.locked ? '<span class="small muted">' + esc(p.note || 'Calculé dans le classeur') + '</span>' : '<div class="inline-edit"><input class="inp" inputmode="decimal" data-plat="' + i + '" value="' + (p.value == null ? '' : esc(String(p.value))) + '" placeholder="vide = investi">' + devSel('pd' + i, p.devise) + '</div>') + '</div>' +
          '<div class="pl-v"><b class="num">' + n0(p.valueNtd) + '</b><div class="small ' + cls(p.plNtd) + '">' + signed(p.plNtd) + (p.plPct == null ? '' : ' (' + pf.format(p.plPct) + ')') + '</div></div></div>';
      }).join('') +
      '<div class="plat total"><div class="pl-n"><b>Total</b><div class="small muted">investi ' + n0(r.platInvNtd) + '</div></div><div class="pl-in"></div><div class="pl-v"><b class="num">' + n0(r.platValueNtd) + '</b><div class="small ' + cls(r.plNtd) + '">' + signed(r.plNtd) + (r.platInvNtd ? ' (' + pf.format(r.plNtd / r.platInvNtd) + ')' : '') + '</div></div></div></div></div>';
    html += '<div class="grid g2 stack-sm section"><div class="card"><h2>Liquidités</h2><table class="t"><tbody>' +
      r.liquid.map(function (l) { return '<tr><td>' + esc(l.name) + (l.manual ? '<div class="inline-edit" style="margin-top:6px"><input class="inp" inputmode="decimal" id="frVal" value="' + (d.fr.value == null ? '' : esc(String(d.fr.value))) + '">' + devSel('frDev', d.fr.devise) + '</div>' : '') + '</td><td class="n">' + n0(l.ntd) + '</td></tr>'; }).join('') +
      '<tr class="total"><td>Total (' + sym() + ')</td><td class="n">' + n0(r.liquidNtd) + '</td></tr></tbody></table><p class="small muted">SCB et Richart sont calculés depuis les lignes ; seul le Compte FR se saisit à la main.</p></div>' +
      '<div class="card"><h2>Taux de change</h2><div class="inline-edit"><span>1 € =</span><input class="inp" id="rateVal" inputmode="decimal" value="' + esc(String(d.rate)) + '"><span>NT$</span></div><p class="small muted">Dernière mise à jour : ' + (d.rateDate ? dstr(d.rateDate) : '–') + '. Source unique du classeur (Transactions!' + d.rateRef.col + d.rateRef.row + ').</p>' +
      '<h3>Hors patrimoine</h3><table class="t"><tbody>' + r.others.map(function (o) { return '<tr><td>' + esc(o.type) + '</td><td class="n">' + ntd(o.investedNtd) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    var mvAll = d.inv.filter(function (x) { return !x.empty; }), mv = mvAll.slice(0, state.mvLimit || 8);
    html += '<div class="card section"><div class="chart-head"><h2>Mouvements d\'investissement</h2><button type="button" class="btn primary" id="btnInvAdd">+ Ajouter</button></div><div class="mvlist">' +
      mv.map(function (x) { var nt = x.devise === 'EUR' ? x.montant * d.rate : x.montant; return '<div class="li2"><div><b>' + esc(x.type) + '</b>' + (x.isNew ? ' <span class="tag new">Nouveau</span>' : '') + '<div class="small muted">' + (x.date != null ? dstr(x.date) : '—') + '</div></div><div class="r"><b class="num ' + cls(x.montant) + '">' + raw0(x.montant) + ' ' + esc(x.devise === 'EUR' ? '€' : 'NT$') + '</b>' + ((x.devise === 'EUR') !== curEUR ? '<div class="small muted">' + n0(nt) + ' ' + sym() + '</div>' : '') + '</div></div>'; }).join('') +
      '</div>' + (mvAll.length > mv.length ? '<button type="button" class="btn more" id="mvMore">Afficher plus (' + (mvAll.length - mv.length) + ')</button>' : '') + '<p class="small muted">Montant négatif = retrait. Les mouvements existants se corrigent dans Excel.</p></div>';
    $('#view-inv').innerHTML = html;

    var upsertSimple = function (match, op) { var ops = state.ops.filter(function (o) { return !match(o); }); ops.push(op); setOps(ops); toast('Modification prête à être enregistrée'); };
    r.platforms.forEach(function (p, i) {
      var inp = $('[data-plat="' + i + '"]'), sel = $('#pd' + i); if (!inp) return;
      var commit = function () {
        var raw = inp.value.trim(), val = raw === '' ? null : parseAmount(raw);
        if (raw !== '' && isNaN(val)) { toast('Valeur invalide'); return; }
        var base = state.baseData.platforms.find(function (x) { return x.type === p.type; });
        if (val === base.value && sel.value === base.devise) { setOps(state.ops.filter(function (o) { return !(o.type === 'setPlatform' && o.name === p.type); })); return; }
        if (val === p.value && sel.value === p.devise) return;
        upsertSimple(function (o) { return o.type === 'setPlatform' && o.name === p.type; }, { type: 'setPlatform', name: p.type, value: val, devise: sel.value });
      };
      inp.onchange = commit; sel.onchange = commit;
    });
    var frC = function () { var raw = $('#frVal').value.trim(), val = raw === '' ? null : parseAmount(raw); if (raw !== '' && isNaN(val)) return toast('Valeur invalide'); if (val === d.fr.value && $('#frDev').value === d.fr.devise) return; upsertSimple(function (o) { return o.type === 'setFR'; }, { type: 'setFR', value: val, devise: $('#frDev').value }); };
    $('#frVal').onchange = frC; $('#frDev').onchange = frC;
    $('#rateVal').onchange = function () { var v = parseAmount($('#rateVal').value); if (!(v > 0)) return toast('Taux invalide'); if (v === d.rate) return; upsertSimple(function (o) { return o.type === 'setRate'; }, { type: 'setRate', value: v, date: E.todaySerial() }); };
    $('#btnInvAdd').onclick = openInvForm;
    var mm = $('#mvMore'); if (mm) mm.onclick = function () { state.mvLimit = (state.mvLimit || 8) + 30; renderInv(); };
  }
  function openInvForm() {
    var C = state.data.config, types = C.invTypes.length ? C.invTypes : state.data.platforms.map(function (p) { return p.type; }), devs = C.devises.length ? C.devises : ['NTD', 'EUR'];
    dlg('<h2>Mouvement d\'investissement</h2>' +
      '<label class="f"><span>Type</span><select id="iType">' + types.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row2"><label class="f"><span>Date</span><input type="date" id="iDate" value="' + dinput(E.todaySerial()) + '"></label><label class="f"><span>Devise</span><select id="iDev">' + devs.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="f amount"><span>Montant (négatif = retrait)</span><input id="iAmt" type="text" inputmode="decimal" autocomplete="off" placeholder="0"></label><div class="err-msg" id="iErr"></div>' +
      '<div class="actions"><button type="button" class="btn" id="iCancel">Annuler</button><button type="button" class="btn primary" id="iOk">Ajouter</button></div>', function (f) {
      $('#iCancel', f).onclick = closeDlg;
      $('#iOk', f).onclick = function () {
        var amt = parseAmount($('#iAmt', f).value); if (isNaN(amt) || amt === 0) { $('#iErr', f).textContent = 'Montant invalide.'; return; }
        setOps(state.ops.concat([{ type: 'addInv', data: { type: $('#iType', f).value, date: fromInput($('#iDate', f).value), devise: $('#iDev', f).value, montant: amt } }]));
        closeDlg(); toast('Mouvement ajouté — à enregistrer');
      };
      setTimeout(function () { $('#iAmt', f).focus(); }, 50);
    });
  }

  // ---------- panneau des modifications ----------
  function describeOp(o) {
    var d = o.data || {};
    if (o.type === 'addTx') return 'Ajout : ' + (d.objet || '') + ' · ' + signed((+d.credit || 0) - (+d.debit || 0)) + ' · ' + (d.compte || '') + ' · ' + (d.date == null ? 'en attente' : dstr(d.date));
    if (o.type === 'editTx') return 'Modification ligne ' + o.row + ' : ' + (d.objet || '') + ' · ' + signed((+d.credit || 0) - (+d.debit || 0)) + ' · ' + (d.date == null ? 'en attente' : dstr(d.date));
    if (o.type === 'deleteTx') return 'Suppression ligne ' + o.row + ' : ' + (o.expect && o.expect.objet || '');
    if (o.type === 'addInv') return 'Investissement : ' + d.type + ' · ' + n0(d.montant) + ' ' + d.devise + ' · ' + dstr(d.date);
    if (o.type === 'setPlatform') return 'Valeur actuelle ' + o.name + ' : ' + (o.value == null ? '(vide)' : n0(o.value) + ' ' + o.devise);
    if (o.type === 'setFR') return 'Compte FR : ' + (o.value == null ? '(vide)' : n0(o.value) + ' ' + o.devise);
    if (o.type === 'addSnapshot') return 'Relevé du patrimoine au ' + dstr(o.data.date) + ' (taux ' + nf2.format(o.data.rate) + ')';
    if (o.type === 'setRate') return 'Taux de change : 1 € = ' + nf2.format(o.value) + ' NT$';
    return o.type;
  }
  function openChanges() {
    var drive = state.mode === 'drive';
    var html = '<h2>Modifications non enregistrées</h2><ul class="txlist opslist">' + state.ops.map(function (o, i) {
      return '<li><span class="o" style="white-space:normal">' + esc(describeOp(o)) + (o.error ? '<br><span class="small neg">' + esc(o.error) + '</span>' : '') + '</span><span class="a"><button type="button" class="linkbtn" data-undo="' + i + '">annuler</button></span></li>';
    }).join('') + '</ul><p class="small muted">' + (drive ? 'L\'enregistrement relit la dernière version sur Drive, y écrit ces lignes, puis remplace le fichier (Drive garde l\'ancienne version dans l\'historique).' : 'Le fichier mis à jour sera téléchargé ; remplacez ensuite l\'ancien fichier.') + ' Excel recalculera tout à l\'ouverture.</p>' +
      '<div class="actions"><button type="button" class="btn" id="cClose">Fermer</button>' + (drive ? '<button type="button" class="btn" id="cCopy">Télécharger une copie</button><button type="button" class="btn primary" id="cSave">Enregistrer sur Drive</button>' : '<button type="button" class="btn primary" id="cSave">Télécharger le fichier mis à jour</button>') + '</div>';
    dlg(html, function (f) {
      $('#cClose', f).onclick = closeDlg;
      $$('[data-undo]', f).forEach(function (b) { b.onclick = function () { var ops = state.ops.slice(); ops.splice(+b.dataset.undo, 1); setOps(ops); if (ops.length) openChanges(); else closeDlg(); }; });
      $('#cSave', f).onclick = function () { $('#cSave', f).disabled = true; $('#cSave', f).innerHTML = '<span class="spin"></span>'; (drive ? saveDrive() : saveLocal()).finally(function () { var b = $('#cSave'); if (b) { b.disabled = false; b.textContent = drive ? 'Enregistrer sur Drive' : 'Télécharger le fichier mis à jour'; } }); };
      var cp = $('#cCopy', f); if (cp) cp.onclick = downloadCopy;
    });
  }

  // ---------- menu ----------
  function openMenu() {
    var m = $('#menu');
    if (!m.hidden) { m.hidden = true; return; }
    var th = state.settings.theme;
    m.innerHTML = (state.baseData ? '<button data-a="download">Télécharger la dernière version (.xlsx)</button>' : '') +
      (D.configured() ? '<button data-a="pick">Choisir un fichier sur Drive…</button>' : '') +
      '<button data-a="local">Ouvrir un fichier de l\'appareil…</button><hr>' +
      '<button data-a="theme">Thème : ' + (th === 'auto' ? 'automatique' : th === 'dark' ? 'sombre' : 'clair') + '</button>' +
      '<button data-a="offline">Copie hors-ligne : ' + (state.settings.offline ? 'activée' : 'désactivée') + '</button><hr>' +
      '<button data-a="logout">Se déconnecter et effacer les données de cet appareil</button>';
    m.hidden = false;
    $$('button', m).forEach(function (b) {
      b.onclick = async function () {
        m.hidden = true; var a = b.dataset.a;
        if (a === 'download') downloadCopy();
        else if (a === 'pick') pickDrive();
        else if (a === 'local') $('#fileInput').click();
        else if (a === 'theme') { state.settings.theme = th === 'auto' ? 'light' : th === 'light' ? 'dark' : 'auto'; saveJSON('fin_settings', state.settings); applyTheme(); renderAll(); }
        else if (a === 'offline') { state.settings.offline = !state.settings.offline; saveJSON('fin_settings', state.settings); if (!state.settings.offline) await idbClear(); else if (state.bytes) await idbSet('file', { bytes: state.bytes, file: state.file, mode: state.mode, savedAt: Date.now() }); toast(state.settings.offline ? 'Copie hors-ligne activée' : 'Copie hors-ligne supprimée de l\'appareil'); }
        else if (a === 'logout') {
          if (state.ops.length && !confirm(state.ops.length + ' modification(s) non enregistrée(s) seront perdues. Continuer ?')) return;
          D.signOut(); await idbClear(); ['fin_ops', 'fin_lastCompte', 'fin_kept'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          state.ops = []; state.baseData = null; state.bytes = null; state.file = null; state.mode = null; banner(''); show('setup'); toast('Déconnecté, données locales effacées');
        }
      };
    });
  }

  // ---------- demarrage ----------
  function bind() {
    $$('#tabs button').forEach(function (b) { b.onclick = function () { show(b.dataset.view); }; });
    $('#btnPickDrive').onclick = pickDrive;
    $('#fileInput').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) openLocal(f); };
    $('#btnSync').onclick = function () { syncDrive(false); };
    $('#btnChanges').onclick = openChanges;
    $('#btnMenu').onclick = openMenu;
    $('#btnCur').onclick = function () { curEUR = !curEUR; var b = $('#btnCur'); b.textContent = curEUR ? '€' : 'NT$'; b.classList.toggle('accent', curEUR); renderAll(); toast(curEUR ? 'Montants affichés en euros (1 € = ' + nf2.format(state.data ? state.data.rate : 0) + ' NT$)' : 'Montants affichés en NT$'); };
    $('#btnPriv').onclick = function () { setPrivacy(privacy.mode === 'off' ? 'blur' : privacy.mode === 'blur' ? 'demo' : 'off'); };
    $('#fab').onclick = function () { openTxForm(null); };
    document.addEventListener('click', function (e) { var m = $('#menu'); if (!m.hidden && !m.contains(e.target) && e.target.id !== 'btnMenu') m.hidden = true; });
    $('#dlg').addEventListener('click', function (e) { if (e.target === $('#dlg')) closeDlg(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.settings.theme === 'auto') renderAll(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && state.mode === 'drive' && D.hasToken() && !state.busy) syncDrive(true); });
    // les lignes en attente : bouton « ajouter la date » via appui long non necessaire, le formulaire s'ouvre au toucher
  }
  async function boot() {
    applyTheme(); bind(); applyPrivacy();
    var cached = state.settings.offline ? await idbGet('file') : null;
    if (cached && cached.bytes) {
      try {
        await loadBytes(cached.bytes, cached.file, cached.mode, { fromCache: true });
        show('dash');
        if (cached.mode === 'drive') { if (D.hasToken()) syncDrive(true); else banner('Copie de l\'appareil du ' + new Date(cached.savedAt).toLocaleString('fr-FR') + '. Touchez « Actualiser » pour vérifier Drive.'); }
      } catch (e) { banner('Copie locale illisible : ' + esc(e.message), true); show('setup'); }
    } else show('setup');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.FinApp = { state: state, openTxForm: openTxForm };
  boot();
})();
