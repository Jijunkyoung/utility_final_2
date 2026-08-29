/** integration.js — 사내 보조 서버·공유폴더·AI 연결 클라이언트 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Integration = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function base(settings) { return String(settings && settings.serverUrl || '').trim().replace(/\/$/, ''); }
  function jsonHeaders() { return { 'Content-Type': 'application/json' }; }

  function request(settings, path, options) {
    var url = base(settings);
    if (!url || !root.fetch) return Promise.resolve({ ok: false, offline: true, error: '사내 서버 주소가 없습니다.' });
    var controller = root.AbortController ? new root.AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 5000) : null;
    var opts = options || {};
    if (controller) opts.signal = controller.signal;
    return root.fetch(url + path, opts).then(function (res) {
      return res.text().then(function (body) {
        var data; try { data = body ? JSON.parse(body) : {}; } catch (e) { data = { message: body }; }
        if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
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
    return request(settings, '/api/settings', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) });
  }
  function testStorage(settings) {
    return request(settings, '/api/settings/test', { method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ sharedPath: settings.sharedPath }) });
  }
  function upload(settings, equipmentId, category, file) {
    var q = '?equipmentId=' + encodeURIComponent(equipmentId) + '&category=' + encodeURIComponent(category)
      + '&filename=' + encodeURIComponent(file.name);
    return file.arrayBuffer().then(function (buf) {
      return request(settings, '/api/files' + q, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: buf });
    });
  }
  function analyze(settings, kind, equipment, documentText) {
    return request(settings, '/api/analyze', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
      kind: kind, equipment: equipment, text: documentText, mode: settings.aiMode,
      allowExternalFallback: !!settings.allowExternalFallback
    }) });
  }
  function saveLaw(settings, document) {
    return request(settings, '/api/laws', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(document) });
  }
  function importLaw(settings, document) {
    return request(settings, '/api/laws/import', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(document) });
  }
  function saveAnalysis(settings, analysis) {
    return request(settings, '/api/analyses', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(analysis) });
  }

  return { health: health, saveSettings: saveSettings, testStorage: testStorage,
    upload: upload, analyze: analyze, saveLaw: saveLaw, importLaw: importLaw, saveAnalysis: saveAnalysis };
});
