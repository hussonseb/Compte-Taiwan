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
    var cells = new Map();
    var re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml))) {
      var attrs = m[2], inner = m[3];
      if (inner == null) continue;
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
      tables[nm] = { path: tableFiles[i], ref: ref, range: parseRange(ref) };
    }
    var cache = {};
    async function cells(name) {
      if (!cache[name]) {
        if (!sheets[name]) throw new Error('Onglet introuvable : ' + name);
        cache[name] = parseCells(await zip.file(sheets[name]).async('string'), sst);
      }
      return cache[name];
    }
    return { zip: zip, sheets: sheets, tables: tables, sst: sst, cells: cells };
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

    var tx = [];
    for (var r = T.range.s.row + 1; r <= T.range.e.row; r++) {
      var d = tc.get('A' + r);
      var row = {
        row: r,
        date: typeof d === 'number' ? d : null,
        compte: str(tc.get('B' + r)),
        objet: str(tc.get('C' + r)),
        force: str(tc.get('D' + r)),
        credit: num(tc.get('F' + r)),
        debit: num(tc.get('G' + r)),
        cachedCat: str(tc.get('E' + r))
      };
      row.empty = row.date === null && !row.compte && !row.objet && !row.force && !row.credit && !row.debit;
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

    var rate = num(tc.get('N20'));
    if (!rate) warnings.push('Taux de change introuvable en Transactions!N20.');
    var rateDate = typeof tc.get('N21') === 'number' ? tc.get('N21') : null;

    var ic = await wb.cells('Investissements');
    var platforms = [];
    for (var r3 = 4; r3 < 40; r3++) {
      var a = str(ic.get('A' + r3));
      if (!a || /^TOTAL\s/i.test(a)) break;
      platforms.push({ row: r3, type: a, value: isBlank(ic.get('D' + r3)) ? null : num(ic.get('D' + r3)), devise: str(ic.get('E' + r3)) || 'NTD', start: typeof ic.get('L' + r3) === 'number' ? ic.get('L' + r3) : null });
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
    return { tx: tx, rules: rules, config: config, rate: rate, rateDate: rateDate, platforms: platforms, fr: fr, others: others, inv: inv, warnings: warnings, tableRef: T.ref };
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
        depensesFixes: y.df, extras: y.ext, impots: y.imp + S, retenueEstimee: S, business: y.bus };
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

    return {
      today: today, rate: rate, balances: bal, tracked: tracked, pendingTotal: pendingTotal,
      pendingRows: rows.filter(function (t) { return t.pending; }),
      controls: controls, annual: annual, years: yearList, yearSheet: yearSheet, monthly: monthly, rolling: rolling,
      platforms: platforms, others: others, liquid: liquid, liquidNtd: liquidNtd, platValueNtd: platValueNtd, platInvNtd: platInvNtd,
      plNtd: plNtd, netWorthNtd: netWorthNtd, netWorthEur: netWorthNtd / rate, wealth: wealth,
      cats: { SAL: SAL, BUS: BUS, INV: INV, TRF: TRF }
    };
  }

  async function load(zip) {
    var wb = await openWorkbook(zip);
    var data = await extract(wb);
    enrich(data);
    return { wb: wb, data: data };
  }

  var api = { load: load, openWorkbook: openWorkbook, extract: extract, enrich: enrich, compute: compute, categorize: categorize,
    buildLearned: buildLearned, excelTrim: excelTrim, serialToParts: serialToParts, partsToSerial: partsToSerial, todaySerial: todaySerial,
    decodeXml: decodeXml, colToNum: colToNum, numToCol: numToCol, parseRange: parseRange, parseCells: parseCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinEngine = api;
})(typeof self !== 'undefined' ? self : this);
