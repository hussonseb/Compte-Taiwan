/* Comptes Taiwan - lecture du classeur et moteur de calcul.
 * Reproduit en JavaScript la logique des formules Excel (categorisation,
 * soldes, controles, onglets annuels, Analysis, Investissements) pour afficher
 * les analyses sans Excel. Ne modifie jamais le fichier : voir patch.js.
 * Fonctionne dans le navigateur (window.FinEngine) et sous Node (tests).
 */
(function (root) {
  'use strict';

  // ---------- utilitaires XML / cellules ----------
  function decodeXml(s) {
    if (s == null) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (m, e) {
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
  }
  function colToNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n; }
  function numToCol(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function parseRef(ref) { var m = /^([A-Z]+)(\d+)$/.exec(ref); return { col: m[1], row: +m[2] }; }
  function parseRange(ref) { var p = ref.split(':'); return { s: parseRef(p[0]), e: parseRef(p[1] || p[0]) }; }

  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var body = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
      var t = '', tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, tm;
      while ((tm = tr.exec(body))) t += tm[1];
      out.push(decodeXml(t));
    }
    return out;
  }

  // Lit toutes les cellules d'une feuille -> Map "A1" -> valeur
  function parseCells(xml, sst) {
    var cells = new Map(); cells.formulas = new Set();
    var re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml))) {
      var attrs = m[2], inner = m[3];
      if (inner == null) continue;
      if (inner.indexOf('<f') !== -1) cells.formulas.add(m[1]);
      var tM = / t="([^"]+)"/.exec(attrs); var t = tM ? tM[1] : 'n';
      var v;
      if (t === 'inlineStr') {
        var parts = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
        v = decodeXml(parts.map(function (p) { return p.replace(/<\/?t[^>]*>/g, ''); }).join(''));
      } else {
        var vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (!vM) { v = (t === 'str') ? '' : null; }
        else {
          var raw = vM[1];
          if (t === 's') v = sst[+raw];
          else if (t === 'str') v = decodeXml(raw);
          else if (t === 'b') v = raw === '1';
          else if (t === 'e') v = { error: raw };
          else v = parseFloat(raw);
        }
      }
      if (v !== null && v !== undefined) cells.set(m[1], v);
    }
    return cells;
  }

  // ---------- ouverture du classeur ----------
  async function openWorkbook(zip) {
    var wbXml = await zip.file('xl/workbook.xml').async('string');
    var relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    var rels = {};
    relsXml.replace(/<Relationship [^>]*>/g, function (r) {
      var id = /Id="([^"]+)"/.exec(r)[1], tg = /Target="([^"]+)"/.exec(r)[1];
      rels[id] = tg.replace(/^\/?xl\//, '').replace(/^\//, '');
      return r;
    });
    var sheets = {};
    wbXml.replace(/<sheet [^>]*>/g, function (s) {
      var name = decodeXml(/name="([^"]+)"/.exec(s)[1]);
      var rid = /r:id="([^"]+)"/.exec(s)[1];
      sheets[name] = 'xl/' + rels[rid];
      return s;
    });
    var sstFile = zip.file('xl/sharedStrings.xml');
    var sst = parseSharedStrings(sstFile ? await sstFile.async('string') : '');
    var tables = {};
    var tableFiles = Object.keys(zip.files).filter(function (p) { return /^xl\/tables\/table\d+\.xml$/.test(p); });
    for (var i = 0; i < tableFiles.length; i++) {
      var tx = await zip.file(tableFiles[i]).async('string');
      var nm = /<table [^>]*\bname="([^"]+)"/.exec(tx)[1];
      var ref = /<table [^>]*\bref="([^"]+)"/.exec(tx)[1];
      var rng = parseRange(ref), cols = {}, ci = 0, sc = colToNum(rng.s.col);
      tx.replace(/<tableColumn [^>]*\bname="([^"]+)"/g, function (a, n) { cols[decodeXml(n).toLowerCase()] = numToCol(sc + ci++); return a; });
      tables[nm] = { path: tableFiles[i], ref: ref, range: rng, cols: cols };
    }
    var names = {};
    wbXml.replace(/<definedName [^>]*\bname="([^"]+)"[^>]*>([^<]*)<\/definedName>/g, function (a, n, v) { names[n] = decodeXml(v); return a; });
    var cache = {};
    async function cells(name) {
      if (!cache[name]) {
        if (!sheets[name]) throw new Error('Onglet introuvable : ' + name);
        cache[name] = parseCells(await zip.file(sheets[name]).async('string'), sst);
      }
      return cache[name];
    }
    return { zip: zip, sheets: sheets, tables: tables, sst: sst, cells: cells, names: names };
  }

  function isBlank(v) { return v === null || v === undefined || v === ''; }
  function str(v) { return isBlank(v) ? '' : (typeof v === 'object' ? '' : String(v)); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // ---------- extraction des donnees ----------
  async function extract(wb) {
    var warnings = [];
    var T = wb.tables.Transactions, R = wb.tables.Rules, I = wb.tables.InvDetail;
    if (!T) throw new Error('Tableau "Transactions" introuvable dans le classeur.');
    var tc = await wb.cells('Transactions');
    // colonnes reperees par leur en-tete (robuste aux deplacements)
    var COL = function (name, fb) { return T.cols[name.toLowerCase()] || fb; };
    var TC = { date: COL('Date', 'A'), compte: COL('Compte', 'B'), objet: COL('Objet', 'C'), force: COL('Force', 'D'), cat: COL('Categorie', 'E'),
      credit: COL('Credit', 'F'), debit: COL('Debit', 'G'), statut: COL('Statut', 'H'), net: COL('Net', 'I'), annee: COL('Annee', 'J'), mois: COL('Mois', 'K'),
      carte: T.cols['carte'] || null, achat: T.cols['date achat'] || null, prevu: T.cols['prelevement prevu'] || null };

    var tx = [];
    for (var r = T.range.s.row + 1; r <= T.range.e.row; r++) {
      var d = tc.get(TC.date + r), da = TC.achat ? tc.get(TC.achat + r) : null;
      var row = {
        row: r,
        date: typeof d === 'number' ? d : null,
        compte: str(tc.get(TC.compte + r)),
        objet: str(tc.get(TC.objet + r)),
        force: str(tc.get(TC.force + r)),
        credit: num(tc.get(TC.credit + r)),
        debit: num(tc.get(TC.debit + r)),
        carte: TC.carte ? str(tc.get(TC.carte + r)) : '',
        achat: typeof da === 'number' ? da : null,
        cachedCat: str(tc.get(TC.cat + r))
      };
      row.empty = row.date === null && !row.compte && !row.objet && !row.force && !row.credit && !row.debit && !row.carte && row.achat === null;
      tx.push(row);
    }

    var rules = [];
    if (R) {
      var rc = await wb.cells('Rules');
      for (var r2 = R.range.s.row + 1; r2 <= R.range.e.row; r2++) {
        var k = str(rc.get('A' + r2)), c = str(rc.get('B' + r2));
        if (k !== '' || c !== '') rules.push({ row: r2, keyword: k, category: c });
      }
    } else warnings.push('Tableau "Rules" introuvable : categorisation par mots-cles desactivee.');

    var cfg = await wb.cells('Config');
    function colList(col) { var out = []; for (var i = 2; i < 200; i++) { var v = cfg.get(col + i); if (isBlank(v)) break; out.push(String(v)); } return out; }
    var config = {
      months: colList('B'),
      categories: colList('D'),
      devises: colList('E'),
      comptes: colList('F'),
      invTypes: colList('H'),
      withholding: num(cfg.get('K2'))
    };

    // taux de change : cellule a droite du libelle « 1 EUR = ... »
    var rateRef = null;
    tc.forEach(function (v, k) { if (!rateRef && typeof v === 'string' && /^1 EUR =/i.test(v)) { var p = /^([A-Z]+)(\d+)$/.exec(k); rateRef = { col: numToCol(colToNum(p[1]) + 1), row: +p[2] }; } });
    if (!rateRef) rateRef = { col: 'N', row: 20 };
    var rate = num(tc.get(rateRef.col + rateRef.row));
    if (!rate) warnings.push('Taux de change introuvable (libelle « 1 EUR = » dans Transactions).');
    var rd = tc.get(rateRef.col + (rateRef.row + 1)), rateDate = typeof rd === 'number' ? rd : null;

    // parametres carte de credit (noms definis), mois de regularisation d'impot
    async function nameVal(n, dflt) {
      var ref = wb.names[n]; if (!ref) return dflt;
      var m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/.exec(ref); if (!m || !wb.sheets[m[1]]) return dflt;
      var v = (await wb.cells(m[1])).get(m[2] + m[3]); return typeof v === 'number' ? v : dflt;
    }
    config.jourCloture = await nameVal('JOUR_CLOTURE', 20);
    config.jourPrelevement = await nameVal('JOUR_PRELEVEMENT', 9);
    config.taxMonth = /regularisation/i.test(str(cfg.get('J5'))) && typeof cfg.get('K5') === 'number' ? cfg.get('K5') : 6;
    config.hasCard = !!TC.carte;

    var ic = await wb.cells('Investissements');
    var platforms = [];
    for (var r3 = 4; r3 < 40; r3++) {
      var a = str(ic.get('A' + r3));
      if (!a || /^TOTAL\s/i.test(a)) break;
      platforms.push({ row: r3, type: a, value: isBlank(ic.get('D' + r3)) ? null : num(ic.get('D' + r3)), devise: str(ic.get('E' + r3)) || 'NTD', start: typeof ic.get('L' + r3) === 'number' ? ic.get('L' + r3) : null,
        locked: ic.formulas.has('D' + r3), note: str(ic.get('K' + r3)) });
    }
    var fr = { row: 14, value: null, devise: 'EUR' };
    for (var r4 = 10; r4 < 30; r4++) {
      if (/compte fr/i.test(str(ic.get('A' + r4)))) { fr.row = r4; fr.value = isBlank(ic.get('B' + r4)) ? null : num(ic.get('B' + r4)); fr.devise = str(ic.get('C' + r4)) || 'EUR'; break; }
    }
    var others = [];
    for (var r5 = 17; r5 < 40; r5++) {
      if (/^OTHERS/i.test(str(ic.get('A' + r5)))) {
        for (var q = r5 + 2; q < r5 + 20; q++) { var t = str(ic.get('A' + q)); if (!t || /^TOTAL\s/i.test(t)) break; others.push(t); }
        break;
      }
    }
    var inv = [];
    if (I) {
      for (var r6 = I.range.s.row + 1; r6 <= I.range.e.row; r6++) {
        var ty = str(ic.get('A' + r6)), bd = ic.get('B' + r6);
        var it = { row: r6, type: ty, date: typeof bd === 'number' ? bd : null, devise: str(ic.get('C' + r6)), montant: num(ic.get('D' + r6)) };
        it.empty = !ty && it.date === null && !it.montant;
        inv.push(it);
      }
    }
    // Budget & Prevision : libelles, sens, methode et budgets mensuels (valeurs issues de Situations)
    var budget = null, BS = 'Budget & Prevision';
    if (wb.sheets[BS]) {
      var bc = await wb.cells(BS); budget = { rows: [], objective: null };
      for (var rb = 12; rb <= 30; rb++) {
        var lab = str(bc.get('A' + rb)), sens = str(bc.get('B' + rb));
        if (!lab || !sens) continue;
        budget.rows.push({ row: rb, label: lab, sens: sens, method: str(bc.get('C' + rb)) || 'Rythme 6 mois', budget: isBlank(bc.get('D' + rb)) ? null : num(bc.get('D' + rb)) });
      }
    }
    // Historique patrimoine : tableau Snapshots
    var snaps = null, S = wb.tables.Snapshots;
    if (S) {
      var hs = Object.keys(wb.sheets).find(function (n) { return /historique patrimoine/i.test(n); });
      var sc2 = await wb.cells(hs); snaps = { sheet: hs, cols: S.cols, rows: [] };
      // colonnes saisies en EUR (hors totaux calcules)
      var snapAssetHeads = Object.keys(S.cols).filter(function (h) { return / \(eur\)$/.test(h) && !/^patrimoine /.test(h); });
      for (var r7 = S.range.s.row + 1; r7 <= S.range.e.row; r7++) {
        var sd = sc2.get((S.cols['date'] || 'A') + r7); if (typeof sd !== 'number') continue;
        var o = { row: r7, date: sd, rate: num(sc2.get((S.cols['taux eur/ntd'] || 'B') + r7)), assets: {} };
        snapAssetHeads.forEach(function (h) { o.assets[h.replace(/ \(eur\)$/, '')] = num(sc2.get(S.cols[h] + r7)); });
        o.cachedTotal = sc2.get((S.cols['patrimoine total (ntd)'] || 'I') + r7);
        snaps.rows.push(o);
      }
      snaps.assetCols = snapAssetHeads.map(function (h) { return h.replace(/ \(eur\)$/, ''); });
    }
    return { tx: tx, rules: rules, config: config, rate: rate, rateDate: rateDate, rateRef: rateRef, platforms: platforms, fr: fr, others: others, inv: inv,
      warnings: warnings, tableRef: T.ref, txCols: TC, budget: budget, snaps: snaps };
  }

  // ---------- logique Excel portee ----------
  function excelTrim(s) { return String(s).replace(/ +/g, ' ').replace(/^ | $/g, ''); }
  function lc(s) { return String(s).toLowerCase(); }

  function buildLearned(tx) {
    // Rules!H2 : UNIQUE(FILTER(TRIM(Objet), Force<>"" et Objet<>"")) + XLOOKUP de la 1re categorie forcee
    var map = new Map(), list = [];
    tx.forEach(function (t) {
      var o = excelTrim(t.objet);
      if (t.force !== '' && o !== '') {
        var key = lc(o);
        if (!map.has(key)) { var e = { objet: o, category: t.force, count: 0 }; map.set(key, e); list.push(e); }
      }
    });
    tx.forEach(function (t) { if (t.force !== '' && t.objet !== '') { var e = map.get(lc(t.objet)); if (e) e.count++; } });
    return { map: map, list: list };
  }

  function categorize(t, rules, learned) {
    if (t.force !== '') return { cat: t.force, src: 'force' };
    var o = lc(t.objet);
    if (o !== '') {
      for (var i = 0; i < rules.length; i++) {
        var k = rules[i].keyword;
        if (k !== '' && o.indexOf(lc(k)) !== -1) return { cat: rules[i].category, src: 'rule', rule: rules[i] };
      }
      var l = learned.map.get(lc(excelTrim(t.objet)));
      if (l) return { cat: l.category, src: 'learned' };
    }
    return { cat: 'Vie Quotidienne', src: 'default' };
  }

  // Prelevement prevu : achat du (JOUR_CLOTURE+1) au JOUR_CLOTURE -> preleve le JOUR_PRELEVEMENT du mois suivant la cloture
  function prevu(t, cfg) {
    if (lc(t.carte) !== 'cb' || t.achat == null) return null;
    var p = serialToParts(t.achat), jc = cfg.jourCloture || 20, jp = cfg.jourPrelevement || 9;
    var m = p.m + (p.d > jc ? 2 : 1), y = p.y; while (m > 12) { m -= 12; y++; }
    return partsToSerial(y, m, jp);
  }
  function serialToParts(s) { var d = new Date(Math.round((s - 25569) * 86400000)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function partsToSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
  function todaySerial(now) { now = now || new Date(); return partsToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate()); }

  function enrich(data) {
    var learned = buildLearned(data.tx);
    data.learned = learned;
    data.tx.forEach(function (t) {
      var c = categorize(t, data.rules, learned);
      t.cat = c.cat; t.catSrc = c.src;
      t.pending = t.date === null;
      t.net = t.credit - t.debit;
      t.prevu = prevu(t, data.config);
      if (t.date !== null) { var p = serialToParts(t.date); t.year = p.y; t.month = p.m; } else { t.year = null; t.month = null; }
    });
    return data;
  }

  // ---------- agregats ----------
  function compute(data, opts) {
    opts = opts || {};
    var today = opts.today != null ? opts.today : todaySerial();
    var tp = serialToParts(today);
    var C = data.config, rate = data.rate || 1;
    var cat = function (i, fallback) { return C.categories[i] || fallback; };
    var SAL = cat(0, 'Salaire'), BUS = cat(2, 'Business'), LOY = cat(3, 'Loyer'), GLF = cat(4, 'GuanLiFei'),
      VQ = cat(5, 'Vie Quotidienne'), DF = cat(6, 'Depenses Fixes'), EXT = cat(7, 'Extras'), INV = cat(8, 'Investissements'),
      IMP = cat(9, 'Impots'), TRF = 'Transfert';
    var k = C.withholding || 0, gross = k ? k / (1 - k) : 0;
    var rows = data.tx.filter(function (t) { return !t.empty; });
    var eq = function (a, b) { return lc(a) === lc(b); };

    // Soldes et controles (Transactions M1:O17)
    var bal = {};
    (C.comptes.length ? C.comptes : ['SCB', 'Richart']).forEach(function (c) { bal[c] = { all: 0, pending: 0 }; });
    var pendingTotal = 0, transferNet = 0, mega = 0, cumSavings = 0, totalNet = 0;
    rows.forEach(function (t) {
      Object.keys(bal).forEach(function (c) { if (eq(t.compte, c)) { bal[c].all += t.net; if (t.pending) bal[c].pending += t.net; } });
      totalNet += t.net;
      if (t.pending) pendingTotal += t.net;
      if (eq(t.cat, TRF)) { transferNet += t.net; if (lc(t.objet).indexOf('mega') !== -1) mega += t.net; }
      if (!t.pending && !eq(t.cat, TRF)) cumSavings += t.net;
    });
    var tracked = Object.keys(bal).reduce(function (s, c) { return s + bal[c].all; }, 0);
    var controls = {
      transfersInternal: transferNet - mega,
      mega: mega,
      cumSavings: cumSavings,
      pending: pendingTotal,
      ecart: cumSavings + mega + pendingTotal - tracked
    };

    // Par annee (Analysis 89:102)
    var years = {};
    rows.forEach(function (t) {
      if (t.pending) return;
      var y = years[t.year] || (years[t.year] = { year: t.year, n: 0, R: 0, salCred: 0, debNonTIB: 0, bilan: 0, inv: 0, loyGlf: 0, vq: 0, df: 0, ext: 0, imp: 0, bus: 0 });
      y.n++;
      var notT = !eq(t.cat, TRF);
      if (notT && !eq(t.cat, BUS)) y.R += t.credit;
      if (eq(t.cat, SAL)) y.salCred += t.credit;
      if (notT && !eq(t.cat, INV) && !eq(t.cat, BUS)) y.debNonTIB += t.debit;
      if (notT) y.bilan += t.net;
      if (eq(t.cat, INV)) y.inv += t.debit;
      if (eq(t.cat, LOY) || eq(t.cat, GLF)) y.loyGlf += t.debit;
      if (eq(t.cat, VQ)) y.vq += t.debit;
      if (eq(t.cat, DF)) y.df += t.debit;
      if (eq(t.cat, EXT)) y.ext += t.debit;
      if (eq(t.cat, IMP)) y.imp += t.debit;
      if (eq(t.cat, BUS)) y.bus += t.net;
    });
    var yearList = Object.keys(years).map(Number).sort();
    var cum = 0;
    var annual = yearList.map(function (yy) {
      var y = years[yy], S = y.salCred * gross; cum += y.bilan;
      return { year: yy, revenus: y.R + S, revenusNets: y.R, depenses: y.debNonTIB + S, bilan: y.bilan, cumul: cum,
        tauxEpargne: y.R ? y.bilan / y.R : null, investissements: y.inv, loyerGlf: y.loyGlf, vieQuotidienne: y.vq,
        depensesFixes: y.df, extras: y.ext, impots: y.imp + S, retenueEstimee: S, business: y.bus,
        epargneReelle: y.R - y.debNonTIB, tauxReel: y.R ? (y.R - y.debNonTIB) / y.R : 0 };
    });

    // Onglets annuels : matrice categorie x mois, filtre compte optionnel
    var yearCats = [SAL, 'Bonus', BUS, LOY, GLF, VQ, DF, EXT, INV, IMP].map(function (c, i) { return C.categories[i] || c; });
    function yearSheet(year, compte) {
      var m = {};
      yearCats.forEach(function (c) { m[c] = []; for (var i = 0; i < 12; i++) m[c].push({ credit: 0, debit: 0 }); });
      rows.forEach(function (t) {
        if (t.year !== year) return;
        if (compte && compte !== '*' && !eq(t.compte, compte)) return;
        if (compte === '*' && !t.compte) return;
        var key = yearCats.find(function (c) { return eq(c, t.cat); });
        if (!key) return;
        m[key][t.month - 1].credit += t.credit; m[key][t.month - 1].debit += t.debit;
      });
      var totals = {}, bilan = 0;
      yearCats.forEach(function (c, i) {
        var cr = 0, de = 0; m[c].forEach(function (x) { cr += x.credit; de += x.debit; });
        totals[c] = i === 0 ? cr : cr - de; // le salaire annuel (D51) ne somme que les credits
        bilan += totals[c];
      });
      return { year: year, compte: compte, categories: yearCats, matrix: m, totals: totals, bilan: bilan };
    }

    // Mois de l'annee analysee (Analysis 105:133)
    function monthly(year) {
      var out = [];
      for (var mm = 1; mm <= 12; mm++) out.push({ month: mm, revenus: 0, depenses: 0, loyerGlf: 0, vq: 0, df: 0, ext: 0, imp: 0, inv: 0, bus: 0, revenusNets: 0 });
      rows.forEach(function (t) {
        if (t.year !== year) return;
        var o = out[t.month - 1], notT = !eq(t.cat, TRF);
        var S = eq(t.cat, SAL) ? t.credit * gross : 0;
        if (notT && !eq(t.cat, BUS)) { o.revenus += t.credit; o.revenusNets += t.credit; }
        if (notT && !eq(t.cat, INV) && !eq(t.cat, BUS)) o.depenses += t.debit;
        o.revenus += S; o.depenses += S; o.imp += S;
        if (eq(t.cat, LOY) || eq(t.cat, GLF)) o.loyerGlf += t.debit;
        if (eq(t.cat, VQ)) o.vq += t.debit;
        if (eq(t.cat, DF)) o.df += t.debit;
        if (eq(t.cat, EXT)) o.ext += t.debit;
        if (eq(t.cat, IMP)) o.imp += t.debit;
        if (eq(t.cat, INV)) o.inv += t.debit;
        if (eq(t.cat, BUS)) o.bus += t.net;
      });
      out.forEach(function (o) { o.bilan = o.revenus - o.depenses; });
      return out;
    }

    // 12 mois glissants (Analysis K121:N145)
    var rolling = [];
    for (var i = 11; i >= 0; i--) {
      var y0 = tp.y, m0 = tp.m - i; while (m0 < 1) { m0 += 12; y0--; }
      rolling.push({ year: y0, month: m0, loyerGlf: 0, vqDf: 0, extras: 0 });
    }
    rows.forEach(function (t) {
      if (t.pending) return;
      var e = rolling.find(function (x) { return x.year === t.year && x.month === t.month; });
      if (!e) return;
      if (eq(t.cat, LOY) || eq(t.cat, GLF)) e.loyerGlf += t.debit;
      if (eq(t.cat, VQ) || eq(t.cat, DF)) e.vqDf += t.debit;
      if (eq(t.cat, EXT)) e.extras += t.debit;
    });

    // Investissements et patrimoine
    var toNtd = function (v, dev) { return dev === 'EUR' ? v * rate : v; };
    var invRows = data.inv.filter(function (x) { return !x.empty; });
    invRows.forEach(function (x) { x.ntd = toNtd(x.montant, x.devise); x.eur = x.devise === 'EUR' ? x.montant : x.montant / rate; });
    var platforms = data.platforms.map(function (p) {
      var investedNtd = 0, investedEur = 0;
      invRows.forEach(function (x) { if (eq(x.type, p.type)) { investedNtd += x.ntd; investedEur += x.eur; } });
      var vNtd = p.value === null ? investedNtd : toNtd(p.value, p.devise);
      var vEur = p.value === null ? investedEur : (p.devise === 'EUR' ? p.value : p.value / rate);
      return { type: p.type, row: p.row, investedNtd: investedNtd, investedEur: investedEur, value: p.value, devise: p.devise,
        valueNtd: vNtd, valueEur: vEur, plNtd: vNtd - investedNtd, plEur: vEur - investedEur,
        plPct: p.value === null || !investedNtd ? null : (vNtd - investedNtd) / investedNtd, status: p.value === null ? 'A renseigner' : 'OK', start: p.start };
    });
    var others = data.others.map(function (o) {
      var n = 0, e = 0; invRows.forEach(function (x) { if (eq(x.type, o)) { n += x.ntd; e += x.eur; } });
      return { type: o, investedNtd: n, investedEur: e };
    });
    var frNtd = data.fr.value === null ? 0 : toNtd(data.fr.value, data.fr.devise);
    var liquid = [];
    Object.keys(bal).forEach(function (c) { liquid.push({ name: 'Compte ' + c, ntd: bal[c].all, eur: bal[c].all / rate }); });
    liquid.push({ name: 'Compte FR', ntd: frNtd, eur: frNtd / rate, manual: true });
    var liquidNtd = liquid.reduce(function (s, l) { return s + l.ntd; }, 0);
    var platValueNtd = platforms.reduce(function (s, p) { return s + p.valueNtd; }, 0);
    var platInvNtd = platforms.reduce(function (s, p) { return s + p.investedNtd; }, 0);
    var plNtd = platforms.reduce(function (s, p) { return s + p.plNtd; }, 0);
    var netWorthNtd = liquidNtd + platValueNtd;

    // Evolution du patrimoine (Analysis 147:161) : montants investis cumules, comptes TW a fin d'annee
    var firstYear = yearList.length ? yearList[0] : tp.y;
    var wealth = [];
    for (var yy = firstYear; yy <= tp.y; yy++) {
      var cutoff = Math.min(partsToSerial(yy, 12, 31), today);
      var tw = 0; rows.forEach(function (t) { if (t.date !== null && t.date <= cutoff) tw += t.net; });
      if (yy === tp.y) tw += pendingTotal;
      var w = { year: yy, comptesTW: tw, byType: {}, compteFR: yy === tp.y ? frNtd : 0 };
      platforms.forEach(function (p) {
        var s = 0; invRows.forEach(function (x) { if (eq(x.type, p.type) && (x.date === null || x.date <= cutoff)) s += x.ntd; });
        w.byType[p.type] = s;
      });
      w.total = w.comptesTW + w.compteFR + Object.keys(w.byType).reduce(function (s, kk) { return s + w.byType[kk]; }, 0);
      wealth.push(w);
    }

    // ---- Carte de credit : lignes CB en attente, regroupees par prelevement prevu ----
    var cbPending = rows.filter(function (t) { return t.pending && lc(t.carte) === 'cb'; });
    var cycles = {};
    cbPending.forEach(function (t) { var k = t.prevu == null ? 'inconnu' : String(t.prevu); (cycles[k] = cycles[k] || { prevu: t.prevu, rows: [], total: 0 }); cycles[k].rows.push(t); cycles[k].total += t.debit - t.credit; });
    var cb = { pendingTotal: cbPending.reduce(function (s, t) { return s + t.net; }, 0), count: cbPending.length,
      cycles: Object.keys(cycles).map(function (k) { return cycles[k]; }).sort(function (a, b) { return (a.prevu == null) - (b.prevu == null) || a.prevu - b.prevu; }) };

    // ---- Budget & Prevision (port de l'onglet) ----
    var LOY_GLF = [LOY, GLF];
    function sumNet(cats, f) { var s = 0; rows.forEach(function (t) { if (cats.some(function (c) { return eq(c, t.cat); }) && f(t)) s += t.net; }); return s; }
    function budget(year, month) {
      var B = data.budget; if (!B) return null;
      var cutoff = partsToSerial(year, month + 1, 1) - 1, m6 = month - 5, y6 = year; while (m6 < 1) { m6 += 12; y6--; }
      var winStart = partsToSerial(y6, m6, 1), rest = 12 - month, taxM = C.taxMonth || 6;
      var lines = B.rows.map(function (b) {
        var cats = /loyer/i.test(b.label) && /guanlifei/i.test(b.label) ? LOY_GLF : [b.label];
        var sg = b.sens === 'Revenu' ? 1 : -1, rev = b.sens === 'Revenu', inv = !rev && b.sens !== 'Depense';
        var E_ = sg * sumNet(cats, function (t) { return t.year === year && t.month === month; });
        var H = sg * sumNet(cats, function (t) { return t.year === year && t.month <= month; });
        var J = sg * sumNet(cats, function (t) { return t.year === year - 1 && t.month <= month; });
        var L = sg * sumNet(cats, function (t) { return t.date != null && t.date >= winStart && t.date <= cutoff; }) / 6;
        var Pv = sg * sumNet(cats, function (t) { return t.year === year - 1; });
        var M = H + (b.method === 'Comme N-1' ? Pv - J : L * rest);
        var D_, G, N;
        if (eq(b.label, IMP)) { D_ = month === taxM ? Pv : 0; G = month >= taxM ? Pv : 0; N = Pv; }
        else { D_ = b.budget; G = D_ == null ? null : D_ * month; N = D_ == null ? null : D_ * 12; }
        var fav = function (bud, real) { return bud == null ? null : (rev || inv ? real - bud : bud - real); };
        return { label: b.label, sens: b.sens, method: b.method, row: b.row, kind: rev ? 'rev' : inv ? 'inv' : 'dep',
          D: D_, E: E_, F: fav(D_, E_), G: G, H: H, I: fav(G, H), J: J, K: J ? H / J - 1 : null, L: L, M: M, N: N, O: fav(N, M), P: Pv };
      });
      var KEYS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'O', 'P'];
      function tot(kind) { var o = {}; KEYS.forEach(function (k) { o[k] = 0; lines.forEach(function (l) { if (l.kind === kind) o[k] += l[k] || 0; }); }); o.K = o.J ? o.H / o.J - 1 : null; return o; }
      var tr = tot('rev'), td = tot('dep'), sav = {};
      KEYS.forEach(function (k) { sav[k] = /[FIO]/.test(k) ? tr[k] + td[k] : tr[k] - td[k]; });
      sav.K = sav.J ? sav.H / sav.J - 1 : null;
      var rate_ = {}; ['D', 'E', 'G', 'H', 'J', 'L', 'M', 'N', 'P'].forEach(function (k) { rate_[k] = tr[k] ? sav[k] / tr[k] : null; });
      var sal = lines.find(function (l) { return eq(l.label, SAL); }), info = {};
      if (sal) ['D', 'E', 'G', 'H', 'J', 'L', 'M', 'N', 'P'].forEach(function (k) { info[k] = sal[k] == null ? null : sal[k] * gross; });
      return { year: year, month: month, cutoff: cutoff, rest: rest, lines: lines, totalRev: tr, totalDep: td, savings: sav, savingsRate: rate_, withholdingInfo: info };
    }
    var lastFull = (function () { var y = tp.y, m = tp.m - 1; if (m < 1) { m = 12; y--; } return { year: y, month: m }; })();

    // ---- Historique du patrimoine (Snapshots) ----
    function twAt(d) { var s = 0; rows.forEach(function (t) { if (t.date != null && t.date <= d) s += t.net; }); return s; }
    var famP = data.platforms.find(function (p) { return p.row === 7; }) || data.platforms.find(function (p) { return /family/i.test(p.type); });
    function invAt(d, types) { var s = 0; invRows.forEach(function (x) { if (x.date != null && x.date <= d && types.some(function (ty) { return eq(ty, x.type); })) s += x.ntd; }); return s; }
    var allTypes = data.platforms.map(function (p) { return p.type; });
    function snapCalc(sn) {
      var eurSum = 0, eurPlat = 0;
      Object.keys(sn.assets).forEach(function (a) { eurSum += sn.assets[a]; if (!/compte fr/i.test(a)) eurPlat += sn.assets[a]; });
      var G = twAt(sn.date), H = famP ? invAt(sn.date, [famP.type]) : 0, K = invAt(sn.date, allTypes);
      var I = eurSum * sn.rate + G + H;
      return Object.assign({}, sn, { tw: G, family: H, totalNtd: I, totalEur: sn.rate ? I / sn.rate : 0, invested: K, latent: eurPlat * sn.rate + H - K });
    }
    var snapshots = null, liveSnap = null;
    if (data.snaps) {
      snapshots = data.snaps.rows.map(snapCalc);
      snapshots.forEach(function (x, i) { x.variation = i ? x.totalNtd - snapshots[i - 1].totalNtd : 0; });
      var assets = {};
      data.snaps.assetCols.forEach(function (a) {
        if (/compte fr/i.test(a)) { assets[a] = data.fr.value == null ? 0 : (data.fr.devise === 'EUR' ? data.fr.value : data.fr.value / rate); return; }
        var p = platforms.find(function (x) { return eq(x.type, a); }); assets[a] = p ? p.valueEur : 0;
      });
      liveSnap = snapCalc({ date: today, rate: rate, assets: assets });
      liveSnap.variation = snapshots.length ? liveSnap.totalNtd - snapshots[snapshots.length - 1].totalNtd : 0;
    }

    return {
      cb: cb, budget: budget, lastFullMonth: lastFull, snapshots: snapshots, liveSnap: liveSnap,
      today: today, rate: rate, balances: bal, tracked: tracked, pendingTotal: pendingTotal,
      pendingRows: rows.filter(function (t) { return t.pending; }),
      controls: controls, annual: annual, years: yearList, yearSheet: yearSheet, monthly: monthly, rolling: rolling,
      platforms: platforms, others: others, liquid: liquid, liquidNtd: liquidNtd, platValueNtd: platValueNtd, platInvNtd: platInvNtd,
      plNtd: plNtd, netWorthNtd: netWorthNtd, netWorthEur: netWorthNtd / rate, wealth: wealth,
      cats: { SAL: SAL, BUS: BUS, INV: INV, TRF: TRF, IMP: IMP }
    };
  }

  async function load(zip) {
    var wb = await openWorkbook(zip);
    var data = await extract(wb);
    enrich(data);
    return { wb: wb, data: data };
  }

  var api = { prevu: prevu, load: load, openWorkbook: openWorkbook, extract: extract, enrich: enrich, compute: compute, categorize: categorize,
    buildLearned: buildLearned, excelTrim: excelTrim, serialToParts: serialToParts, partsToSerial: partsToSerial, todaySerial: todaySerial,
    decodeXml: decodeXml, colToNum: colToNum, numToCol: numToCol, parseRange: parseRange, parseCells: parseCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinEngine = api;
})(typeof self !== 'undefined' ? self : this);
