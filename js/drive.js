/* Acces Google Drive : connexion Google (OAuth, scope drive.file), selection
 * du fichier (Google Picker), lecture, ecriture, conservation de revisions.
 * Le jeton d'acces reste en memoire de session, jamais envoye ailleurs que Google.
 */
(function () {
  'use strict';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var cfg = function () { return window.FIN_CONFIG || {}; };
  var token = null, tokenExp = 0, tokenClient = null, pending = null;

  try { var saved = JSON.parse(sessionStorage.getItem('fin_tok') || 'null'); if (saved && saved.exp > Date.now() + 60000) { token = saved.t; tokenExp = saved.exp; } } catch (e) {}

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res;
      s.onerror = function () { rej(new Error('Impossible de charger ' + src + ' (hors ligne ?)')); };
      document.head.appendChild(s);
    });
  }
  function configured() { var c = cfg(); return !!(c.CLIENT_ID && !/^VOTRE/.test(c.CLIENT_ID)); }

  async function initAuth() {
    if (tokenClient) return;
    await loadScript('https://accounts.google.com/gsi/client');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg().CLIENT_ID, scope: SCOPE,
      callback: function (resp) {
        var p = pending; pending = null; if (!p) return;
        if (resp.error) return p.rej(new Error('Connexion Google refusee : ' + resp.error));
        token = resp.access_token; tokenExp = Date.now() + (resp.expires_in - 60) * 1000;
        try { sessionStorage.setItem('fin_tok', JSON.stringify({ t: token, exp: tokenExp })); } catch (e) {}
        p.res(token);
      },
      error_callback: function (err) { var p = pending; pending = null; if (p) p.rej(new Error(err && err.type === 'popup_closed' ? 'Fenetre de connexion fermee.' : 'Connexion Google impossible.')); }
    });
  }
  function hasToken() { return !!token && Date.now() < tokenExp; }
  async function getToken() {
    if (hasToken()) return token;
    await initAuth();
    return new Promise(function (res, rej) { pending = { res: res, rej: rej }; tokenClient.requestAccessToken({ prompt: '' }); });
  }
  async function api(url, opts, retried) {
    opts = opts || {};
    var t = await getToken();
    var headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + t });
    var r = await fetch(url, Object.assign({}, opts, { headers: headers }));
    if (r.status === 401 && !retried) { token = null; tokenExp = 0; return api(url, opts, true); }
    if (!r.ok) {
      var msg = r.status + ''; try { var j = await r.json(); msg += ' ' + (j.error && j.error.message || ''); } catch (e) {}
      if (r.status === 404) msg = 'Fichier introuvable ou acces non accorde (rechoisissez le fichier). ' + msg;
      throw new Error('Google Drive : ' + msg);
    }
    return r;
  }
  async function pick() {
    var t = await getToken();
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise(function (res) { gapi.load('picker', res); });
    return new Promise(function (res, rej) {
      var view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(XLSX_MIME).setIncludeFolders(true).setMode(google.picker.DocsViewMode.LIST);
      var picker = new google.picker.PickerBuilder()
        .setTitle('Choisir le fichier de comptes (.xlsx)')
        .setOAuthToken(t).setDeveloperKey(cfg().API_KEY).setAppId(cfg().APP_ID)
        .addView(view).setLocale('fr')
        .setCallback(function (d) {
          if (d.action === google.picker.Action.PICKED) { var doc = d.docs[0]; res({ id: doc.id, name: doc.name }); }
          else if (d.action === google.picker.Action.CANCEL) rej(new Error('Selection annulee.'));
        }).build();
      picker.setVisible(true);
    });
  }
  var FIELDS = 'id,name,modifiedTime,version,headRevisionId,size';
  async function meta(id) { return (await api('https://www.googleapis.com/drive/v3/files/' + id + '?fields=' + FIELDS)).json(); }
  async function download(id) { return (await api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media')).arrayBuffer(); }
  async function upload(id, bytes) {
    return (await api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media&fields=' + FIELDS, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: new Blob([bytes], { type: XLSX_MIME })
    })).json();
  }
  async function keepRevision(id, revId) {
    await api('https://www.googleapis.com/drive/v3/files/' + id + '/revisions/' + revId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever: true })
    });
  }
  function signOut() {
    try { if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, function () {}); } catch (e) {}
    token = null; tokenExp = 0; try { sessionStorage.removeItem('fin_tok'); } catch (e) {}
  }
  window.FinDrive = { configured: configured, hasToken: hasToken, getToken: getToken, pick: pick, meta: meta, download: download, upload: upload, keepRevision: keepRevision, signOut: signOut, XLSX_MIME: XLSX_MIME };
})();
