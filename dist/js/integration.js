/** integration.js — 사내 보조 서버·공유폴더·AI 연결 클라이언트 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Integration = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function sameOriginServer() {
    return !!(root.document && root.document.querySelector('meta[name="facility-server"][content="same-origin"]'));
  }
  function base(settings) { return String(settings && settings.serverUrl || '').trim().replace(/\/$/, ''); }
  function authHeaders(settings, source) {
    var out = Object.assign({}, source || {}), token = String(settings && settings.serverToken || '').trim();
    if (token) out.Authorization = 'Bearer ' + token;
    return out;
  }
  function jsonHeaders(settings) { return authHeaders(settings, { 'Content-Type': 'application/json' }); }

  function request(settings, path, options, timeoutMs) {
    var url = base(settings);
    if ((!url && !sameOriginServer()) || !root.fetch) return Promise.resolve({ ok: false, offline: true, error: '사내 서버 주소가 없습니다.' });
    var controller = root.AbortController ? new root.AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 5000) : null;
    var opts = options || {};
    opts.headers = authHeaders(settings, opts.headers);
    if (controller) opts.signal = controller.signal;
    return root.fetch((url || '') + path, opts).then(function (res) {
      return res.text().then(function (body) {
        var data; try { data = body ? JSON.parse(body) : {}; } catch (e) { data = { message: body }; }
        if (!res.ok) { data.ok = false; data.status = res.status; return data; }
        data.ok = true; return data;
      });
    }).catch(function (e) {
      return { ok: false, offline: true, error: e && e.message || String(e) };
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function health(settings) { return request(settings, '/api/health'); }
  function saveSettings(settings, apiKey) {
    var payload = {}; Object.keys(settings || {}).forEach(function (k) { payload[k] = settings[k]; });
    if (apiKey) payload.externalApiKey = apiKey;
    delete payload.serverToken;
    return request(settings, '/api/settings', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify(payload) });
  }
  function testStorage(settings) {
    return request(settings, '/api/settings/test', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ sharedPath: settings.sharedPath }) });
  }
  function upload(settings, equipmentId, category, file) {
    var q = '?equipmentId=' + encodeURIComponent(equipmentId) + '&category=' + encodeURIComponent(category)
      + '&filename=' + encodeURIComponent(file.name);
    return file.arrayBuffer().then(function (buf) {
      return request(settings, '/api/files' + q, { method: 'POST', headers: authHeaders(settings, { 'Content-Type': file.type || 'application/octet-stream' }), body: buf });
    });
  }
  function analyze(settings, kind, equipment, documentText) {
    return request(settings, '/api/analyze', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify({
      kind: kind, equipment: equipment, text: documentText, mode: settings.aiMode,
      allowExternalFallback: !!settings.allowExternalFallback
    }) });
  }
  function saveLaw(settings, document) {
    return request(settings, '/api/laws', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify(document) });
  }
  function importLaw(settings, document) {
    return request(settings, '/api/laws/import', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify(document) });
  }
  function saveAnalysis(settings, analysis) {
    return request(settings, '/api/analyses', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify(analysis) });
  }

  function loadState(settings) { return request(settings, '/api/state', {}, 2500); }
  function saveState(settings, data, baseRevision, actor, deviceName, force) {
    return request(settings, '/api/state', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify({
      data: data, baseRevision: Number(baseRevision) || 0, actor: actor || '',
      deviceName: deviceName || '', force: !!force
    }) }, 10000);
  }
  function audit(settings, limit) { return request(settings, '/api/audit?limit=' + encodeURIComponent(limit || 30)); }
  function backup(settings) { return request(settings, '/api/backup', { method: 'POST', headers: jsonHeaders(settings), body: '{}' }, 30000); }
  function sendNotification(settings, notification) {
    return request(settings, '/api/notifications/send', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ id: notification.id, to: notification.recipientEmail,
        subject: notification.subject, body: notification.body, status: notification.status,
        approvedAt: notification.approvedAt, approvedBy: notification.approvedBy }) }, 30000);
  }

  return { health: health, saveSettings: saveSettings, testStorage: testStorage,
    upload: upload, analyze: analyze, saveLaw: saveLaw, importLaw: importLaw, saveAnalysis: saveAnalysis,
    loadState: loadState, saveState: saveState, audit: audit, backup: backup,
    sendNotification: sendNotification, sameOriginServer: sameOriginServer };
});
