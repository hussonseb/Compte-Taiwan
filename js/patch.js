/* Comptes Taiwan - ecriture chirurgicale dans le .xlsx.
 * Modifie uniquement les cellules de saisie (et les valeurs en cache des
 * formules de la meme ligne) directement dans le XML, sans regenerer le
 * classeur : graphiques, tableaux, formules dynamiques, validations et
 * complements restent intacts. Excel recalcule tout a l'ouverture.
 */
(function (root) {
  'use strict';
  var E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.FinEngine;

  var NOF = { createFolders: false };
  function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtNum(n) { return String(Math.round(n * 1e10) / 1e10); }

  // ----- manipulation de lignes -----
  function findRow(xml, r) {
    var key = '<row r="' + r + '"';
    var i = xml.indexOf(key + ' '); if (i < 0) i = xml.indexOf(key + '>');
    if (i < 0) return null;
    var gt = xml.indexOf('>', i);
    if (xml[gt - 1] === '/') return { start: i, end: gt + 1, text: xml.slice(i, gt + 1), selfClosing: true };
    var end = xml.indexOf('</row>', i) + 6;
    return { start: i, end: end, text: xml.slice(i, end) };
  }
  function cellsOf(rowText) {
    var out = [], re = /<c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, m;
    while ((m = re.exec(rowText))) out.push({ col: m[1], text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
  function attr(cellText, name) { var m = new RegExp(' ' + name + '="([^"]*)"').exec(cellText.slice(0, cellText.indexOf('>') + 1)); return m ? m[1] : null; }
  function getCell(rowText, col) { return cellsOf(rowText).find(function (c) { return c.col === col; }) || null; }

  function putCell(rowText, col, rowNum, newCellText) {
    var cells = cellsOf(rowText), ex = cells.find(function (c) { return c.col === col; });
    if (ex) return rowText.slice(0, ex.start) + newCellText + rowText.slice(ex.end);
    if (rowText.endsWith('/>') && rowText.indexOf('</row>') < 0) rowText = rowText.slice(0, -2) + '></row>';
    var n = E.colToNum(col), after = cells.find(function (c) { return E.colToNum(c.col) > n; });
    var pos = after ? after.start : rowText.lastIndexOf('</row>');
    return rowText.slice(0, pos) + newCellText + rowText.slice(pos);
  }
  // Cellule de saisie : valeur constante (ou vide), style conserve
  function valueCell(ref, style, v) {
    var s = style != null ? ' s="' + style + '"' : '';
    if (v === null || v === undefined || v === '') return '<c r="' + ref + '"' + s + '/>';
    if (typeof v === 'number') return '<c r="' + ref + '"' + s + '><v>' + fmtNum(v) + '</v></c>';
    var t = String(v), sp = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : '';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t' + sp + '>' + escXml(t) + '</t></is></c>';
  }
  function setInput(rowText, col, rowNum, v, styleOverride) {
    var ex = getCell(rowText, col);
    if (ex && /<f[ >]/.test(ex.text)) throw new Error('La cellule ' + col + rowNum + ' contient une formule : ecriture refusee.');
    var style = styleOverride != null ? styleOverride : (ex ? attr(ex.text, 's') : null);
    return putCell(rowText, col, rowNum, valueCell(col + rowNum, style, v));
  }
  // Met a jour la valeur en cache d'une cellule formule (la formule ne bouge pas)
  function setCached(rowText, col, v) {
    var ex = getCell(rowText, col);
    if (!ex || !/<f[ >\/]/.test(ex.text)) return rowText;
    var c = ex.text;
    var open = c.slice(0, c.indexOf('>') + 1).replace(/ t="[^"]*"/, '');
    var body = c.slice(c.indexOf('>') + 1).replace(/<v>[\s\S]*?<\/v>|<v\/>/, '').replace(/<\/c>$/, '');
    var isStr = typeof v !== 'number';
    if (isStr) open = open.replace(/>$/, ' t="str">');
    var vtxt = isStr ? (v === '' || v == null ? '<v/>' : '<v>' + escXml(v) + '</v>') : '<v>' + fmtNum(v) + '</v>';
    var ncell = open + body + vtxt + '</c>';
    return rowText.slice(0, ex.start) + ncell + rowText.slice(ex.end);
  }

  function replaceRow(xml, row, newText) { return xml.slice(0, row.start) + newText + xml.slice(row.end); }
  function insertRow(xml, r, rowText) {
    var re = /<row r="(\d+)"/g, m, pos = -1;
    while ((m = re.exec(xml))) { if (+m[1] > r) { pos = m.index; break; } }
    if (pos < 0) pos = xml.indexOf('</sheetData>');
    if (pos < 0) { // <sheetData/>
      xml = xml.replace('<sheetData/>', '<sheetData></sheetData>'); pos = xml.indexOf('</sheetData>');
    }
    return xml.slice(0, pos) + rowText + xml.slice(pos);
  }
  // Etend les plages (mise en forme conditionnelle, validations) qui finissaient sur oldEnd
  function extendRanges(xml, oldEnd, newEnd, minStart) {
    function fix(list) {
      return list.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g, function (all, c1, r1, c2, r2) {
        return (+r2 === oldEnd && +r1 <= minStart) ? c1 + r1 + ':' + c2 + newEnd : all;
      });
    }
    xml = xml.replace(/sqref="([^"]*)"/g, function (a, l) { return 'sqref="' + fix(l) + '"'; });
    xml = xml.replace(/<xm:sqref>([^<]*)<\/xm:sqref>/g, function (a, l) { return '<xm:sqref>' + fix(l) + '</xm:sqref>'; });
    xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/, function (a, c1, r1, c2, r2) { return '<dimension ref="' + c1 + r1 + ':' + c2 + Math.max(+r2, newEnd) + '"'; });
    return xml;
  }
  function setTableEnd(tableXml, newEnd) {
    return tableXml.replace(/(<table [^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)"/, '$1' + newEnd + '"')
      .replace(/(<autoFilter [^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)"/, '$1' + newEnd + '"');
  }
  function formulaText(cellText) {
    var m = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(cellText); return m ? m[1] : null;
  }
  function shiftFormula(f, fromRow, toRow) {
    return f.replace(/(\$?[A-Z]{1,3})(\d+)(?![\d(])/g, function (a, c, r) { return (+r === fromRow && c.indexOf('$') <= 0 && !/\$$/.test(c)) ? c + toRow : a; });
  }

  // ----- styles de reference (ligne datee / ligne en attente) -----
  function styleSet(rowText, cols) { var o = {}; cols.forEach(function (c) { var x = getCell(rowText, c); o[c] = x ? attr(x.text, 's') : null; }); return o; }

  // ----- application des operations -----
  // ops : [{type:'addTx', data:{date,compte,objet,force,credit,debit}},
  //        {type:'editTx', row, expect:{...}, data:{...}}, {type:'deleteTx', row, expect},
  //        {type:'addInv', data:{type,date,devise,montant}}, {type:'setPlatform', name, value, devise},
  //        {type:'setFR', value, devise}, {type:'setRate', value, date}]
  async function applyOps(zip, ops) {
    var loaded = await E.load(zip), wb = loaded.wb, data = loaded.data;
    var T = wb.tables.Transactions, I = wb.tables.InvDetail, S = wb.tables.Snapshots;
    var txPath = wb.sheets.Transactions, invPath = wb.sheets.Investissements;
    var txXml = await zip.file(txPath).async('string');
    var invXml = invPath ? await zip.file(invPath).async('string') : null;
    var tTable = await zip.file(T.path).async('string');
    var iTable = I ? await zip.file(I.path).async('string') : null;
    var snapPath = S && data.snaps ? wb.sheets[data.snaps.sheet] : null;
    var snapXml = snapPath ? await zip.file(snapPath).async('string') : null, sTable = S ? await zip.file(S.path).async('string') : null;
    var tStart = T.range.s.row + 1, tEnd = T.range.e.row;
    var results = [], touchedTx = new Set(), touchedInv = new Set(), snapTouched = false;
    // colonnes reperees par en-tete
    var X = data.txCols;
    var INPUT = [X.date, X.compte, X.objet, X.force, X.credit, X.debit].concat(X.carte ? [X.carte] : []).concat(X.achat ? [X.achat] : []);
    var FCOLS = [X.cat, X.statut, X.net, X.annee, X.mois].concat(X.prevu ? [X.prevu] : []);
    var ALLC = []; for (var ci = E.colToNum(T.range.s.col); ci <= E.colToNum(T.range.e.col); ci++) ALLC.push(E.numToCol(ci));
    var cardMode = !!X.carte; // V3+ : surlignage CB par mise en forme conditionnelle, plus de couleur manuelle

    // styles : 1re ligne datee et 1re ligne en attente
    var firstDated = data.tx.find(function (t) { return !t.empty && t.date !== null; });
    var firstPend = data.tx.find(function (t) { return !t.empty && t.date === null; });
    var normalStyle = firstDated ? styleSet(findRow(txXml, firstDated.row).text, ALLC) : null;
    var pendStyle = firstPend ? styleSet(findRow(txXml, firstPend.row).text, ALLC) : normalStyle;
    // gabarit de formules explicites (non partagees)
    var tmpl = {};
    for (var r = tStart; r <= tEnd && Object.keys(tmpl).length < FCOLS.length; r++) {
      var rw = findRow(txXml, r); if (!rw) continue;
      FCOLS.forEach(function (c) { if (tmpl[c]) return; var cx = getCell(rw.text, c); var f = cx && formulaText(cx.text); if (f) tmpl[c] = { f: f, row: r, cell: cx.text }; });
    }

    function sameFp(t, exp) {
      if (!exp) return true;
      return (exp.date == null ? t.date === null : t.date === exp.date) && String(exp.objet || '') === t.objet && +exp.credit === t.credit && +exp.debit === t.debit && String(exp.compte || '') === t.compte;
    }
    function applyStyleSwap(rowText, rowNum, wasPending, isPending) {
      if (cardMode || !normalStyle || !pendStyle || wasPending === isPending) return rowText;
      var from = wasPending ? pendStyle : normalStyle, to = isPending ? pendStyle : normalStyle;
      INPUT.concat([X.cat]).forEach(function (c) {
        var cx = getCell(rowText, c); if (!cx) return;
        if (attr(cx.text, 's') === from[c] && to[c] != null) rowText = rowText.slice(0, cx.start) + cx.text.replace(/ s="[^"]*"/, ' s="' + to[c] + '"') + rowText.slice(cx.end);
      });
      return rowText;
    }
    function writeTxInputs(rowNum, d, opts) {
      var row = findRow(txXml, rowNum), txt = row.text, vals = {};
      vals[X.date] = d.date == null ? null : d.date; vals[X.compte] = d.compte || null; vals[X.objet] = d.objet || null; vals[X.force] = d.force || null;
      vals[X.credit] = d.credit ? +d.credit : null; vals[X.debit] = d.debit ? +d.debit : null;
      if (X.carte) vals[X.carte] = d.carte || null;
      if (X.achat) vals[X.achat] = d.achat == null ? null : d.achat;
      INPUT.forEach(function (c) { txt = setInput(txt, c, rowNum, vals[c]); });
      // V2 : convention du surlignage jaune manuel. V3 : mise en forme conditionnelle sur la colonne Carte.
      if (opts.clearing) txt = applyStyleSwap(txt, rowNum, true, false);
      else if (d.date == null && !opts.wasPending) txt = applyStyleSwap(txt, rowNum, false, true);
      txXml = replaceRow(txXml, row, txt);
    }
    function modelRow(rowNum) { return data.tx.find(function (t) { return t.row === rowNum; }); }
    function setModel(t, d) {
      t.date = d.date == null ? null : d.date; t.compte = d.compte || ''; t.objet = d.objet || ''; t.force = d.force || '';
      t.credit = +d.credit || 0; t.debit = +d.debit || 0; t.carte = d.carte || ''; t.achat = d.achat == null ? null : d.achat;
      t.empty = t.date === null && !t.compte && !t.objet && !t.force && !t.credit && !t.debit && !t.carte && t.achat === null;
    }
    function pickSlot() {
      var firstUsed = data.tx.find(function (t) { return !t.empty; });
      var limit = firstUsed ? firstUsed.row : Infinity;
      var empties = data.tx.filter(function (t) { return t.empty; });
      var top = empties.filter(function (t) { return t.row < limit; });
      var pool = top.length ? top : empties;
      return pool.length ? pool[pool.length - 1].row : null;
    }
    function formulaCell(ref, style, tm, nr) {
      var arr = /<f t="array"/.test(tm.cell), cm = attr(tm.cell, 'cm'), isStr = / t="str"/.test(tm.cell.slice(0, tm.cell.indexOf('>') + 1));
      return '<c r="' + ref + '"' + (style != null ? ' s="' + style + '"' : '') + (isStr ? ' t="str"' : '') + (cm ? ' cm="' + cm + '"' : '') + '>' +
        (arr ? '<f t="array" ref="' + ref + '">' : '<f>') + shiftFormula(tm.f, tm.row, nr) + '</f>' + (isStr ? '<v/>' : '<v>0</v>') + '</c>';
    }
    function appendTxRow() {
      var nr = tEnd + 1, lastCol = E.colToNum(T.range.e.col);
      var ex = findRow(txXml, nr);
      if (ex && cellsOf(ex.text).some(function (c) { return E.colToNum(c.col) <= lastCol && /<v>|<is>|<f/.test(c.text); })) throw new Error('La ligne ' + nr + ' sous le tableau n\'est pas vide : ajoutez des lignes vides dans Excel.');
      if (!tmpl[X.cat] || !tmpl[X.statut]) throw new Error('Gabarit de formules introuvable.');
      var st = normalStyle || {}, cells = '';
      ALLC.forEach(function (c) {
        if (tmpl[c]) cells += formulaCell(c + nr, st[c] != null ? st[c] : attr(tmpl[c].cell, 's'), tmpl[c], nr);
        else cells += valueCell(c + nr, st[c], null);
      });
      var rowText = '<row r="' + nr + '" spans="' + E.colToNum(T.range.s.col) + ':' + lastCol + '">' + cells + '</row>';
      txXml = ex ? replaceRow(txXml, ex, rowText) : insertRow(txXml, nr, rowText);
      txXml = extendRanges(txXml, tEnd, nr, tStart);
      tTable = setTableEnd(tTable, nr);
      tEnd = nr;
      data.tx.push({ row: nr, date: null, compte: '', objet: '', force: '', credit: 0, debit: 0, carte: '', achat: null, empty: true });
      return nr;
    }

    // ---- Historique patrimoine : ajout d'un releve dans Snapshots ----
    function addSnapshot(sn) {
      if (!snapXml || !S) throw new Error('Tableau Snapshots introuvable.');
      var last = S.range.e.row, nr = last + 1, tm = findRow(snapXml, last);
      var ex = findRow(snapXml, nr), lastCol = E.colToNum(S.range.e.col), firstCol = E.colToNum(S.range.s.col);
      if (ex && cellsOf(ex.text).some(function (c) { var n = E.colToNum(c.col); return n >= firstCol && n <= lastCol && /<v>|<is>|<f/.test(c.text); })) throw new Error('La ligne ' + nr + ' sous le tableau Snapshots n\'est pas vide.');
      var head = {}; Object.keys(S.cols).forEach(function (h) { head[S.cols[h]] = h; });
      var cells = '';
      for (var n = firstCol; n <= lastCol; n++) {
        var c = E.numToCol(n), h = head[c] || '', src = tm ? getCell(tm.text, c) : null, style = src ? attr(src.text, 's') : null;
        var f = src && formulaText(src.text);
        if (f) { cells += '<c r="' + c + nr + '"' + (style ? ' s="' + style + '"' : '') + '><f>' + shiftFormula(f, last, nr) + '</f><v>0</v></c>'; continue; }
        var v = null, am = /^(.*) \(eur\)$/.exec(h);
        if (h === 'date') v = sn.date; else if (h === 'taux eur/ntd') v = sn.rate; else if (am && sn.assets[am[1]] != null) v = Math.round(sn.assets[am[1]] * 100) / 100;
        cells += valueCell(c + nr, style, v);
      }
      var rowText = '<row r="' + nr + '" spans="' + firstCol + ':' + lastCol + '">' + cells + '</row>';
      snapXml = ex ? replaceRow(snapXml, ex, rowText) : insertRow(snapXml, nr, rowText);
      snapXml = extendRanges(snapXml, last, nr, S.range.s.row + 1);
      sTable = setTableEnd(sTable, nr);
      S.range.e.row = nr; snapTouched = true;
      data.snaps.rows.push({ row: nr, date: sn.date, rate: sn.rate, assets: sn.assets });
      return nr;
    }

    // ---- Investissements ----
    function invRowModel(r) { return data.inv.find(function (x) { return x.row === r; }); }
    function pickInvSlot() {
      var firstUsed = data.inv.find(function (x) { return !x.empty; });
      var limit = firstUsed ? firstUsed.row : Infinity;
      var empties = data.inv.filter(function (x) { return x.empty; });
      var top = empties.filter(function (x) { return x.row < limit; });
      var pool = top.length ? top : empties;
      return pool.length ? pool[pool.length - 1].row : null;
    }
    function appendInvRow() {
      var end = I.range.e.row, nr = end + 1;
      var tm = findRow(invXml, end), ex = findRow(invXml, nr);
      if (ex && cellsOf(ex.text).some(function (c) { return E.colToNum(c.col) <= 6 && /<v>|<is>|<f/.test(c.text); })) throw new Error('La ligne ' + nr + ' sous le detail des investissements n\'est pas vide.');
      var cells = '';
      ['A', 'B', 'C', 'D'].forEach(function (c) { var x = getCell(tm.text, c); cells += valueCell(c + nr, x ? attr(x.text, 's') : null, null); });
      ['E', 'F'].forEach(function (c) { var x = getCell(tm.text, c); var f = x && formulaText(x.text); if (f) cells += '<c r="' + c + nr + '"' + (attr(x.text, 's') ? ' s="' + attr(x.text, 's') + '"' : '') + '><f>' + shiftFormula(f, end, nr) + '</f><v>0</v></c>'; });
      var rowText = '<row r="' + nr + '" spans="1:6">' + cells + '</row>';
      invXml = ex ? replaceRow(invXml, ex, rowText) : insertRow(invXml, nr, rowText);
      invXml = extendRanges(invXml, end, nr, I.range.s.row + 1);
      iTable = setTableEnd(iTable, nr);
      I.range.e.row = nr;
      var m = { row: nr, type: '', date: null, devise: '', montant: 0, empty: true }; data.inv.push(m);
      return nr;
    }
    function setInvCells(sheetRow, map) {
      var row = findRow(invXml, sheetRow);
      if (!row) { invXml = insertRow(invXml, sheetRow, '<row r="' + sheetRow + '"></row>'); row = findRow(invXml, sheetRow); }
      var txt = row.text;
      Object.keys(map).forEach(function (c) { txt = setInput(txt, c, sheetRow, map[c]); });
      invXml = replaceRow(invXml, row, txt);
    }

    ops.forEach(function (op, idx) {
      try {
        if (op.type === 'addTx') {
          var slot = pickSlot(); if (slot == null) slot = appendTxRow();
          var t = modelRow(slot);
          writeTxInputs(slot, op.data, { wasPending: false });
          setModel(t, op.data); touchedTx.add(slot);
          results.push({ idx: idx, ok: true, row: slot });
        } else if (op.type === 'editTx' || op.type === 'deleteTx') {
          var t2 = modelRow(op.row);
          if (!t2 || t2.empty) throw new Error('Ligne ' + op.row + ' introuvable ou vide.');
          if (!sameFp(t2, op.expect)) throw new Error('La ligne ' + op.row + ' a ete modifiee entre-temps dans Excel : modification ignoree.');
          var wasP = t2.date === null;
          var d = op.type === 'deleteTx' ? { date: null } : op.data;
          writeTxInputs(op.row, d, { wasPending: wasP, clearing: op.type === 'deleteTx' });
          setModel(t2, d); touchedTx.add(op.row);
          results.push({ idx: idx, ok: true, row: op.row });
        } else if (op.type === 'addInv') {
          if (!I || !invXml) throw new Error('Tableau InvDetail introuvable.');
          var s2 = pickInvSlot(); if (s2 == null) s2 = appendInvRow();
          setInvCells(s2, { A: op.data.type, B: op.data.date == null ? null : op.data.date, C: op.data.devise, D: +op.data.montant });
          var m = invRowModel(s2); m.type = op.data.type; m.date = op.data.date; m.devise = op.data.devise; m.montant = +op.data.montant; m.empty = false;
          touchedInv.add(s2);
          results.push({ idx: idx, ok: true, row: s2 });
        } else if (op.type === 'addSnapshot') {
          results.push({ idx: idx, ok: true, row: addSnapshot(op.data) });
        } else if (op.type === 'setPlatform') {
          var p = data.platforms.find(function (x) { return x.type === op.name; });
          if (!p) throw new Error('Plateforme inconnue : ' + op.name);
          if (p.locked) throw new Error(op.name + ' est calcule par une formule dans le classeur (valeur non modifiable).');
          setInvCells(p.row, { D: op.value === null || op.value === '' ? null : +op.value, E: op.devise || p.devise });
          results.push({ idx: idx, ok: true, row: p.row });
        } else if (op.type === 'setFR') {
          setInvCells(data.fr.row, { B: op.value === null || op.value === '' ? null : +op.value, C: op.devise || data.fr.devise });
          results.push({ idx: idx, ok: true, row: data.fr.row });
        } else if (op.type === 'setRate') {
          if (!(+op.value > 0)) throw new Error('Taux invalide.');
          var RR = data.rateRef, r20 = findRow(txXml, RR.row), t20 = setInput(r20.text, RR.col, RR.row, +op.value); txXml = replaceRow(txXml, r20, t20);
          if (op.date != null) { var r21 = findRow(txXml, RR.row + 1), t21 = setInput(r21.text, RR.col, RR.row + 1, op.date); txXml = replaceRow(txXml, r21, t21); }
          data.rate = +op.value;
          results.push({ idx: idx, ok: true });
        } else throw new Error('Operation inconnue : ' + op.type);
      } catch (e) { results.push({ idx: idx, ok: false, error: e.message }); }
    });

    // valeurs en cache des formules de ligne (categorie, statut, net, annee, mois)
    E.enrich(data);
    touchedTx.forEach(function (rn) {
      var t = modelRow(rn), row = findRow(txXml, rn), txt = row.text;
      txt = setCached(txt, X.cat, t.empty ? 'Vie Quotidienne' : t.cat);
      txt = setCached(txt, X.statut, t.date === null ? 'En attente' : '');
      txt = setCached(txt, X.net, t.credit - t.debit);
      txt = setCached(txt, X.annee, t.date === null ? '' : t.year);
      txt = setCached(txt, X.mois, t.date === null ? '' : t.month);
      if (X.prevu) txt = setCached(txt, X.prevu, t.prevu == null ? '' : t.prevu);
      txXml = replaceRow(txXml, row, txt);
    });
    touchedInv.forEach(function (rn) {
      var x = invRowModel(rn), row = findRow(invXml, rn), txt = row.text, rate = data.rate || 1;
      txt = setCached(txt, 'E', x.devise === 'EUR' ? x.montant * rate : x.montant);
      txt = setCached(txt, 'F', x.devise === 'EUR' ? x.montant : x.montant / rate);
      invXml = replaceRow(invXml, row, txt);
    });

    if (results.some(function (r) { return r.ok; })) {
      zip.file(txPath, txXml, NOF);
      if (invXml) zip.file(invPath, invXml, NOF);
      zip.file(T.path, tTable, NOF);
      if (I) zip.file(I.path, iTable, NOF);
      if (snapTouched) { zip.file(snapPath, snapXml, NOF); zip.file(S.path, sTable, NOF); }
      // recalcul complet a l'ouverture + suppression de la chaine de calcul (Excel la reconstruit)
      var wbx = await zip.file('xl/workbook.xml').async('string');
      if (/<calcPr\b[^>]*fullCalcOnLoad=/.test(wbx)) wbx = wbx.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
      else if (/<calcPr\b/.test(wbx)) wbx = wbx.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
      else wbx = wbx.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
      zip.file('xl/workbook.xml', wbx, NOF);
      if (zip.file('xl/calcChain.xml')) {
        zip.remove('xl/calcChain.xml');
        var rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
        zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, ''), NOF);
        var ct = await zip.file('[Content_Types].xml').async('string');
        zip.file('[Content_Types].xml', ct.replace(/<Override [^>]*calcChain[^>]*\/>/, ''), NOF);
      }
    }
    return { zip: zip, results: results };
  }

  var api = { applyOps: applyOps, _internals: { findRow: findRow, cellsOf: cellsOf, setInput: setInput, setCached: setCached, shiftFormula: shiftFormula, extendRanges: extendRanges } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinPatch = api;
})(typeof self !== 'undefined' ? self : this);
