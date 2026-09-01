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
  function saveSettings(settings, apiKey, ocrApiKey) {
    var payload = {}; Object.keys(settings || {}).forEach(function (k) { payload[k] = settings[k]; });
    if (apiKey) payload.externalApiKey = apiKey;
    if (ocrApiKey) payload.ocrApiKey = ocrApiKey;
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
  function queryLaw(settings, law) {
    return request(settings, '/api/laws/query', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ law: law }) }, 60000);
  }
  function askLaw(settings, question, candidates) {
    return request(settings, '/api/analyze', { method: 'POST', headers: jsonHeaders(settings), body: JSON.stringify({
      kind: 'law_question', equipment: { question: question },
      text: (candidates || []).map(function (d) {
        return '[법령] ' + (d.law || '') + '\n[연관 내용] ' + (d.about || '') + '\n[시행일] '
          + (d.effectiveDate || '') + '\n[원문] ' + (d.content || '');
      }).join('\n\n'), mode: settings.aiMode, allowExternalFallback: !!settings.allowExternalFallback
    }) }, 180000);
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
  function backups(settings) { return request(settings, '/api/backups', {}, 10000); }
  function restore(settings, name) {
    return request(settings, '/api/restore', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ name: name }) }, 30000);
  }
  function jobs(settings) { return request(settings, '/api/jobs', {}, 10000); }
  function runJobs(settings, forceLaws) {
    return request(settings, '/api/jobs/run', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ forceLaws: !!forceLaws }) }, 180000);
  }
  function ocr(settings, file) {
    return file.arrayBuffer().then(function (buf) {
      return request(settings, '/api/ocr?filename=' + encodeURIComponent(file.name), {
        method: 'POST', headers: authHeaders(settings, { 'Content-Type': file.type || 'application/pdf' }), body: buf
      }, 180000);
    });
  }
  function sendNotification(settings, notification) {
    return request(settings, '/api/notifications/send', { method: 'POST', headers: jsonHeaders(settings),
      body: JSON.stringify({ id: notification.id, to: notification.recipientEmail,
        subject: notification.subject, body: notification.body, status: notification.status,
        approvedAt: notification.approvedAt, approvedBy: notification.approvedBy }) }, 30000);
  }

  return { health: health, saveSettings: saveSettings, testStorage: testStorage,
    upload: upload, analyze: analyze, saveLaw: saveLaw, importLaw: importLaw, queryLaw: queryLaw, askLaw: askLaw, saveAnalysis: saveAnalysis,
    loadState: loadState, saveState: saveState, audit: audit, backup: backup, backups: backups,
    restore: restore, jobs: jobs, runJobs: runJobs, ocr: ocr,
    sendNotification: sendNotification, sameOriginServer: sameOriginServer };
});
