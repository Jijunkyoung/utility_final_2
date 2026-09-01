/**
 * app.js — 화면
 *
 * 페이지가 아홉 개지만 자료는 하나다(Store).
 * 각 페이지에만 있는 요소를 찾아 그 페이지의 준비 함수를 부른다.
 * 페이지마다 파일을 나누면 공통 계산이 흩어져 서로 어긋난다.
 */
(function () {
  'use strict';

  var S = window.Schedule, L = window.Law, E = window.Energy, St = window.Store;
  var A = window.Analysis, I = window.Integration;
  var db = St.load();
  var currentDetailEquipmentId = null;
  var selectedManualFile = null;
  var selectedRegistrationManualFile = null;
  var selectedLawFile = null;
  var currentLawDocumentId = null;
  var buildingDraft = null;
  var syncQueue = Promise.resolve();

  /* ────────────────────────────────────────────────────────── 도구 */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeHttpUrl(value) {
    var raw = String(value || '').trim(); if (!raw) return '';
    try { var u = new URL(raw); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; }
    catch (e) { return ''; }
  }
  function won(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function today() { return S.fmt(new Date()); }
  function summarize(value, limit) {
    var clean = String(value || '').replace(/\s+/g, ' ').trim();
    limit = limit || 70;
    return clean.length > limit ? clean.slice(0, limit).trim() + '…' : clean;
  }

  function serverConfigured() {
    return !!(db.settings.serverUrl || (I.sameOriginServer && I.sameOriginServer()));
  }

  function syncIdentity() {
    return { actor: db.settings.syncActor || '미지정 사용자',
      deviceName: db.settings.deviceName || (navigator.platform || '브라우저') };
  }

  function showSyncStatus(kind, message) {
    var box = $('#shared-sync-indicator');
    if (!box) {
      box = document.createElement('div'); box.id = 'shared-sync-indicator';
      box.setAttribute('role', 'status'); document.body.appendChild(box);
    }
    box.className = 'sync-indicator ' + (kind || ''); box.textContent = message || '';
    box.hidden = !message;
  }

  function cacheDb() {
    var r = St.save(db);
    if (!r.ok) alert(r.error);
    return r.ok;
  }

  function queueSharedSave(force) {
    if (!serverConfigured() || (!db.sync.enabled && !force)) return;
    var snapshot = St.sharedPayload(db), identity = syncIdentity();
    showSyncStatus('working', '사내 공용 데이터에 저장 중…');
    syncQueue = syncQueue.then(function () {
      return I.saveState(db.settings, snapshot, db.sync.revision, identity.actor, identity.deviceName, force)
        .then(function (r) {
          if (r.ok) {
            db.sync = Object.assign(db.sync, { revision: r.revision, updatedAt: r.updatedAt,
              updatedBy: r.updatedBy, deviceName: r.deviceName, conflict: false, enabled: true, serverEmpty: false });
            cacheDb(); showSyncStatus('good', '사내 공용 데이터 저장 완료 · 버전 ' + r.revision);
          } else if (r.conflict) {
            db.sync.conflict = true; db.sync.enabled = false; cacheDb();
            showSyncStatus('bad', '다른 PC의 수정이 먼저 저장됐습니다. 설정에서 어느 자료를 사용할지 선택하세요.');
          } else {
            showSyncStatus('bad', '공용 서버 저장 실패 · 이 PC에 임시 저장했습니다.');
          }
          return r;
        });
    });
    return syncQueue;
  }

  function persist() {
    var ok = cacheDb();
    if (ok) queueSharedSave(false);
    return ok;
  }

  function eqById(id) {
    for (var i = 0; i < db.equipments.length; i++) {
      if (db.equipments[i].id === id) return db.equipments[i];
    }
    return null;
  }
  function eqName(id) { var e = eqById(id); return e ? (e.code ? e.code + ' ' + e.name : e.name) : '(삭제된 설비)'; }

  function managerById(id) {
    return (db.managers || []).find(function (m) { return m.id === id; }) || null;
  }
  function managerText(m) { return m ? [m.name, m.phone].filter(Boolean).join(' / ') : ''; }
  function managerOptions(role, selected) {
    var list = (db.managers || []).filter(function (m) {
      return m.id === selected || (m.active !== false && (m.role === role || m.role === 'both'));
    });
    return '<option value="">— 담당자 대장에서 선택 —</option>' + list.map(function (m) {
      var warning = m.active === false ? ' · 담당 해제' : ((m.role !== role && m.role !== 'both') ? ' · 구분 확인 필요' : '');
      return '<option value="' + esc(m.id) + '"' + (m.id === selected ? ' selected' : '') + '>'
        + esc(m.name + (m.department ? ' · ' + m.department : '') + warning) + '</option>';
    }).join('');
  }
  function applyManagerSnapshot(e) {
    var legal = managerById(e.legalManagerId), maintenance = managerById(e.maintenanceManagerId);
    if (legal) e.legalMgr = managerText(legal);
    if (maintenance) { e.mgr = managerText(maintenance); e.mgrEmail = maintenance.email || ''; }
  }

  function inspectionsOf(e) {
    if (!e) return [];
    if (Array.isArray(e.inspections) && e.inspections.length) return e.inspections;
    if (e.lastInspect || e.cycleMonths || e.inspectCost !== null && e.inspectCost !== undefined) {
      return [{ id: (e.id || 'equipment') + '-inspection-1', name: '정기검사',
        lastDate: e.lastInspect || '', cycleMonths: e.cycleMonths || null,
        cost: e.inspectCost === undefined ? null : e.inspectCost }];
    }
    return [];
  }

  function syncPrimaryInspection(e) {
    var first = inspectionsOf(e)[0];
    e.lastInspect = first ? first.lastDate || '' : '';
    e.cycleMonths = first ? first.cycleMonths : null;
    e.inspectCost = first ? first.cost : null;
  }

  function inspectionRow(item) {
    item = item || {};
    return '<div class="inspection-row" data-inspection-id="' + esc(item.id || '') + '">'
      + '<label>검사명<input data-inspection-field="name" value="' + esc(item.name || '') + '" placeholder="정기검사" required></label>'
      + '<label>최근 검사일<input data-inspection-field="lastDate" type="date" value="' + esc(item.lastDate || '') + '"></label>'
      + '<label>주기(개월)<input data-inspection-field="cycleMonths" type="number" min="1" step="1" value="' + esc(item.cycleMonths == null ? '' : item.cycleMonths) + '" placeholder="12"></label>'
      + '<label>비용(원)<input data-inspection-field="cost" type="number" min="0" step="1000" value="' + esc(item.cost == null ? '' : item.cost) + '" placeholder="모르면 비움"></label>'
      + '<button class="btn small-btn inspection-remove" type="button" data-inspection-remove>삭제</button></div>';
  }

  function bindInspectionEditor(root) {
    $$('[data-inspection-remove]', root).forEach(function (button) {
      if (button.getAttribute('data-bound') === '1') return;
      button.setAttribute('data-bound', '1');
      button.addEventListener('click', function () {
        var row = button.closest('[data-inspection-id]'); if (row) row.remove();
      });
    });
  }

  function addInspectionRow(root, item) {
    root.insertAdjacentHTML('beforeend', inspectionRow(item || { id: St.newId('i') }));
    bindInspectionEditor(root);
  }

  function readInspectionEditor(root) {
    var rows = $$('[data-inspection-id]', root), out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], values = {}, inputs = $$('[data-inspection-field]', row);
      for (var j = 0; j < inputs.length; j++) {
        if (!inputs[j].reportValidity()) return null;
        values[inputs[j].getAttribute('data-inspection-field')] = inputs[j].value.trim();
      }
      values.id = row.getAttribute('data-inspection-id') || St.newId('i');
      values.cycleMonths = values.cycleMonths === '' ? null : Number(values.cycleMonths);
      values.cost = values.cost === '' ? null : Number(values.cost);
      out.push(values);
    }
    return out;
  }

  function soonestInspection(e, at, lead) {
    var rows = inspectionsOf(e).map(function (item) {
      return { item: item, r: S.nextInspection(item.lastDate, item.cycleMonths, at, lead) };
    }).filter(function (x) { return x.r.next !== null; });
    rows.sort(function (a, b) { return a.r.dday - b.r.dday; });
    return rows[0] || { item: null, r: S.nextInspection(null, null, at, lead) };
  }

  /** 상태별 색 */
  function badge(status) {
    var color = { '기한 초과': 'var(--danger)', '오늘': 'var(--danger)', '알림': 'var(--warn)',
                  '여유': 'var(--ok)' }[status] || 'var(--sub)';
    return '<b style="color:' + color + '">' + esc(status) + '</b>';
  }

  /* ─────────────────────────────────────────────── 검사·교체 모으기 */

  /**
   * 설비의 법정검사 + 소모품 교체를 한 줄씩 펼친다.
   * 개요·알림 두 화면이 같은 계산을 써야 하므로 여기 한 곳에만 둔다.
   */
  function allDue(t, leadI, leadR) {
    var out = [];
    db.equipments.forEach(function (e) {
      var items = inspectionsOf(e);
      if (!items.length) items = [{ id: e.id + '-inspection-none', name: '정기검사', lastDate: '', cycleMonths: null, cost: null }];
      items.forEach(function (inspection) {
        var r = S.nextInspection(inspection.lastDate, inspection.cycleMonths, t, leadI);
        out.push({ type: '법정검사', sourceId: inspection.id, eq: e,
          item: inspection.name || '정기검사', r: r, cost: inspection.cost });
      });
    });
    db.consumables.forEach(function (c) {
      var r = S.nextReplacement(c.lastDate, c.cycleMonths, t, leadR);
      out.push({ type: '소모품', sourceId: c.id, eq: eqById(c.equipmentId), item: c.name, r: r, cost: c.cost });
    });
    // 임박한 것이 위로. 모르는 것(이력 없음·주기 없음)은 맨 아래로 — 정렬에 섞으면
    // 남은 일수가 null 이라 순서가 뒤죽박죽이 된다.
    out.sort(function (a, b) {
      var x = a.r.dday, y = b.r.dday;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════════ 개요 */

  function initIndex() {
    var seedBtn = $('#seed');
    if (seedBtn) seedBtn.addEventListener('click', function () { seed(); location.reload(); });
    renderIndex();
  }

  function renderIndex() {
    var hint = $('#empty-hint');
    if (hint) hint.hidden = db.equipments.length > 0;

    var t = today();
    var due = allDue(t);
    var over = due.filter(function (d) { return d.r.status === '기한 초과'; });
    var soon = due.filter(function (d) { return d.r.status === '알림' || d.r.status === '오늘'; });
    var unknown = due.filter(function (d) { return d.r.next === null; });
    var review = L.needsReview(db.equipments, t, 365, db.lawReviews);

    $('#summary').innerHTML = [
      ['설비', db.equipments.length + '건', ''],
      ['기한 초과', over.length + '건', over.length ? 'var(--danger)' : ''],
      ['임박', soon.length + '건', soon.length ? 'var(--warn)' : ''],
      ['알 수 없음', unknown.length + '건', unknown.length ? 'var(--sub)' : ''],
      ['법령 확인 필요', review.length + '건', review.length ? 'var(--warn)' : '']
    ].map(function (x) {
      return '<div class="stat">' + esc(x[0]) + '<b' + (x[2] ? ' style="color:' + x[2] + '"' : '') + '>'
           + esc(x[1]) + '</b></div>';
    }).join('');

    var rows = due.filter(function (d) { return d.r.next !== null; }).slice(0, 20);
    $('#due tbody').innerHTML = rows.length ? rows.map(function (d) {
      return '<tr' + (d.r.status === '기한 초과' ? ' class="flag"' : '') + '>'
        + '<td>' + esc(d.type) + '</td>'
        + '<td>' + esc(d.eq ? d.eq.name : '(삭제됨)') + '</td>'
        + '<td>' + esc(d.item) + '</td>'
        + '<td class="mono">' + esc(d.r.nextText) + '</td>'
        + '<td class="num">' + d.r.dday + '일</td>'
        + '<td>' + badge(d.r.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="sub">계산할 수 있는 일정이 없습니다.</td></tr>';

    $('#review').innerHTML = review.length
      ? '<div class="tablewrap" style="max-height:none"><table><thead><tr><th>설비</th><th>왜</th></tr></thead><tbody>'
        + review.map(function (r) {
            return '<tr><td>' + esc(r.name) + '</td><td class="rev">' + esc(r.reasons.join(' · ')) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      : '<p class="sub" style="margin:0">확인이 필요한 설비가 없습니다.</p>';
  }

  /* ═══════════════════════════════════════════════════ 설비 */

  function initEquipment() {
    var kindSel = $('#kind');
    kindSel.innerHTML = '<option value="">— 고르세요 —</option>'
      + L.KINDS.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
    $('#eq-legal-mgr').innerHTML = managerOptions('legal', '');
    $('#eq-mgr').innerHTML = managerOptions('maintenance', '');
    $('#eq-mgr').addEventListener('change', function () {
      var m = managerById(this.value); $('#eq-mgr-email').value = m ? m.email || '' : '';
    });
    addInspectionRow($('#eq-inspection-list'), { id: St.newId('i'), name: '정기검사' });
    $('#eq-inspection-add').addEventListener('click', function () {
      addInspectionRow($('#eq-inspection-list'), { id: St.newId('i') });
    });
    $('#detail-inspection-add').addEventListener('click', function () {
      addInspectionRow($('#detail-inspection-list'), { id: St.newId('i') });
    });

    function syncOtherKind(focus) {
      var input = $('#kind-other');
      var on = kindSel.value === '기타';
      input.hidden = !on;
      input.required = on;
      if (!on) input.value = '';
      if (on && focus) input.focus();
      showLawHint();
    }

    function closeCreateDialog() {
      var dialog = $('#eq-create');
      if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    }

    kindSel.addEventListener('change', function () { syncOtherKind(true); });
    syncOtherKind(false);

    $('#eq-create-open').addEventListener('click', function () {
      var dialog = $('#eq-create');
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      document.body.classList.add('register-open');
      $('#eq-code').focus();
    });
    $('#eq-create-close').addEventListener('click', closeCreateDialog);
    $('#eq-create').addEventListener('close', function () {
      document.body.classList.remove('register-open');
    });

    $('#eq-save').addEventListener('click', function (ev) {
      ev.preventDefault();
      var f = $('#eq-form');
      if (!f.reportValidity()) return;
      var o = { id: St.newId('eq') };
      $$('#eq-form [name]').forEach(function (i) { o[i.name] = i.value.trim(); });
      o.inspections = readInspectionEditor($('#eq-inspection-list'));
      if (o.inspections === null) return;
      syncPrimaryInspection(o);
      applyManagerSnapshot(o);
      if (o.kind === '기타') o.kind = $('#kind-other').value.trim();
      // 숫자로 둘 것만 숫자로. 빈 값은 null 로 둔다 — 0 으로 두면 "주기 0" 이 되어
      // "주기 없음" 과 구분이 안 된다.
      ensureBuilding(o.building);
      db.equipments.push(o);
      if (persist()) {
        var registrationFile = selectedRegistrationManualFile;
        f.reset(); selectedRegistrationManualFile = null;
        $('#eq-manual-file-button').textContent = '파일 선택';
        $('#eq-manual-file-name').textContent = '설비 저장 후 공유폴더에 업로드하고 분석합니다.';
        $('#eq-inspection-list').innerHTML = '';
        addInspectionRow($('#eq-inspection-list'), { id: St.newId('i'), name: '정기검사' });
        syncOtherKind(false); renderEquipment(); closeCreateDialog();
        if (registrationFile) addManualAndAnalyze(o, registrationFile, registrationFile.name);
      }
    });
    $('#eq-clear').addEventListener('click', function () {
      $('#eq-form').reset(); selectedRegistrationManualFile = null;
      $('#eq-manual-file-button').textContent = '파일 선택';
      $('#eq-manual-file-name').textContent = '설비 저장 후 공유폴더에 업로드하고 분석합니다.';
      $('#eq-inspection-list').innerHTML = '';
      addInspectionRow($('#eq-inspection-list'), { id: St.newId('i'), name: '정기검사' });
      syncOtherKind(false);
    });

    $('#export').addEventListener('click', exportJson);
    $('#import-file').addEventListener('change', importJson);
    $('#export-xlsx').addEventListener('click', exportEquipmentXlsx);

    $('#detail-close').addEventListener('click', closeEquipmentDetail);
    $('#eq-detail').addEventListener('close', function () {
      currentDetailEquipmentId = null;
      document.body.classList.remove('detail-open');
    });
    $$('#eq-detail [data-detail-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showDetailTab(b.getAttribute('data-detail-tab')); });
    });
    $('#detail-basic-save').addEventListener('click', saveDetailBasic);
    $('#detail-consumable-save').addEventListener('click', saveDetailConsumable);
    $('#detail-history-save').addEventListener('click', saveDetailHistory);
    $('#detail-manual-save').addEventListener('click', saveDetailManual);
    $('#detail-law-save').addEventListener('click', saveDetailLaw);
    $('#detail-law-document-save').addEventListener('click', saveLawDocumentContent);
    $('#detail-law-document-new').addEventListener('click', newLawDocumentForm);
    $('#detail-law-monitor').addEventListener('click', monitorSavedLaws);
    $('#detail-law-review-run').addEventListener('click', runLawReview);
    $('#detail-history-form [name=kind]').addEventListener('change', function () {
      syncHistoryConsumables($('#detail-history-form'), currentDetailEquipmentId);
    });
    $('#law-requirement-close').addEventListener('click', function () {
      var dialog = $('#law-requirement-dialog');
      if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    });
    $('#law-change-close').addEventListener('click', function () {
      var dialog = $('#law-change-dialog');
      if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    });
    $('#eq-manual-file').addEventListener('change', function () {
      selectedRegistrationManualFile = this.files && this.files[0] || null;
      $('#eq-manual-file-button').textContent = selectedRegistrationManualFile ? '다시 선택' : '파일 선택';
      $('#eq-manual-file-name').textContent = selectedRegistrationManualFile
        ? selectedRegistrationManualFile.name : '설비 저장 후 공유폴더에 업로드하고 분석합니다.';
    });
    $('#manual-file').addEventListener('change', function () {
      selectedManualFile = this.files && this.files[0] || null;
      $('#manual-file-label').textContent = selectedManualFile ? selectedManualFile.name : '파일 선택';
    });
    $('#law-file').addEventListener('change', function () {
      selectedLawFile = this.files && this.files[0] || null;
      $('#law-file-label').textContent = selectedLawFile ? selectedLawFile.name : '파일 선택';
    });

    renderEquipment();
  }

  function showLawHint() {
    var box = $('#law-hint');
    var kind = $('#kind').value;
    var laws = L.lawsFor(kind);
    if (!kind) { box.innerHTML = ''; return; }
    if (!laws.length) {
      box.innerHTML = '<div class="note">이 종류에 대해 미리 정리해 둔 법령이 없습니다. '
        + '<a href="' + L.SEARCH + '" target="_blank" rel="noopener">국가법령정보센터</a>에서 직접 찾아보세요.</div>';
      return;
    }
    box.innerHTML = '<div class="note"><b>관련 법령 (참고)</b><ul style="margin:8px 0 0;padding-left:18px">'
      + laws.map(function (x) {
          return '<li style="margin:4px 0">' + esc(x.law) + ' — ' + esc(x.about)
            + ' <a href="' + esc(x.searchUrl) + '" target="_blank" rel="noopener">찾아보기</a></li>';
        }).join('')
      + '</ul><p style="margin:10px 0 0"><b>검사 주기는 여기서 알려 드리지 않습니다.</b> '
      + '같은 종류라도 용량·종별·설치 장소에 따라 다릅니다. '
      + '위 법령에서 확인한 값을 직접 넣으세요.</p></div>';
  }

  function renderEquipment() {
    $('#eq-count').textContent = db.equipments.length + '건';
    $('#bldg-list').innerHTML = buildings().map(function (b) {
      return '<option value="' + esc(b) + '">';
    }).join('');

    $('#eq-table tbody').innerHTML = db.equipments.length ? db.equipments.map(function (e) {
      var latestLaw = L.latestReview(e.id, db.lawReviews);
      return '<tr>'
        + '<td><div style="display:flex;gap:5px">'
        + '<button class="btn primary small-btn" data-detail="' + esc(e.id) + '">상세</button>'
        + '<button class="btn small-btn" data-del="' + esc(e.id) + '">삭제</button></div></td>'
        + '<td class="mono">' + esc(e.code) + '</td>'
        + '<td>' + esc(e.name) + '</td>'
        + '<td>' + esc(e.kind) + '</td>'
        + '<td>' + esc(e.building) + '</td>'
        + '<td>' + esc(e.place) + '</td>'
        + '<td>' + esc(e.spec) + '</td>'
        + '<td>' + esc(e.mgr) + '</td>'
        + '<td class="mono">' + esc(inspectionsOf(e).map(function (i) { return i.lastDate || '미입력'; }).join(' · ') || '—') + '</td>'
        + '<td class="num">' + esc(inspectionsOf(e).map(function (i) { return (i.name || '검사') + ' ' + (i.cycleMonths ? i.cycleMonths + '개월' : '미입력'); }).join(' · ') || '—') + '</td>'
        + '<td class="mono">' + esc((latestLaw && latestLaw.checkedAt) || e.lawCheckedAt || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="11" class="sub">등록된 설비가 없습니다.</td></tr>';

    $$('#eq-table [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = eqById(b.getAttribute('data-del'));
        if (!e) return;
        var n = ['history', 'consumables', 'manuals', 'lawReviews'].reduce(function (sum, key) {
          return sum + St.forEquipment(db[key], e.id).length;
        }, 0);
        if (!confirm('“' + e.name + '” 을 지웁니다.'
          + (n ? '\n연결된 소모품·이력·매뉴얼·법령 기록 ' + n + '건도 함께 삭제됩니다.' : '')
          + '\n계속할까요?')) return;
        db = St.removeEquipment(db, e.id);
        if (persist()) renderEquipment();
      });
    });
    $$('#eq-table [data-detail]').forEach(function (b) {
      b.addEventListener('click', function () { openEquipmentDetail(b.getAttribute('data-detail')); });
    });
  }

  function buildings() {
    return buildingRecords().map(function (b) { return b.name; }).sort();
  }

  function buildingRecords() {
    return (db.buildings || []).filter(function (b) { return b && b.name; });
  }

  function ensureBuilding(name) {
    name = String(name || '').trim();
    if (!name || buildingRecords().some(function (b) { return b.name === name; })) return;
    var i = db.buildings.length, col = i % 4, row = Math.floor(i / 4);
    db.buildings.push({ id: St.buildingId(name), name: name,
      x: 4 + col * 24, y: 8 + row * 30, w: 20, h: 22,
      points: [{ x: 4 + col * 24, y: 8 + row * 30 }, { x: 24 + col * 24, y: 8 + row * 30 },
        { x: 24 + col * 24, y: 30 + row * 30 }, { x: 4 + col * 24, y: 30 + row * 30 }] });
  }

  /* ─────────────────────────────────────────────── 설비 상세 5개 탭 */

  function detailEquipment() { return eqById(currentDetailEquipmentId); }

  function openEquipmentDetail(id) {
    var e = eqById(id);
    if (!e) return;
    currentDetailEquipmentId = id;
    $('#detail-title').textContent = e.name || '설비 상세';
    $('#detail-code').textContent = (e.code || '설비번호 없음') + ' · ' + (e.kind || '종류 미입력');
    selectedManualFile = null;
    selectedLawFile = null;
    currentLawDocumentId = null;
    $('#manual-file').value = '';
    $('#manual-file-label').textContent = '파일 선택';
    $('#law-file').value = '';
    $('#law-file-label').textContent = '파일 선택';
    $('#detail-law-document-form').reset();
    $('#detail-history-form [name=date]').value = today();
    $('#detail-law-form').reset();
    $('#detail-law-form [name=checkedAt]').value = today();
    $('#detail-law-form [name=reviewer]').value = db.settings.syncActor || '';
    showDetailTab('basic');
    renderEquipmentDetail();
    var dialog = $('#eq-detail');
    document.body.classList.add('detail-open');
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function closeEquipmentDetail() {
    var dialog = $('#eq-detail');
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    currentDetailEquipmentId = null;
    document.body.classList.remove('detail-open');
  }

  function showDetailTab(name) {
    $$('#eq-detail [data-detail-tab]').forEach(function (b) {
      var on = b.getAttribute('data-detail-tab') === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('#eq-detail [data-detail-panel]').forEach(function (p) {
      var on = p.getAttribute('data-detail-panel') === name;
      p.hidden = !on; p.classList.toggle('on', on);
    });
  }

  function field(label, name, v, type, extra) {
    return '<label>' + esc(label) + ' <input name="' + esc(name) + '" type="' + esc(type || 'text')
      + '" value="' + esc(v == null ? '' : v) + '"' + (extra || '') + '></label>';
  }

  function selectField(label, name, options) {
    return '<label>' + esc(label) + ' <select name="' + esc(name) + '">' + options + '</select></label>';
  }

  function renderDetailBasic(e) {
    var customKind = e.kind && L.KINDS.indexOf(e.kind) < 0
      ? '<option value="' + esc(e.kind) + '" selected>기타: ' + esc(e.kind) + '</option>' : '';
    var kindOptions = '<option value="">— 고르세요 —</option>' + customKind + L.KINDS.map(function (k) {
      return '<option' + (e.kind === k ? ' selected' : '') + '>' + esc(k) + '</option>';
    }).join('');
    $('#detail-basic-form').innerHTML =
        field('설비번호', 'code', e.code, 'text', ' required')
      + field('설비명', 'name', e.name, 'text', ' required')
      + '<label>종류 <select name="kind">' + kindOptions + '</select></label>'
      + field('모델명', 'model', e.model)
      + field('제조사', 'manufacturer', e.manufacturer)
      + field('용량', 'capacity', e.capacity)
      + field('유량', 'flow', e.flow)
      + field('압력', 'pressure', e.pressure)
      + field('소모전력', 'power', e.power)
      + field('냉난방능력', 'hvac', e.hvac)
      + field('기타사양', 'spec', e.spec)
      + field('위치', 'building', e.building)
      + field('세부위치', 'place', e.place)
      + field('설치일', 'installedAt', e.installedAt, 'date')
      + selectField('법정선임관리자', 'legalManagerId', managerOptions('legal', e.legalManagerId))
      + selectField('유지관리자', 'maintenanceManagerId', managerOptions('maintenance', e.maintenanceManagerId))
      + field('유지관리자 메일', 'mgrEmail', e.mgrEmail, 'email', ' readonly')
      + field('법령 확인일', 'lawCheckedAt', e.lawCheckedAt, 'date')
      + field('비고', 'note', e.note);
    $('#detail-inspection-list').innerHTML = inspectionsOf(e).map(inspectionRow).join('');
    bindInspectionEditor($('#detail-inspection-list'));
    var maintenanceSelect = $('#detail-basic-form [name=maintenanceManagerId]');
    maintenanceSelect.addEventListener('change', function () {
      var m = managerById(this.value);
      $('#detail-basic-form [name=mgrEmail]').value = m ? m.email || '' : '';
    });
  }

  function renderEquipmentDetail() {
    var e = detailEquipment();
    if (!e) return;
    $('#detail-title').textContent = e.name || '설비 상세';
    $('#detail-code').textContent = (e.code || '설비번호 없음') + ' · ' + (e.kind || '종류 미입력');
    renderDetailBasic(e);
    renderDetailConsumables(e);
    renderDetailHistory(e);
    syncHistoryConsumables($('#detail-history-form'), e.id);
    renderDetailManuals(e);
    renderDetailLaws(e);
  }

  function saveDetailBasic() {
    var e = detailEquipment(), f = $('#detail-basic-form');
    if (!e || !f.reportValidity()) return;
    $$('[name]', f).forEach(function (i) { e[i.name] = i.value.trim(); });
    e.inspections = readInspectionEditor($('#detail-inspection-list'));
    if (e.inspections === null) return;
    applyManagerSnapshot(e);
    syncPrimaryInspection(e);
    ensureBuilding(e.building);
    if (persist()) { renderEquipment(); renderEquipmentDetail(); }
  }

  function saveDetailConsumable() {
    var e = detailEquipment(), f = $('#detail-consumable-form');
    if (!e || !f.reportValidity()) return;
    var o = { id: St.newId('c'), equipmentId: e.id };
    $$('[name]', f).forEach(function (i) { o[i.name] = i.value.trim(); });
    o.cycleMonths = Number(o.cycleMonths);
    o.cost = o.cost === '' ? null : Number(o.cost);
    db.consumables.push(o);
    if (persist()) { f.reset(); renderDetailConsumables(e); }
  }

  function renderDetailConsumables(e) {
    var list = St.forEquipment(db.consumables, e.id);
    $('#detail-consumables tbody').innerHTML = list.length ? list.map(function (c) {
      var r = S.nextReplacement(c.lastDate, c.cycleMonths, today());
      return '<tr><td><button class="btn small-btn" data-consumable-del="' + esc(c.id) + '">삭제</button></td>'
        + '<td>' + esc(c.name) + '</td><td class="num">' + esc(c.cycleMonths) + '개월</td>'
        + '<td class="mono">' + esc(c.lastDate || '—') + '</td><td class="mono">' + esc(r.nextText || '—') + '</td>'
        + '<td>' + badge(r.status) + '</td><td class="num">' + (c.cost === null ? '미상' : won(c.cost)) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="sub">등록된 소모품이 없습니다.</td></tr>';
    $$('#detail-consumables [data-consumable-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.consumables = db.consumables.filter(function (x) { return x.id !== b.getAttribute('data-consumable-del'); });
        if (persist()) renderDetailConsumables(e);
      });
    });
  }

  function saveDetailHistory() {
    var e = detailEquipment(), f = $('#detail-history-form');
    if (!e || !f.reportValidity()) return;
    var o = { id: St.newId('h'), equipmentId: e.id };
    $$('[name]', f).forEach(function (i) { o[i.name] = i.value.trim(); });
    o.cost = o.cost === '' ? null : Number(o.cost);
    db.history.push(o);
    applyCompletedHistory(o);
    if (persist()) {
      f.reset(); f.querySelector('[name=date]').value = today();
      syncHistoryConsumables(f, e.id);
      renderDetailHistory(e); renderDetailConsumables(e); renderEquipment();
    }
  }

  function renderDetailHistory(e) {
    var list = St.forEquipment(db.history, e.id).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    $('#detail-history tbody').innerHTML = list.length ? list.map(function (h) {
      return '<tr><td><button class="btn small-btn" data-history-del="' + esc(h.id) + '">삭제</button></td>'
        + '<td class="mono">' + esc(h.date) + '</td><td>' + esc(h.kind) + '</td><td>' + esc(h.memo) + '</td>'
        + '<td>' + esc(h.vendor) + '</td><td class="num">' + (h.cost === null ? '미상' : won(h.cost)) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="sub">등록된 이력이 없습니다.</td></tr>';
    $$('#detail-history [data-history-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.history = db.history.filter(function (x) { return x.id !== b.getAttribute('data-history-del'); });
        if (persist()) renderDetailHistory(e);
      });
    });
  }

  function saveDetailManual() {
    var e = detailEquipment(), f = $('#detail-manual-form');
    if (!e || !f.reportValidity()) return;
    var meta = {}; $$('[name]', f).forEach(function (i) { meta[i.name] = i.value.trim(); });
    /* change 이벤트 상태만 믿지 않고 실제 input의 File도 다시 읽는다.
     * 자동화 도구·보안 브라우저가 파일을 주입할 때 change 이벤트가 생략돼도 동작한다. */
    var inputFile = $('#manual-file').files && $('#manual-file').files[0];
    var manualFile = inputFile || selectedManualFile;
    if (manualFile) {
      addManualAndAnalyze(e, manualFile, meta.title, meta);
    } else {
      var o = Object.assign({ id: St.newId('m'), equipmentId: e.id, addedAt: new Date().toISOString(),
        storageStatus: '경로만 저장' }, meta);
      db.manuals.push(o);
      if (persist()) renderDetailManuals(e);
    }
    f.reset(); selectedManualFile = null; $('#manual-file').value = '';
    $('#manual-file-label').textContent = '파일 선택';
  }

  function readDocumentText(file) {
    if (!file) return Promise.resolve('');
    if (/\.pdf$/i.test(file.name)) return readPdf(file);
    if (/\.(xlsx?|csv)$/i.test(file.name)) return readSheet(file);
    if (/\.(txt|md|json|xml)$/i.test(file.name) || /^text\//.test(file.type || '')) return file.text();
    return Promise.resolve('');
  }

  function addManualAndAnalyze(e, file, title, meta) {
    var o = Object.assign({ id: St.newId('m'), equipmentId: e.id, addedAt: new Date().toISOString(),
      title: title || file.name, fileName: file.name, fileSize: file.size, fileType: file.type,
      fileLastModified: file.lastModified, storageStatus: '업로드·분석 중' }, meta || {});
    db.manuals.push(o); persist();
    function currentManual() {
      return db.manuals.find(function (m) { return m.id === o.id; }) || o;
    }
    if (detailEquipment() && detailEquipment().id === e.id) {
      $('#manual-status').innerHTML = '<div class="note">' + esc(file.name) + '을 업로드하고 분석하고 있습니다.</div>';
      renderDetailManuals(e);
    }
    /* 공유폴더 서버가 꺼져 있어도 브라우저 안의 문서 분석을 기다리게 하지 않는다.
     * 파일 저장과 본문 분석은 독립적으로 끝나며, 각각 끝나는 즉시 화면을 갱신한다. */
    I.upload(db.settings, e.id, '매뉴얼', file).then(function (upload) {
      var manual = currentManual();
      manual.storageStatus = upload.ok ? '공유폴더 저장 완료' : '브라우저 임시 저장';
      if (upload.ok) { manual.storagePath = upload.path; manual.filePath = upload.path; }
      persist();
      if (detailEquipment() && detailEquipment().id === e.id) renderDetailManuals(e);
    });

    readDocumentText(file).catch(function () { return ''; })
      .then(function (documentText) {
        var fallback = A.manual(documentText);
        if (!documentText) {
          fallback.warnings.push('이 형식은 원본 저장만 했습니다. PDF·TXT·CSV·엑셀 파일로 변환하면 본문 분석이 가능합니다.');
        }
        if (!documentText || db.settings.aiMode === 'rules') return { result: fallback };
        return I.analyze(db.settings, 'manual', e, documentText).then(function (ai) {
          var parsed = ai.ok && A.normalizeAi('manual', ai.result);
          return { result: parsed || fallback, provider: parsed ? ai.provider : 'rules' };
        });
      }).then(function (done) {
        var manual = currentManual();
        manual.analysis = done.result;
        manual.analysis.provider = done.provider || manual.analysis.provider || 'rules';
        manual.analyzedAt = new Date().toISOString();
        var savedAnalysis = { id: St.newId('a'), equipmentId: e.id, sourceId: manual.id,
          kind: 'manual', createdAt: manual.analyzedAt, result: manual.analysis };
        db.analysisResults.push(savedAnalysis); I.saveAnalysis(db.settings, savedAnalysis);
        persist();
        if (detailEquipment() && detailEquipment().id === e.id) {
          $('#manual-status').innerHTML = '<div class="ok">' + esc(manual.title) + ' — ' + esc(manual.storageStatus)
            + ' · 분석 완료</div>';
          renderDetailManuals(e);
        }
      }).catch(function (err) {
        var manual = currentManual();
        manual.storageStatus = '분석 실패'; manual.analysisError = err && err.message || String(err); persist();
        if ($('#manual-status')) $('#manual-status').innerHTML = '<div class="warn">분석하지 못했습니다: '
          + esc(manual.analysisError) + '</div>';
      });
  }

  function formatBytes(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function copyText(value) {
    var ta = document.createElement('textarea');
    ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (ignore) {}
    ta.remove();
  }

  function renderDetailManuals(e) {
    var list = St.forEquipment(db.manuals, e.id).slice();
    if (e.manual && !list.some(function (m) { return m.filePath === e.manual; })) {
      list.unshift({ id: '', title: '기존 매뉴얼 경로', filePath: e.manual, legacy: true });
    }
    $('#detail-manuals').innerHTML = list.length ? list.map(function (m) {
      var path = m.filePath || m.fileName || '경로/파일명 미입력';
      var meta = [m.version, m.fileName, formatBytes(m.fileSize), m.storageStatus, m.note].filter(Boolean).join(' · ');
      return '<li><div><b>' + esc(m.title) + '</b><div class="meta">' + esc(path) + '</div>'
        + (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + '</div><div class="btnrow" style="margin:0">'
        + '<button class="btn small-btn" data-copy-path="' + esc(path) + '">경로 복사</button>'
        + (m.legacy ? '' : '<button class="btn small-btn" data-manual-del="' + esc(m.id) + '">삭제</button>')
        + '</div></li>';
    }).join('') : '<li><span class="sub">등록된 매뉴얼이 없습니다.</span></li>';
    $$('#detail-manuals [data-copy-path]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.getAttribute('data-copy-path')); b.textContent = '복사됨'; });
    });
    $$('#detail-manuals [data-manual-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.manuals = db.manuals.filter(function (x) { return x.id !== b.getAttribute('data-manual-del'); });
        if (persist()) renderDetailManuals(e);
      });
    });

    var analyzed = list.filter(function (m) { return m.analysis; });
    $('#detail-manual-analysis').innerHTML = analyzed.map(function (m) {
      var a = m.analysis, proposals = [];
      (a.consumables || []).forEach(function (p, i) {
        proposals.push('<div class="proposal-item"><b>소모품 · ' + esc(p.name) + '</b><span>'
          + esc(p.cycleText || '주기 미확인') + '</span><span class="evidence">' + esc(p.evidence) + '</span>'
          + '<button class="btn small-btn" data-apply-manual-consumable="' + esc(m.id) + ':' + i + '">일정 등록</button></div>');
      });
      (a.inspections || []).forEach(function (p, i) {
        proposals.push('<div class="proposal-item"><b>검사 · ' + esc(p.name) + '</b><span>'
          + esc(p.cycleText || '주기 미확인') + '</span><span class="evidence">' + esc(p.evidence) + '</span>'
          + '<button class="btn small-btn" data-apply-manual-inspection="' + esc(m.id) + ':' + i + '">검사주기 반영</button></div>');
      });
      return '<section class="analysis-card"><h4>' + esc(m.title) + ' 분석 요약 <span class="sub">(' + esc(a.provider || 'rules')
        + ')</span></h4><p>' + esc(a.summary || '요약 없음') + '</p>'
        + ((a.warnings || []).length ? '<div class="security-note">' + esc(a.warnings.join(' · ')) + '</div>' : '')
        + '<div class="proposal-list">' + (proposals.join('') || '<span class="sub">추출된 교체·검사주기가 없습니다.</span>') + '</div></section>';
    }).join('');
    $$('[data-apply-manual-consumable]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-apply-manual-consumable').split(':'), manual = db.manuals.find(function (m) { return m.id === parts[0]; });
        var p = manual && manual.analysis && manual.analysis.consumables[Number(parts[1])];
        if (!p || !p.cycleMonths) { alert('개월 단위로 확인된 주기가 없습니다. 근거를 확인해 직접 입력하세요.'); return; }
        db.consumables.push({ id: St.newId('c'), equipmentId: e.id, name: p.name,
          cycleMonths: Number(p.cycleMonths), lastDate: '', cost: null, note: '매뉴얼 분석 제안 · ' + p.evidence });
        if (persist()) { renderDetailConsumables(e); b.textContent = '등록됨'; b.disabled = true; }
      });
    });
    $$('[data-apply-manual-inspection]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-apply-manual-inspection').split(':'), manual = db.manuals.find(function (m) { return m.id === parts[0]; });
        var p = manual && manual.analysis && manual.analysis.inspections[Number(parts[1])];
        if (!p || !p.cycleMonths) { alert('개월 단위로 확인된 검사주기가 없습니다. 근거를 확인해 직접 입력하세요.'); return; }
        e.inspections = inspectionsOf(e).slice();
        e.inspections.push({ id: St.newId('i'), name: p.name || '매뉴얼 제안 검사',
          lastDate: '', cycleMonths: Number(p.cycleMonths), cost: null });
        syncPrimaryInspection(e);
        if (persist()) { renderDetailBasic(e); renderEquipment(); b.textContent = '반영됨'; b.disabled = true; }
      });
    });
  }

  function saveDetailLaw() {
    var e = detailEquipment(), f = $('#detail-law-form');
    if (!e || !f.reportValidity()) return;
    var o = { id: St.newId('l'), equipmentId: e.id };
    $$('[name]', f).forEach(function (i) {
      o[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    o.needsReview = o.sourceStatus !== '충족';
    db.lawReviews.push(o);
    if (persist()) {
      f.reset(); f.querySelector('[name=checkedAt]').value = today();
      f.querySelector('[name=reviewer]').value = db.settings.syncActor || '';
      renderDetailLaws(e); renderEquipment();
    }
  }

  function saveLawCandidate(e, candidate) {
    var existing = St.forEquipment(db.lawDocuments, e.id).find(function (d) { return d.law === candidate.law; });
    var doc = existing || { id: St.newId('ld'), equipmentId: e.id, law: candidate.law,
      about: candidate.about, basis: candidate.basis, missing: candidate.missing,
      sourceUrl: L.SEARCH + encodeURIComponent(candidate.law), content: '', addedAt: new Date().toISOString() };
    if (!existing) db.lawDocuments.push(doc);
    currentLawDocumentId = doc.id;
    $('#detail-law-form [name=law]').value = doc.law;
    $('#detail-law-document-form [name=law]').value = doc.law;
    $('#detail-law-document-form [name=about]').value = doc.about || '';
    $('#detail-law-document-form [name=sourceUrl]').value = doc.sourceUrl || '';
    $('#detail-law-document-form [name=effectiveDate]').value = doc.effectiveDate || '';
    $('#detail-law-document-form [name=content]').value = doc.content || '';
    persist(); renderDetailLaws(e);
    I.saveLaw(db.settings, doc).then(function (r) {
      doc.serverStored = !!r.ok; if (r.ok) persist();
      if (r.ok && db.settings.lawApiOc) {
        I.importLaw(db.settings, doc).then(function (found) {
          if (!found.ok || !found.document) return;
          var previous = JSON.parse(JSON.stringify(doc));
          Object.assign(doc, found.document, { serverStored: true, importedAt: new Date().toISOString() });
          recordLawUpdate(e, previous, doc, '국가법령정보센터 API');
          persist(); renderDetailLaws(e);
        });
      }
    });
  }

  function selectLawDocument(e, id) {
    var doc = db.lawDocuments.find(function (d) { return d.id === id && d.equipmentId === e.id; });
    if (!doc) return;
    currentLawDocumentId = id;
    $('#detail-law-document-form [name=law]').value = doc.law;
    $('#detail-law-document-form [name=about]').value = doc.about || '';
    $('#detail-law-document-form [name=sourceUrl]').value = doc.sourceUrl || '';
    $('#detail-law-document-form [name=effectiveDate]').value = doc.effectiveDate || '';
    $('#detail-law-document-form [name=content]').value = doc.content || '';
    $('#detail-law-form [name=law]').value = doc.law;
    renderDetailLaws(e);
  }

  function newLawDocumentForm() {
    currentLawDocumentId = null; selectedLawFile = null;
    $('#detail-law-document-form').reset(); $('#law-file').value = '';
    $('#law-file-label').textContent = '파일 선택';
    $('#detail-law-document-status').innerHTML = '<div class="status-line good">새 연관법령을 입력할 수 있습니다.</div>';
    renderDetailLaws(detailEquipment());
    $('#detail-law-document-form [name=law]').focus();
  }

  function saveLawDocumentContent() {
    var e = detailEquipment(), f = $('#detail-law-document-form');
    if (!e || !f.reportValidity()) return;
    var lawName = f.querySelector('[name=law]').value.trim();
    var sourceUrl = f.querySelector('[name=sourceUrl]').value.trim();
    if (sourceUrl && !safeHttpUrl(sourceUrl)) { alert('출처 URL은 http:// 또는 https:// 주소로 입력하세요.'); return; }
    var doc = db.lawDocuments.find(function (d) { return d.id === currentLawDocumentId && d.equipmentId === e.id; });
    if (!doc) {
      doc = St.forEquipment(db.lawDocuments, e.id).find(function (d) { return d.law === lawName; })
        || { id: St.newId('ld'), equipmentId: e.id, addedAt: new Date().toISOString() };
    }
    var previous = JSON.parse(JSON.stringify(doc));
    var finish = function (content) {
      doc.law = lawName;
      doc.about = f.querySelector('[name=about]').value.trim();
      doc.sourceUrl = safeHttpUrl(sourceUrl);
      doc.effectiveDate = f.querySelector('[name=effectiveDate]').value;
      doc.content = String(content || f.querySelector('[name=content]').value || '').trim();
      doc.updatedAt = new Date().toISOString();
      if (selectedLawFile) { doc.fileName = selectedLawFile.name; doc.fileSize = selectedLawFile.size; }
      if (!db.lawDocuments.some(function (d) { return d.id === doc.id; })) db.lawDocuments.push(doc);
      var change = recordLawUpdate(e, previous, doc, selectedLawFile ? '법령 파일 업로드' : '직접 입력');
      currentLawDocumentId = doc.id; $('#detail-law-form [name=law]').value = doc.law;
      persist(); I.saveLaw(db.settings, doc); selectedLawFile = null; $('#law-file').value = '';
      $('#law-file-label').textContent = '파일 선택';
      $('#detail-law-document-status').innerHTML = '<div class="status-line good">“' + esc(doc.law)
        + '”을 이 설비의 연관법령으로 저장했습니다.'
        + (change ? ' 이전 원문과 다른 내용을 변경 이력에 추가했습니다.' : '') + '</div>';
      renderDetailLaws(e);
    };
    if (selectedLawFile) {
      Promise.all([readDocumentText(selectedLawFile), I.upload(db.settings, e.id, '법령', selectedLawFile)])
        .then(function (values) {
          if (values[1].ok) doc.filePath = values[1].path;
          finish(values[0] || f.querySelector('[name=content]').value);
        });
    } else finish(f.querySelector('[name=content]').value);
  }

  function lawVersion(doc, source) {
    var content = String(doc && doc.content || '').trim();
    if (!content) return null;
    var same = (db.lawVersions || []).find(function (v) {
      return v.lawDocumentId === doc.id && v.content === content
        && (v.effectiveDate || '') === (doc.effectiveDate || '');
    });
    if (same) return same;
    var version = { id: St.newId('lv'), lawDocumentId: doc.id, equipmentId: doc.equipmentId,
      law: doc.law, effectiveDate: doc.effectiveDate || '', content: content,
      source: source || '저장', capturedAt: new Date().toISOString(), sourceUrl: doc.sourceUrl || '',
      fileName: doc.fileName || '' };
    db.lawVersions.push(version);
    return version;
  }

  function recordLawUpdate(e, previous, current, source) {
    var before = String(previous && previous.content || '').trim();
    var after = String(current && current.content || '').trim();
    var oldVersion = before ? lawVersion(previous, source + ' 변경 전') : null;
    var newVersion = after ? lawVersion(current, source) : null;
    if (!before || !after || before === after) return null;
    var diff = A.lawDiff(before, after);
    if (!diff.changed) return null;
    var duplicate = (db.lawChanges || []).find(function (c) {
      return c.lawDocumentId === current.id && c.previousVersionId === oldVersion.id
        && c.currentVersionId === newVersion.id;
    });
    if (duplicate) return duplicate;
    var change = { id: St.newId('lc'), lawDocumentId: current.id, equipmentId: current.equipmentId,
      law: current.law, previousVersionId: oldVersion.id, currentVersionId: newVersion.id,
      previousEffectiveDate: previous.effectiveDate || '', currentEffectiveDate: current.effectiveDate || '',
      detectedAt: new Date().toISOString(), source: source, status: '검토 대기',
      diff: diff, missingFields: A.missingLawSpecs(e, after) };
    db.lawChanges.push(change);
    return change;
  }

  function monitorSavedLaws() {
    var e = detailEquipment(), docs = St.forEquipment(db.lawDocuments, currentDetailEquipmentId);
    if (!e || !docs.length) { alert('먼저 관련 법령을 내부 DB에 저장하세요.'); return; }
    var box = $('#detail-law-document-status');
    if (!serverConfigured()) {
      box.innerHTML = '<div class="status-line bad">사내 서버가 연결되지 않았습니다. 최신 법령 파일을 선택하거나 원문을 붙여넣은 뒤 저장하면 기존 버전과 비교합니다.</div>';
      return;
    }
    box.innerHTML = '<div class="status-line">저장된 법령 ' + docs.length + '건의 최신본을 각각 확인하고 있습니다.</div>';
    Promise.all(docs.map(function (doc) {
      var previous = JSON.parse(JSON.stringify(doc));
      return I.importLaw(db.settings, doc).then(function (found) {
        if (!found.ok || !found.document) return { ok: false, law: doc.law, error: found.error || found.message || '확인 실패' };
        Object.assign(doc, found.document, { serverStored: true, importedAt: new Date().toISOString() });
        return { ok: true, law: doc.law, change: recordLawUpdate(e, previous, doc, '국가법령정보센터 API') };
      });
    })).then(function (results) {
      var checked = results.filter(function (r) { return r.ok; }).length;
      var changed = results.filter(function (r) { return r.change; }).length;
      var failed = results.filter(function (r) { return !r.ok; });
      persist(); renderDetailLaws(e);
      box.innerHTML = '<div class="status-line ' + (failed.length ? 'bad' : 'good') + '">'
        + checked + '건 확인 · ' + changed + '건 변경 감지'
        + (failed.length ? ' · 실패: ' + esc(failed.map(function (r) { return r.law; }).join(', '))
          + '. API 인증이 없거나 보안망에서 차단되면 최신 파일 업로드/붙여넣기로 비교하세요.' : '') + '</div>';
    });
  }

  function queueLawChange(e, change) {
    var key = '법령개정|' + change.id;
    var existing = db.notificationQueue.find(function (n) { return n.key === key && n.status !== '취소'; });
    if (existing) { alert('이미 알림 승인 대기함에 등록되어 있습니다.'); return; }
    var missing = (change.missingFields || []).join(', ');
    db.notificationQueue.push({ id: St.newId('n'), key: key, type: '법령 개정', sourceId: change.id,
      equipmentId: e.id, item: change.law + ' 변경 검토', dueDate: today(),
      recipientName: e.mgr || '', recipientEmail: e.mgrEmail || '',
      subject: '[법령 개정] ' + (e.name || '설비') + ' · ' + change.law + ' 검토 요청',
      body: (e.name || '설비') + '에 연결된 ' + change.law + ' 최신본에서 변경이 감지되었습니다.\n'
        + change.diff.summary + (missing ? '\n추가 입력 요청 사양: ' + missing : '')
        + '\n시스템에서 변경 원문과 설비 사양을 확인해 주세요.',
      status: '대기', createdAt: new Date().toISOString() });
    if (persist()) { alert('알림 승인 대기함에 추가했습니다. 담당자 승인 전에는 메일이 발송되지 않습니다.'); renderDetailLaws(e); }
  }

  function showLawChange(change) {
    $('#law-change-title').textContent = change.law + ' 변경 내용';
    var diff = change.diff || { added: [], removed: [] };
    $('#law-change-full').innerHTML = '<p class="sub">문장 단위 단순 비교 결과입니다. 법적 의미는 담당자가 원문으로 최종 확인해야 합니다.</p>'
      + '<div class="law-change-sections"><section><h3>최신본에 추가된 문장</h3><ul>'
      + ((diff.added || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') || '<li>없음</li>')
      + '</ul></section><section><h3>이전본에만 있던 문장</h3><ul>'
      + ((diff.removed || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') || '<li>없음</li>')
      + '</ul></section></div>';
    var dialog = $('#law-change-dialog');
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function runLawReview() {
    var e = detailEquipment(), docs = St.forEquipment(db.lawDocuments, currentDetailEquipmentId);
    if (!e || !docs.length) { alert('먼저 관련 법령을 내부 DB에 저장하세요.'); return; }
    var fallback = A.law(e, docs);
    var text = docs.map(function (d) { return d.law + '\n' + (d.content || d.about || ''); }).join('\n\n');
    $('#detail-law-comparison').innerHTML = '<div class="note">저장된 법령과 설비 사양을 비교하고 있습니다.</div>';
    var job = db.settings.aiMode === 'rules' ? Promise.resolve({ result: fallback, provider: 'rules' })
      : I.analyze(db.settings, 'law', e, text).then(function (ai) {
          var parsed = ai.ok && A.normalizeAi('law', ai.result);
          return { result: parsed || fallback, provider: parsed ? ai.provider : 'rules' };
        });
    job.then(function (done) {
      done.result.provider = done.provider || done.result.provider || 'rules';
      done.result.rows = A.enrichLawRows(e, done.result.rows || []).map(function (row) {
        if (row.sourceId) return row;
        var doc = docs.find(function (d) { return d.law === row.law; });
        if (doc) row.sourceId = doc.id;
        return row;
      });
      var saved = { id: St.newId('a'), equipmentId: e.id, kind: 'law', createdAt: new Date().toISOString(),
        sourceIds: docs.map(function (d) { return d.id; }), result: done.result };
      db.analysisResults.push(saved); persist(); I.saveAnalysis(db.settings, saved); renderLawComparison(saved.result);
    });
  }

  function renderLawComparison(result) {
    var box = $('#detail-law-comparison'); if (!box) return;
    var rows = result && result.rows || [];
    box.innerHTML = '<section class="analysis-card"><h4>설비 사양 비교 검토표 <span class="sub">('
      + esc(result && result.provider || 'rules') + ')</span></h4>'
      + '<p class="sub">' + esc(result && result.warning || '자동 결과는 참고용이며 담당자의 최종 확인이 필요합니다.') + '</p>'
      + '<div class="tablewrap"><table class="comparison-table"><thead><tr><th>법령</th><th>법령 요구사항</th><th>설비 입력값</th><th>결과</th><th>근거</th><th>조치사항</th><th>검토기록</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (r, i) {
          return '<tr><td>' + esc(r.law) + '</td><td>' + esc(r.requirementDetail || r.requirement) + '</td><td><b>'
            + esc(r.equipmentField) + '</b><br>' + esc(r.equipmentValue) + '</td><td>' + esc(r.status)
            + '</td><td>' + esc(r.evidence) + '</td><td>' + esc(r.action) + '</td><td><button class="btn primary small-btn" data-law-review-row="'
            + i + '">검토기록에 반영</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="sub">비교할 법령 원문이 없습니다.</td></tr>')
      + '</tbody></table></div></section>';
    $$('#detail-law-comparison [data-law-review-row]').forEach(function (b) {
      b.addEventListener('click', function () {
        fillLawReviewFromRow(rows[Number(b.getAttribute('data-law-review-row'))]);
      });
    });
  }

  function fillLawReviewFromRow(row) {
    var e = detailEquipment(), f = $('#detail-law-form');
    if (!e || !row || !f) return;
    var docs = St.forEquipment(db.lawDocuments, e.id);
    var doc = docs.find(function (d) { return d.id === row.sourceId; })
      || docs.find(function (d) { return d.law === row.law; });
    f.reset();
    f.querySelector('[name=law]').value = row.law || (doc && doc.law) || '';
    f.querySelector('[name=requirement]').value = row.requirementDetail || row.requirement || '';
    f.querySelector('[name=checkedAt]').value = today();
    f.querySelector('[name=reviewer]').value = db.settings.syncActor || '';
    f.querySelector('[name=filePath]').value = doc && doc.filePath || '';
    f.querySelector('[name=sourceStatus]').value = row.status || '확인 필요';
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f.querySelector('[name=reviewResult]').focus();
  }

  function renderDetailLaws(e) {
    var candidates = L.lawsForEquipment(e);
    $('#detail-law-candidates').innerHTML = candidates.length
      ? '<div class="candidate-grid">' + candidates.map(function (c, i) {
          return '<article class="law-candidate"><h4>' + esc(c.law) + '</h4><p>' + esc(c.about) + '</p>'
            + '<p><b>검토 입력값:</b> ' + esc(c.basis || '사양 미입력') + '</p>'
            + (c.missing.length ? '<p>추가 확인 권장: ' + esc(c.missing.join(', ')) + '</p>' : '')
            + '<div class="btnrow"><a class="btn small-btn" href="' + esc(L.SEARCH + encodeURIComponent(c.law))
            + '" target="_blank" rel="noopener">법령 확인</a>'
            + '<button class="btn primary small-btn" data-law-candidate="' + i + '">내부 DB에 저장</button></div></article>';
        }).join('') + '</div>'
      : '<div class="note">이 설비 종류에 등록된 법령 후보가 없습니다. 사내 법령 자료를 확인한 뒤 아래에 직접 기록하세요.</div>';
    $$('#detail-law-candidates [data-law-candidate]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = candidates[Number(b.getAttribute('data-law-candidate'))];
        if (c) saveLawCandidate(e, c);
      });
    });

    var docs = St.forEquipment(db.lawDocuments, e.id);
    $('#detail-law-documents').innerHTML = docs.length ? '<div class="law-document-grid">' + docs.map(function (d) {
      var source = safeHttpUrl(d.sourceUrl);
      var versions = (db.lawVersions || []).filter(function (v) { return v.lawDocumentId === d.id; }).length;
      return '<article class="law-document' + (d.id === currentLawDocumentId ? ' selected' : '') + '"><h4>'
        + esc(d.law) + '</h4><p>' + esc(d.about || '') + '</p><p>'
        + (d.content ? '원문/조항 ' + d.content.length.toLocaleString('ko-KR') + '자 저장' : '원문 미저장')
        + (d.effectiveDate ? ' · 기준일 ' + esc(d.effectiveDate) : '')
        + (versions ? ' · 보존본 ' + versions + '개' : '') + '</p><div class="btnrow">'
        + (source ? '<a class="btn small-btn" href="' + esc(source) + '" target="_blank" rel="noopener">출처 확인</a>' : '')
        + '<button class="btn small-btn" data-law-doc-select="' + esc(d.id) + '">선택·수정</button>'
        + '<button class="btn small-btn" data-law-doc-del="' + esc(d.id) + '">삭제</button></div></article>';
    }).join('') + '</div>' : '<p class="sub">내부 DB에 저장한 법령이 없습니다.</p>';
    $$('[data-law-doc-select]').forEach(function (b) {
      b.addEventListener('click', function () { selectLawDocument(e, b.getAttribute('data-law-doc-select')); });
    });
    $$('[data-law-doc-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-law-doc-del');
        db.lawDocuments = db.lawDocuments.filter(function (d) { return d.id !== id; });
        db.lawVersions = db.lawVersions.filter(function (v) { return v.lawDocumentId !== id; });
        db.lawChanges = db.lawChanges.filter(function (c) { return c.lawDocumentId !== id; });
        if (currentLawDocumentId === id) { currentLawDocumentId = null; $('#detail-law-document-form').reset(); }
        if (persist()) renderDetailLaws(e);
      });
    });

    var changes = St.forEquipment(db.lawChanges, e.id).sort(function (a, b) {
      return a.detectedAt < b.detectedAt ? 1 : -1;
    });
    $('#detail-law-changes').innerHTML = changes.length
      ? '<h3 class="detail-subtitle">법령 변경 이력</h3><div class="law-change-list">' + changes.map(function (c) {
          var missing = c.missingFields || [];
          var queued = db.notificationQueue.some(function (n) { return n.key === '법령개정|' + c.id && n.status !== '취소'; });
          return '<article class="law-change-card' + (c.status === '검토 완료' ? ' reviewed' : '') + '"><h4>'
            + esc(c.law) + ' · ' + esc(c.status) + '</h4><p>' + esc(c.diff && c.diff.summary || '변경 내용 확인 필요') + '</p>'
            + '<p><b>감지:</b> ' + esc(String(c.detectedAt || '').slice(0, 10))
            + (c.currentEffectiveDate ? ' · <b>최신 시행일:</b> ' + esc(c.currentEffectiveDate) : '') + '</p>'
            + '<p><b>추가 입력 요청:</b> ' + esc(missing.length ? missing.join(', ') : '없음') + '</p><div class="btnrow">'
            + '<button class="btn small-btn" data-law-change-view="' + esc(c.id) + '">변경내용 보기</button>'
            + '<button class="btn small-btn" data-law-change-compare="' + esc(c.id) + '">설비 사양 비교</button>'
            + '<button class="btn small-btn" data-law-change-notify="' + esc(c.id) + '"' + (queued ? ' disabled' : '') + '>'
            + (queued ? '알림 등록됨' : '알림 대기함에 추가') + '</button>'
            + (c.status === '검토 완료' ? '' : '<button class="btn green small-btn" data-law-change-done="' + esc(c.id) + '">검토 완료</button>')
            + '</div></article>';
        }).join('') + '</div>' : '';
    $$('[data-law-change-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        var change = changes.find(function (c) { return c.id === b.getAttribute('data-law-change-view'); });
        if (change) showLawChange(change);
      });
    });
    $$('[data-law-change-compare]').forEach(function (b) {
      b.addEventListener('click', function () { runLawReview(); });
    });
    $$('[data-law-change-notify]').forEach(function (b) {
      b.addEventListener('click', function () {
        var change = changes.find(function (c) { return c.id === b.getAttribute('data-law-change-notify'); });
        if (change) queueLawChange(e, change);
      });
    });
    $$('[data-law-change-done]').forEach(function (b) {
      b.addEventListener('click', function () {
        var change = changes.find(function (c) { return c.id === b.getAttribute('data-law-change-done'); });
        if (!change) return;
        change.status = '검토 완료'; change.reviewedAt = new Date().toISOString();
        change.reviewedBy = db.settings.syncActor || '미지정 사용자'; e.lawCheckedAt = today();
        if (persist()) { renderDetailLaws(e); renderEquipment(); }
      });
    });

    var latestComparison = St.forEquipment(db.analysisResults, e.id).filter(function (a) { return a.kind === 'law'; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0];
    if (latestComparison) renderLawComparison(latestComparison.result);
    else $('#detail-law-comparison').innerHTML = '';

    var list = St.forEquipment(db.lawReviews, e.id).sort(function (a, b) { return a.checkedAt < b.checkedAt ? 1 : -1; });
    $('#detail-laws tbody').innerHTML = list.length ? list.map(function (r) {
      var requirement = r.requirement || '';
      return '<tr><td><button class="btn small-btn" data-law-del="' + esc(r.id) + '">삭제</button></td>'
        + '<td>' + esc(r.law) + '</td><td><span class="law-summary">' + esc(summarize(requirement, 72)) + '</span>'
        + (requirement ? '<button class="btn small-btn law-full-button" data-law-full="' + esc(r.id) + '">전체 글보기</button>' : '')
        + '</td><td class="review-result-cell">' + esc(r.reviewResult || r.note || '') + '</td>'
        + '<td class="mono">' + esc(r.checkedAt) + '</td><td>' + esc(r.reviewer) + '</td>'
        + '<td>' + (r.needsReview ? '<b style="color:var(--warn)">필요</b>' : '완료') + '</td>'
        + '<td class="review-path" title="' + esc(r.filePath) + '">' + esc(r.filePath) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="sub">저장된 법령 검토 기록이 없습니다.</td></tr>';
    $$('#detail-laws [data-law-full]').forEach(function (b) {
      b.addEventListener('click', function () {
        var record = list.find(function (r) { return r.id === b.getAttribute('data-law-full'); });
        if (!record) return;
        $('#law-requirement-title').textContent = (record.law || '법령') + ' 요구사항';
        $('#law-requirement-full').textContent = record.requirement || '저장된 요구사항이 없습니다.';
        var dialog = $('#law-requirement-dialog');
        if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      });
    });
    $$('#detail-laws [data-law-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.lawReviews = db.lawReviews.filter(function (x) { return x.id !== b.getAttribute('data-law-del'); });
        if (persist()) { renderDetailLaws(e); renderEquipment(); }
      });
    });
  }

  /* ═══════════════════════════════════════════════ 담당자 통합 대장 */

  function managerRoleText(role) {
    return { legal: '법정선임', maintenance: '유지관리', both: '법정선임·유지관리' }[role] || role;
  }

  function managerAssignmentCount(id) {
    return db.equipments.filter(function (e) {
      return e.legalManagerId === id || e.maintenanceManagerId === id;
    }).length;
  }

  function clearManagerForm() { $('#manager-form').reset(); $('#manager-form [name=id]').value = ''; }

  function initManagers() {
    $('#manager-save').addEventListener('click', function () {
      var form = $('#manager-form'); if (!form.reportValidity()) return;
      var value = {}; $$('[name]', form).forEach(function (i) { value[i.name] = i.value.trim(); });
      value.active = value.active === 'true';
      if (value.id) {
        var current = managerById(value.id); if (!current) return;
        var usedAsLegal = db.equipments.some(function (e) { return e.legalManagerId === value.id; });
        var usedAsMaintenance = db.equipments.some(function (e) { return e.maintenanceManagerId === value.id; });
        if ((usedAsLegal && value.role === 'maintenance') || (usedAsMaintenance && value.role === 'legal')) {
          alert('현재 연결된 설비의 담당 구분과 맞지 않습니다. 설비 담당자를 먼저 변경하거나 “겸임”을 선택하세요.');
          return;
        }
        Object.assign(current, value);
      } else {
        value.id = St.newId('mgr'); db.managers.push(value);
      }
      db.equipments.forEach(function (e) {
        if (e.legalManagerId === value.id || e.maintenanceManagerId === value.id) applyManagerSnapshot(e);
      });
      if (persist()) { clearManagerForm(); renderManagers(); }
    });
    $('#manager-clear').addEventListener('click', clearManagerForm);
    renderManagers();
  }

  function renderManagers() {
    var list = (db.managers || []).slice().sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
    var active = list.filter(function (m) { return m.active !== false; }).length;
    $('#manager-stats').innerHTML = [
      ['전체 담당자', list.length + '명'], ['재직·담당 중', active + '명'],
      ['연결된 설비', db.equipments.filter(function (e) { return e.legalManagerId || e.maintenanceManagerId; }).length + '건']
    ].map(function (x) { return '<div class="stat">' + esc(x[0]) + '<b>' + esc(x[1]) + '</b></div>'; }).join('');
    $('#manager-table tbody').innerHTML = list.length ? list.map(function (m) {
      return '<tr><td><div class="btnrow" style="margin:0"><button class="btn small-btn" data-manager-edit="' + esc(m.id)
        + '">수정</button><button class="btn small-btn" data-manager-del="' + esc(m.id) + '">삭제</button></div></td>'
        + '<td>' + esc(managerRoleText(m.role)) + '</td><td><b>' + esc(m.name) + '</b></td><td>' + esc(m.department)
        + '</td><td>' + esc(m.phone) + '</td><td>' + esc(m.email) + '</td><td class="num">'
        + managerAssignmentCount(m.id) + '건</td><td>' + (m.active === false ? '<span class="sub">담당 해제</span>' : '담당 중') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="sub">등록된 담당자가 없습니다.</td></tr>';
    $$('[data-manager-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = managerById(b.getAttribute('data-manager-edit')); if (!m) return;
        $$('[name]', $('#manager-form')).forEach(function (i) {
          i.value = i.name === 'active' ? String(m.active !== false) : (m[i.name] == null ? '' : m[i.name]);
        });
        $('#manager-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    $$('[data-manager-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-manager-del'), m = managerById(id), assigned = managerAssignmentCount(id);
        if (assigned) { alert('이 담당자는 설비 ' + assigned + '건에 연결되어 있습니다. 먼저 담당 설비를 변경하세요.'); return; }
        if (!m || !confirm('“' + m.name + '” 담당자를 삭제할까요?')) return;
        db.managers = db.managers.filter(function (x) { return x.id !== id; });
        if (persist()) renderManagers();
      });
    });
  }

  /* ═══════════════════════════════════════════════════ 알림 */

  function initAlerts() {
    $('#today').value = today();
    ['#today', '#lead-inspect', '#lead-replace'].forEach(function (s) {
      $(s).addEventListener('change', renderAlerts);
      $(s).addEventListener('input', renderAlerts);
    });
    $('#make-mail').addEventListener('click', makeMail);
    $('#queue-alerts').addEventListener('click', queueCurrentAlerts);
    $('#copy-mail').addEventListener('click', function () {
      var ta = $('#mail-body');
      ta.select();
      try { document.execCommand('copy'); this.textContent = '복사됨'; }
      catch (e) { alert('복사하지 못했습니다. 직접 선택해 복사하세요.'); }
      var b = this;
      setTimeout(function () { b.textContent = '복사'; }, 1600);
    });
    renderAlerts(); renderNotificationQueue();
  }

  function leads() {
    return { t: $('#today').value || today(),
             i: Number($('#lead-inspect').value) || 30,
             r: Number($('#lead-replace').value) || 14 };
  }

  function renderAlerts() {
    var p = leads();
    var due = allDue(p.t, p.i, p.r);
    var over = due.filter(function (d) { return d.r.status === '기한 초과'; }).length;
    var soon = due.filter(function (d) { return d.r.status === '알림' || d.r.status === '오늘'; }).length;
    var unk = due.filter(function (d) { return d.r.next === null; }).length;
    $('#alert-stats').innerHTML =
        '<div class="stat">기한 초과<b style="color:var(--danger)">' + over + '건</b></div>'
      + '<div class="stat">임박<b style="color:var(--warn)">' + soon + '건</b></div>'
      + '<div class="stat">알 수 없음<b>' + unk + '건</b></div>';

    var inspectionRows = [];
    db.equipments.forEach(function (e) {
      var items = inspectionsOf(e);
      if (!items.length) items = [{ name: '정기검사', lastDate: '', cycleMonths: null }];
      items.forEach(function (inspection) {
      var r = S.nextInspection(inspection.lastDate, inspection.cycleMonths, p.t, p.i);
      inspectionRows.push('<tr' + (r.status === '기한 초과' ? ' class="flag"' : '') + '>'
        + '<td class="mono">' + esc(e.code) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.kind) + '</td>'
        + '<td class="mono">' + esc(inspection.lastDate || '—') + '<div class="sub">' + esc(inspection.name || '정기검사') + '</div></td>'
        + '<td class="num">' + (inspection.cycleMonths ? inspection.cycleMonths + '개월' : '—') + '</td>'
        + '<td class="mono">' + esc(r.nextText || '—') + '</td>'
        + '<td class="num">' + (r.dday === null ? '—' : r.dday + '일') + '</td>'
        + '<td>' + badge(r.status) + (r.why ? '<div class="sub" style="white-space:normal">' + esc(r.why) + '</div>' : '') + '</td>'
        + '<td>' + esc(e.mgr) + '</td></tr>');
      });
    });
    $('#insp tbody').innerHTML = inspectionRows.length ? inspectionRows.join('') : '<tr><td colspan="9" class="sub">등록된 설비가 없습니다.</td></tr>';

    $('#cons tbody').innerHTML = db.consumables.length ? db.consumables.map(function (c) {
      var r = S.nextReplacement(c.lastDate, c.cycleMonths, p.t, p.r);
      return '<tr' + (r.status === '기한 초과' ? ' class="flag"' : '') + '>'
        + '<td>' + esc(eqName(c.equipmentId)) + '</td><td>' + esc(c.name) + '</td>'
        + '<td class="mono">' + esc(c.lastDate || '—') + '</td>'
        + '<td class="num">' + (c.cycleMonths ? c.cycleMonths + '개월' : '—') + '</td>'
        + '<td class="mono">' + esc(r.nextText || '—') + '</td>'
        + '<td class="num">' + (r.dday === null ? '—' : r.dday + '일') + '</td>'
        + '<td>' + badge(r.status) + '</td>'
        + '<td class="num">' + won(c.cost) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="sub">등록된 소모품이 없습니다. 예시 자료를 넣어 보세요.</td></tr>';
  }

  /** 메일 문안 — 사람이 복사해 보낸다 */
  function makeMail() {
    var p = leads();
    var due = allDue(p.t, p.i, p.r).filter(function (d) {
      return d.r.status === '기한 초과' || d.r.status === '알림' || d.r.status === '오늘';
    });
    if (!due.length) {
      $('#mail-body').hidden = true;
      $('#copy-mail').disabled = true;
      alert('지금 알릴 항목이 없습니다.');
      return;
    }
    // 유지관리자별로 묶는다 — 한 사람에게 자기 것만 보내야 한다
    var byMgr = {};
    due.forEach(function (d) {
      var who = (d.eq && d.eq.mgr) || '(담당자 미지정)';
      (byMgr[who] = byMgr[who] || []).push(d);
    });
    var text = Object.keys(byMgr).map(function (who) {
      var e0 = byMgr[who][0].eq;
      var mail = (e0 && e0.mgrEmail) ? ' <' + e0.mgrEmail + '>' : '';
      return '받는 사람: ' + who + mail + '\n'
        + '제목: [설비] 점검·교체 예정 안내 (' + p.t + ' 기준)\n\n'
        + byMgr[who].map(function (d) {
            return '· ' + (d.eq ? d.eq.name : '(설비 없음)') + ' / ' + d.item
              + '\n   기한 ' + d.r.nextText + ' (' + (d.r.dday < 0 ? Math.abs(d.r.dday) + '일 지남' : d.r.dday + '일 남음') + ')'
              + (d.eq && d.eq.place ? '\n   위치 ' + d.eq.place : '');
          }).join('\n')
        + '\n\n확인 후 일정 조율 부탁드립니다.';
    }).join('\n\n' + '─'.repeat(46) + '\n\n');

    var ta = $('#mail-body');
    ta.value = text;
    ta.hidden = false;
    $('#copy-mail').disabled = false;
  }

  function notificationKey(d) {
    return [d.type, d.sourceId, d.r.nextText || '기한미상'].join('|');
  }

  function notificationText(d, 기준일) {
    var eq = d.eq, remaining = d.r.dday < 0 ? Math.abs(d.r.dday) + '일 지남' : d.r.dday + '일 남음';
    return '안녕하세요. ' + ((eq && eq.mgr) || '유지관리 담당자') + '님.\n\n'
      + '다음 설비의 ' + d.item + ' 일정이 도래하여 안내드립니다.\n\n'
      + '· 설비: ' + (eq ? ((eq.code ? eq.code + ' ' : '') + eq.name) : '(설비 없음)') + '\n'
      + '· 구분: ' + d.type + '\n· 예정일: ' + d.r.nextText + ' (' + remaining + ')\n'
      + (eq && (eq.place || eq.building) ? '· 위치: ' + (eq.place || eq.building) + '\n' : '')
      + '\n' + 기준일 + ' 기준 안내입니다. 확인 후 일정을 조율해 주세요.';
  }

  function queueCurrentAlerts() {
    var p = leads(), added = 0, skipped = 0;
    var due = allDue(p.t, p.i, p.r).filter(function (d) {
      return d.r.status === '기한 초과' || d.r.status === '알림' || d.r.status === '오늘';
    });
    due.forEach(function (d) {
      var key = notificationKey(d);
      if (db.notificationQueue.some(function (n) { return n.key === key && n.status !== '취소'; })) { skipped++; return; }
      var eq = d.eq || {};
      db.notificationQueue.push({ id: St.newId('n'), key: key, type: d.type, sourceId: d.sourceId,
        equipmentId: eq.id || '', item: d.item, dueDate: d.r.nextText || '', recipientName: eq.mgr || '',
        recipientEmail: eq.mgrEmail || '', subject: '[설비] ' + (eq.name || '설비') + ' ' + d.item + ' 예정 안내',
        body: notificationText(d, p.t), status: '대기', createdAt: new Date().toISOString(),
        approvedAt: '', approvedBy: '', sentAt: '', sentBy: '', lastError: '' });
      added++;
    });
    if (!due.length) { statusLine('#notification-status', false, '현재 승인 대기함에 추가할 임박 항목이 없습니다.'); return; }
    if (persist()) {
      renderNotificationQueue();
      statusLine('#notification-status', true, added + '건을 추가했습니다.' + (skipped ? ' 이미 등록된 ' + skipped + '건은 제외했습니다.' : ''));
    }
  }

  function copyPlain(value) {
    var ta = document.createElement('textarea'); ta.value = value; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok;
  }

  function renderNotificationQueue() {
    var list = (db.notificationQueue || []).slice().sort(function (a, b) {
      var rank = { '대기': 0, '승인': 1, '발송 실패': 2, '발송완료': 3, '취소': 4 };
      return (rank[a.status] || 0) - (rank[b.status] || 0) || (a.createdAt < b.createdAt ? 1 : -1);
    });
    $('#notification-count').textContent = list.length + '건';
    $('#notification-table tbody').innerHTML = list.length ? list.map(function (n) {
      var actions = '<button class="btn small-btn" data-notice-copy="' + esc(n.id) + '">복사</button>';
      if (n.status === '대기') actions += '<button class="btn primary small-btn" data-notice-approve="' + esc(n.id) + '">승인</button>';
      if (n.status === '승인' || n.status === '발송 실패') actions += '<button class="btn green small-btn" data-notice-send="' + esc(n.id) + '"'
        + (!n.recipientEmail ? ' disabled title="담당자 메일이 없습니다"' : '') + '>메일 발송</button>'
        + '<button class="btn small-btn" data-notice-complete="' + esc(n.id) + '">수동 발송완료</button>';
      if (n.status !== '발송완료') actions += '<button class="btn small-btn" data-notice-cancel="' + esc(n.id) + '">취소</button>';
      return '<tr><td>' + esc(n.status) + (n.lastError ? '<div class="sub" style="white-space:normal">' + esc(n.lastError) + '</div>' : '')
        + '</td><td class="mono">' + esc(n.dueDate || '—') + '</td><td>' + esc(n.recipientName || '미지정')
        + '</td><td>' + esc(n.recipientEmail || '미입력') + '</td><td>' + esc(eqName(n.equipmentId)) + ' · ' + esc(n.item)
        + '</td><td style="white-space:normal">' + esc(n.subject) + '</td><td><div class="btnrow" style="margin:0">' + actions + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="sub">승인 대기 알림이 없습니다.</td></tr>';
    $$('#notification-table [data-notice-copy]').forEach(function (b) {
      b.addEventListener('click', function () { var n = notice(b, 'data-notice-copy'); if (n) copyPlain('받는 사람: ' + n.recipientName + ' <' + n.recipientEmail + '>\n제목: ' + n.subject + '\n\n' + n.body); });
    });
    $$('#notification-table [data-notice-approve]').forEach(function (b) {
      b.addEventListener('click', function () { var n = notice(b, 'data-notice-approve'); if (!n) return;
        n.status = '승인'; n.approvedAt = new Date().toISOString(); n.approvedBy = db.settings.syncActor || '미지정 사용자'; n.lastError = '';
        if (persist()) renderNotificationQueue(); });
    });
    $$('#notification-table [data-notice-complete]').forEach(function (b) {
      b.addEventListener('click', function () { var n = notice(b, 'data-notice-complete'); if (!n) return;
        n.status = '발송완료'; n.sentAt = new Date().toISOString(); n.sentBy = db.settings.syncActor || '수동 발송'; n.lastError = '';
        if (persist()) renderNotificationQueue(); });
    });
    $$('#notification-table [data-notice-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { var n = notice(b, 'data-notice-cancel'); if (!n || !confirm('이 알림을 취소할까요?')) return;
        n.status = '취소'; if (persist()) renderNotificationQueue(); });
    });
    $$('#notification-table [data-notice-send]').forEach(function (b) {
      b.addEventListener('click', function () { sendNotification(notice(b, 'data-notice-send')); });
    });
  }

  function notice(button, attr) {
    var id = button.getAttribute(attr);
    return (db.notificationQueue || []).find(function (n) { return n.id === id; });
  }

  function sendNotification(n) {
    if (!n || (n.status !== '승인' && n.status !== '발송 실패')) return;
    statusLine('#notification-status', true, '사내 메일 서버로 발송하고 있습니다.');
    I.sendNotification(db.settings, n).then(function (r) {
      if (r.ok) {
        n.status = '발송완료'; n.sentAt = r.sentAt || new Date().toISOString();
        n.sentBy = db.settings.syncActor || '사내 메일 서버'; n.lastError = '';
        persist(); renderNotificationQueue(); statusLine('#notification-status', true, '메일 발송을 완료했습니다.');
      } else {
        n.status = '발송 실패'; n.lastError = r.error || '사내 메일 서버 설정을 확인하세요.';
        persist(); renderNotificationQueue(); statusLine('#notification-status', false, n.lastError);
      }
    });
  }

  /* ═══════════════════════════════════════════════════ 이력 */

  function initHistory() {
    fillEqSelect($('#h-eq'));
    $('#h-form [name=date]').value = today();
    syncHistoryConsumables($('#h-form'), $('#h-eq').value);
    $('#h-eq').addEventListener('change', function () { syncHistoryConsumables($('#h-form'), this.value); });
    $('#h-form [name=kind]').addEventListener('change', function () {
      syncHistoryConsumables($('#h-form'), $('#h-eq').value);
    });
    $('#h-save').addEventListener('click', function (ev) {
      ev.preventDefault();
      var f = $('#h-form');
      if (!f.reportValidity()) return;
      var o = { id: St.newId('h') };
      $$('#h-form [name]').forEach(function (i) { o[i.name] = i.value.trim(); });
      // 빈 금액은 null. 0 으로 두면 "0 원짜리 공사" 가 되어 예측이 낮아진다.
      o.cost = o.cost === '' ? null : Number(o.cost);
      db.history.push(o);
      var changed = applyCompletedHistory(o);
      if (persist()) {
        f.reset(); $('#h-form [name=date]').value = today(); syncHistoryConsumables(f, $('#h-eq').value); renderHistory();
        statusLine('#history-save-status', true, changed
          ? '이력을 저장하고 마지막 완료일·다음 예정일을 자동 갱신했습니다.' : '이력을 저장했습니다.');
      }
    });
    $('#h-apply').addEventListener('click', applyLatestToEquipment);
    renderHistory();
  }

  function fillEqSelect(sel) {
    sel.innerHTML = db.equipments.length
      ? db.equipments.map(function (e) {
          return '<option value="' + esc(e.id) + '">' + esc(e.code ? e.code + ' ' + e.name : e.name) + '</option>';
        }).join('')
      : '<option value="">— 설비를 먼저 등록하세요 —</option>';
  }

  function syncHistoryConsumables(form, equipmentId) {
    if (!form) return;
    var kind = form.querySelector('[name=kind]'); if (!kind) return;
    var inspectionWrap = form.querySelector('[data-history-inspection]');
    var inspectionSelect = form.querySelector('[name=inspectionId]');
    if (inspectionWrap && inspectionSelect) {
      var inspectionShown = kind.value === '법정검사';
      inspectionWrap.hidden = !inspectionShown; inspectionSelect.required = inspectionShown;
      if (!inspectionShown) inspectionSelect.value = '';
      else {
        var equipment = eqById(equipmentId), inspections = inspectionsOf(equipment);
        inspectionSelect.innerHTML = '<option value="">— 완료한 검사 선택 —</option>' + inspections.map(function (item) {
          return '<option value="' + esc(item.id) + '">' + esc(item.name || '정기검사') + '</option>';
        }).join('');
      }
    }
    var wrap = form.querySelector('[data-history-consumable]'), select = form.querySelector('[name=consumableId]');
    if (!wrap || !select) return;
    var shown = kind.value === '소모품 교체';
    wrap.hidden = !shown; select.required = shown;
    if (!shown) { select.value = ''; return; }
    var list = St.forEquipment(db.consumables, equipmentId);
    select.innerHTML = '<option value="">— 교체한 소모품 선택 —</option>' + list.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
  }

  function applyCompletedHistory(h) {
    var e = eqById(h.equipmentId), changed = 0;
    if (!e || !S.parseDate(h.date)) return changed;
    if (h.kind === '법정검사') {
      e.inspections = inspectionsOf(e).slice();
      var inspection = e.inspections.find(function (item) { return item.id === h.inspectionId; }) || e.inspections[0];
      if (inspection && (!inspection.lastDate || h.date >= inspection.lastDate)) {
        if (inspection.lastDate !== h.date) { inspection.lastDate = h.date; changed++; }
        if (h.cost !== null && Number.isFinite(Number(h.cost))) inspection.cost = Number(h.cost);
        syncPrimaryInspection(e);
      }
    }
    if (h.kind === '소모품 교체') {
      var c = db.consumables.find(function (item) {
        return item.equipmentId === h.equipmentId && (item.id === h.consumableId
          || (!h.consumableId && (h.memo || '').indexOf(item.name) >= 0));
      });
      if (c && (!c.lastDate || h.date >= c.lastDate)) {
        if (c.lastDate !== h.date) { c.lastDate = h.date; changed++; }
        if (h.cost !== null && Number.isFinite(Number(h.cost))) c.cost = Number(h.cost);
      }
    }
    return changed;
  }

  function renderHistory() {
    var list = db.history.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    $('#h-count').textContent = list.length + '건';
    $('#h-table tbody').innerHTML = list.length ? list.map(function (h) {
      return '<tr>'
        + '<td><button class="btn" data-del="' + esc(h.id) + '" style="min-height:26px;padding:0 8px;font-size:12px">삭제</button></td>'
        + '<td class="mono">' + esc(h.date) + '</td>'
        + '<td>' + esc(eqName(h.equipmentId)) + '</td>'
        + '<td>' + esc(h.kind) + '</td>'
        + '<td>' + esc(h.memo) + '</td>'
        + '<td>' + esc(h.vendor) + '</td>'
        + '<td class="num">' + (h.cost === null ? '<span class="sub">미상</span>' : won(h.cost)) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="sub">이력이 없습니다.</td></tr>';

    $$('#h-table [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.history = db.history.filter(function (x) { return x.id !== b.getAttribute('data-del'); });
        if (persist()) renderHistory();
      });
    });

    var sum = {};
    db.history.forEach(function (h) {
      var k = h.equipmentId;
      sum[k] = sum[k] || { n: 0, total: 0, unknown: 0 };
      sum[k].n++;
      if (h.cost === null || !Number.isFinite(Number(h.cost))) sum[k].unknown++;
      else sum[k].total += Number(h.cost);
    });
    var keys = Object.keys(sum);
    $('#h-sum tbody').innerHTML = keys.length ? keys.map(function (k) {
      return '<tr><td>' + esc(eqName(k)) + '</td><td class="num">' + sum[k].n + '건</td>'
        + '<td class="num">' + won(sum[k].total) + '</td>'
        + '<td class="num">' + (sum[k].unknown ? sum[k].unknown + '건' : '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="sub">—</td></tr>';
  }

  /** 최신 이력을 설비/소모품의 "마지막 일자" 에 반영한다 */
  function applyLatestToEquipment() {
    var changed = 0;
    db.equipments.forEach(function (e) {
      e.inspections = inspectionsOf(e).slice();
      e.inspections.forEach(function (inspection, index) {
        var mine = db.history.filter(function (h) {
          if (h.equipmentId !== e.id || h.kind !== '법정검사' || !S.parseDate(h.date)) return false;
          return h.inspectionId === inspection.id || (!h.inspectionId && index === 0);
        }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        if (mine.length && mine[0].date !== inspection.lastDate) { inspection.lastDate = mine[0].date; changed++; }
      });
      syncPrimaryInspection(e);
    });
    db.consumables.forEach(function (c) {
      var mine = db.history.filter(function (h) {
        return h.equipmentId === c.equipmentId && h.kind === '소모품 교체'
          && S.parseDate(h.date) && (h.consumableId === c.id || (!h.consumableId && (h.memo || '').indexOf(c.name) >= 0));
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      if (mine.length && mine[0].date !== c.lastDate) { c.lastDate = mine[0].date; changed++; }
    });
    if (!changed) { alert('반영할 것이 없습니다.\n\n예전 이력은 내용에 소모품 이름이 있어야 연결되며, 새 이력은 교체 소모품을 직접 선택합니다.'); return; }
    if (persist()) alert(changed + '건을 반영했습니다.');
  }

  /* ═══════════════════════════════════════════════════ 비용 */

  function initCost() {
    $('#year').value = new Date().getFullYear() + 1;
    $('#cost-inflation').value = db.settings.costInflation == null ? 3 : db.settings.costInflation;
    $('#cost-contingency').value = db.settings.costContingency == null ? 5 : db.settings.costContingency;
    $('#calc').addEventListener('click', renderCost);
    $('#cost-xlsx').addEventListener('click', exportCostXlsx);
    renderCost();
  }

  /** 예측 대상 = 설비의 법정검사 + 소모품 */
  function costItems() {
    var items = [];
    db.equipments.forEach(function (e) {
      inspectionsOf(e).forEach(function (inspection) {
        items.push({ name: (e.code ? e.code + ' ' : '') + e.name + ' · ' + (inspection.name || '정기검사'), kind: '법정검사',
          lastDate: inspection.lastDate, cycleMonths: inspection.cycleMonths, cost: inspection.cost });
      });
    });
    db.consumables.forEach(function (c) {
      items.push({ name: eqName(c.equipmentId) + ' · ' + c.name, kind: '소모품',
                   lastDate: c.lastDate, cycleMonths: c.cycleMonths, cost: c.cost });
    });
    return items;
  }

  var lastForecast = null;

  function renderCost() {
    var y = Number($('#year').value) || (new Date().getFullYear() + 1);
    var f = S.forecastYear(costItems(), y);
    var inflation = Math.max(Number($('#cost-inflation').value) || 0, 0);
    var contingencyRate = Math.max(Number($('#cost-contingency').value) || 0, 0);
    db.settings.costInflation = inflation; db.settings.costContingency = contingencyRate; cacheDb();
    f.lines.forEach(function (l) {
      l.adjustedUnit = Math.round(l.unit * (1 + inflation / 100));
      l.adjustedSum = l.adjustedUnit * l.count;
    });
    f.adjustedTotal = f.lines.reduce(function (sum, l) { return sum + l.adjustedSum; }, 0);
    f.contingency = Math.round(f.adjustedTotal * contingencyRate / 100);
    f.grandTotal = f.adjustedTotal + f.contingency;
    f.inflation = inflation; f.contingencyRate = contingencyRate;
    lastForecast = f;

    $('#cost-stats').innerHTML =
        '<div class="stat">현재 단가 기준<b>' + won(f.total) + '</b></div>'
      + '<div class="stat">물가 반영<b>' + won(f.adjustedTotal) + '</b></div>'
      + '<div class="stat">예비비 포함 최종<b>' + won(f.grandTotal) + '</b></div>'
      + '<div class="stat">항목<b>' + f.lines.length + '건</b></div>'
      + '<div class="stat">셀 수 없음<b' + (f.unknown.length ? ' style="color:var(--warn)"' : '') + '>'
        + f.unknown.length + '건</b></div>';

    var groups = {};
    f.lines.forEach(function (l) { groups[l.kind || '기타'] = (groups[l.kind || '기타'] || 0) + l.adjustedSum; });
    $('#cost-groups').innerHTML = Object.keys(groups).map(function (kind) {
      return '<div class="stat">' + esc(kind) + '<b>' + won(groups[kind]) + '</b></div>';
    }).join('');
    $('#cost-table tbody').innerHTML = f.lines.length ? f.lines.map(function (l) {
      return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.kind) + '</td>'
        + '<td class="num">' + l.count + '회</td>'
        + '<td class="num">' + won(l.unit) + '</td>'
        + '<td class="num">' + won(l.adjustedUnit) + '</td>'
        + '<td class="num"><b>' + won(l.adjustedSum) + '</b></td></tr>';
    }).join('') : '<tr><td colspan="6" class="sub">' + y + '년에 돌아오는 항목이 없습니다.</td></tr>';

    $('#cost-unknown').innerHTML = f.unknown.length
      ? f.unknown.map(function (u) { return '<li><span>' + esc(u) + '</span></li>'; }).join('')
      : '<li><span class="sub">없습니다.</span></li>';
  }

  /* ═══════════════════════════════════════════════════ 에너지 */

  var energyRows = [];

  function initEnergy() {
    energyRows = db.energy || [];
    var drop = $('#drop'), input = $('#file');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { readFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { readFiles(input.files); input.value = ''; });

    $('#paste-toggle').addEventListener('click', function () {
      var panel = $('#paste-panel');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) $('#paste').focus();
    });
    $('#paste').addEventListener('input', function () {
      $('#paste-apply').disabled = !this.value.trim();
    });
    $('#paste').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.value.trim()) {
        e.preventDefault();
        $('#paste-apply').click();
      }
    });
    $('#paste-apply').addEventListener('click', function () {
      var ta = $('#paste');
      var text = ta.value.trim();
      if (!text) return;
      var g = E.parseUsage(text);
      ingest(g, '붙여넣은 글');
      if (g.rows.length) {
        ta.value = '';
        this.disabled = true;
      }
    });
    $('#energy-xlsx').addEventListener('click', exportEnergyXlsx);
    $('#energy-clear').addEventListener('click', function () {
      if (!confirm('읽어 온 사용량을 모두 지웁니다. 계속할까요?')) return;
      energyRows = []; db.energy = []; persist();
      $('#files').innerHTML = ''; $('#read-note').innerHTML = '';
      renderEnergy();
    });
    renderEnergy();
  }

  function readFiles(files) {
    Array.prototype.slice.call(files || []).forEach(function (f) {
      var li = document.createElement('li');
      li.innerHTML = '<span>' + esc(f.name) + '</span><span class="sub">읽는 중…</span>';
      $('#files').appendChild(li);
      var done = function (msg) { li.lastChild.textContent = msg; };

      if (/\.pdf$/i.test(f.name)) {
        readPdf(f).then(function (text) {
          if (String(text || '').replace(/\s/g, '').length >= 30) return { text: text, ocr: false };
          done('스캔 PDF 감지 · OCR 확인 중…');
          return I.ocr(db.settings, f).then(function (r) {
            return { text: r.ok ? r.text : text, ocr: !!r.ok, error: r.error };
          });
        }).then(function (read) {
          var g = E.parseUsage(read.text);
          if (!g.rows.length && read.error) g.note = 'PDF 글자를 찾지 못했고 OCR도 사용할 수 없습니다: ' + read.error;
          ingest(g, f.name + (read.ocr ? ' · OCR' : ''));
          done(g.rows.length ? g.rows.length + '개월' + (read.ocr ? ' · OCR' : '') : '읽지 못함');
        }).catch(function (e) { done('오류: ' + (e && e.message || e)); });
      } else {
        readSheet(f).then(function (text) {
          var g = E.parseUsage(text);
          ingest(g, f.name);
          done(g.rows.length ? g.rows.length + '개월' : '읽지 못함');
        }).catch(function (e) { done('오류: ' + (e && e.message || e)); });
      }
    });
  }

  /**
   * PDF 글자 뽑기 — pdf.js 는 모듈이라 동적으로 부른다.
   *
   * ⚠ 여기서 `import.meta.url` 을 쓰면 안 된다.
   *   이 파일은 일반 `<script>` 로 불러지므로 `import.meta` 자체가 문법 오류다.
   *   (동적 `import()` 는 일반 스크립트에서도 되지만 `import.meta` 는 안 된다)
   *   그래서 페이지 주소를 기준으로 직접 만든다.
   */
  function libUrl(name) { return new URL('lib/' + name, document.baseURI).href; }

  function readPdf(file) {
    return file.arrayBuffer().then(function (buf) {
      return import(libUrl('pdf.min.mjs')).then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = libUrl('pdf.worker.min.mjs');
        return pdfjs.getDocument({
          data: buf,
          // 한글이 든 PDF 는 글꼴이 문서에 안 박혀 있으면 빈 글자가 나온다.
          // cMap 을 함께 줘야 읽힌다 — 이것 없이 "PDF 를 못 읽는다" 로 오해하기 쉽다.
          cMapUrl: libUrl('cmaps/'),
          cMapPacked: true
        }).promise;
      }).then(function (doc) {
        var jobs = [];
        for (var i = 1; i <= doc.numPages; i++) {
          jobs.push(doc.getPage(i).then(function (p) { return p.getTextContent(); }));
        }
        return Promise.all(jobs).then(function (pages) {
          return pages.map(function (tc) {
            // y 좌표가 비슷한 것끼리 한 줄로 묶는다 — 안 그러면 낱말이 다 흩어진다
            var lines = {};
            tc.items.forEach(function (it) {
              var y = Math.round(it.transform[5]);
              (lines[y] = lines[y] || []).push({ x: it.transform[4], s: it.str });
            });
            return Object.keys(lines).sort(function (a, b) { return b - a; })
              .map(function (y) {
                return lines[y].sort(function (a, b) { return a.x - b.x; })
                  .map(function (o) { return o.s; }).join(' ');
              }).join('\n');
          }).join('\n');
        });
      });
    });
  }

  /** CSV·엑셀 → 글자 */
  function readSheet(file) {
    return file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      return wb.SheetNames.map(function (n) {
        return XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ' ' });
      }).join('\n');
    });
  }

  function ingest(g, source) {
    var note = $('#read-note');
    if (g.note) {
      note.innerHTML = '<div class="' + (g.rows.length ? 'note' : 'warn') + '">'
        + esc(source) + ' — ' + esc(g.note) + '</div>';
    } else if (g.rows.length) {
      note.innerHTML = '<div class="ok">' + esc(source) + ' — '
        + g.rows.length + '건을 적용했습니다.</div>';
    }
    if (!g.rows.length) return;
    // 같은 연월+종류는 새 값으로 덮는다
    g.rows.forEach(function (r) {
      var i = -1;
      for (var k = 0; k < energyRows.length; k++) {
        if (energyRows[k].ym === r.ym && energyRows[k].kind === r.kind) { i = k; break; }
      }
      if (i >= 0) energyRows[i] = r; else energyRows.push(r);
    });
    energyRows.sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });
    db.energy = energyRows;
    persist();
    renderEnergy();
  }

  function renderEnergy() {
    $('#energy-xlsx').disabled = !energyRows.length;
    var groups = E.groupByKind(energyRows);
    var kinds = E.CHART_KINDS.slice();

    $('#charts').innerHTML = kinds.map(function (k) {
      return chartSvg(k, E.withDelta(groups[k] || []));
    }).join('');

    var all = [];
    kinds.forEach(function (k) { all = all.concat(E.withDelta(groups[k])); });
    all.sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });

    $('#energy-table tbody').innerHTML = all.length ? all.map(function (r) {
      var d = r.delta;
      var dTxt = d === null ? '<span class="sub">—</span>'
        : '<b style="color:' + (d > 0 ? 'var(--danger)' : d < 0 ? 'var(--ok)' : 'var(--sub)') + '">'
          + (d > 0 ? '+' : '') + d + '%</b>';
      return '<tr><td class="mono">' + esc(r.ym) + '</td><td>' + esc(r.kind) + '</td>'
        + '<td class="num">' + r.usage.toLocaleString('ko-KR') + '</td>'
        + '<td>' + esc(r.unit) + '</td>'
        + '<td class="num">' + dTxt + '</td>'
        + '<td class="num">' + (r.cost === null ? '<span class="sub">—</span>' : won(r.cost)) + '</td>'
        + '<td class="sub" style="white-space:normal;max-width:340px">' + esc(r.source) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="sub">—</td></tr>';
  }

  /**
   * 막대그래프를 SVG 로 그린다.
   * 차트 라이브러리를 쓰지 않는 이유: 막대 하나 그리려고 200KB 를 더 얹을 이유가 없고,
   * 폐쇄망에서 챙겨야 할 파일이 하나 늘어난다.
   */
  function chartSvg(kind, rows) {
    var W = 900, H = 240, padL = 64, padR = 16, padT = 18, padB = 44;
    var max = Math.max.apply(null, rows.map(function (r) { return r.usage; }).concat([1]));
    var bw = (W - padL - padR) / Math.max(rows.length, 1);
    var colors = { '전력': '#0b6e99', '수도': '#2374c6', '가스': '#d87917', '압축공기': '#6b4fc5' };
    var units = { '전력': 'kWh', '수도': 'm³', '가스': 'Nm³', '압축공기': 'Nm³' };
    var color = colors[kind] || '#0b6e99';
    var bars = rows.map(function (r, i) {
      var h = (H - padT - padB) * (r.usage / max);
      var x = padL + i * bw + bw * 0.15, y = H - padB - h, w = bw * 0.7;
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1)
        + '" height="' + Math.max(h, 1).toFixed(1) + '" fill="' + color + '" rx="3">'
        + '<title>' + esc(r.ym + ' · ' + r.usage.toLocaleString('ko-KR') + ' ' + r.unit) + '</title></rect>'
        + '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - padB + 15)
        + '" text-anchor="middle" font-size="10.5" fill="#5b6b7b">' + esc(r.ym.slice(2)) + '</text>'
        + (bw > 44 ? '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1)
            + '" text-anchor="middle" font-size="10" fill="#152232">'
            + r.usage.toLocaleString('ko-KR') + '</text>' : '');
    }).join('');
    var ticks = [0, 0.5, 1].map(function (f) {
      var y = H - padB - (H - padT - padB) * f;
      return '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1)
        + '" stroke="#dde4ea"/><text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1)
        + '" text-anchor="end" font-size="10.5" fill="#5b6b7b">'
        + Math.round(max * f).toLocaleString('ko-KR') + '</text>';
    }).join('');
    var empty = rows.length ? '' : '<text x="' + ((padL + W - padR) / 2) + '" y="125" '
      + 'text-anchor="middle" font-size="14" fill="#7a8998">등록된 사용량이 없습니다</text>';
    var unitName = rows[0] && rows[0].unit ? rows[0].unit : units[kind];
    var unit = unitName ? ' (' + unitName + ')' : '';
    return '<div class="card energy-chart"><h3 style="font-size:15.5px;margin-bottom:8px">'
      + esc(kind) + esc(unit) + '</h3>'
      + '<div style="overflow-x:auto"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" '
      + 'style="min-width:520px;display:block" role="img" aria-label="' + esc(kind) + ' 월별 사용량">'
      + ticks + bars + empty + '</svg></div></div>';
  }

  /* ═══════════════════════════════════════════════════ 조감도 */

  function initMap() {
    $('#campus-image').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      if (file.size > 12 * 1024 * 1024) { alert('이미지는 12MB 이하로 선택하세요.'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, 1600 / img.width), canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          db.settings.mapImageData = canvas.toDataURL('image/jpeg', 0.82);
          cacheDb(); renderCampus();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file); this.value = '';
    });
    $('#campus-image-clear').addEventListener('click', function () {
      db.settings.mapImageData = ''; cacheDb(); renderCampus();
    });
    $('#building-draw-start').addEventListener('click', function () { startBuildingDrawing(null); });
    $('#building-draw-undo').addEventListener('click', function () {
      if (!buildingDraft || !buildingDraft.points.length) return;
      buildingDraft.points.pop(); renderCampus();
      statusLine('#building-draw-status', true, '마지막 점을 취소했습니다. 현재 ' + buildingDraft.points.length + '개입니다.');
    });
    $('#building-draw-cancel').addEventListener('click', cancelBuildingDrawing);
    $('#building-draw-finish').addEventListener('click', finishBuildingDrawing);
    $('#building-save').addEventListener('click', function () {
      var names = [], invalid = false;
      $$('#building-editor tbody tr').forEach(function (tr) {
        var b = db.buildings.find(function (x) { return x.id === tr.getAttribute('data-id'); });
        if (!b) return;
        var input = tr.querySelector('[name=buildingName]'), name = input.value.trim();
        if (!name || names.indexOf(name) >= 0) { invalid = true; input.focus(); return; }
        names.push(name);
        var old = b.name; b.name = name;
        if (old !== name) db.equipments.forEach(function (e) { if (e.building === old) e.building = name; });
      });
      if (invalid) { statusLine('#building-status', false, '건물 이름은 비워둘 수 없고 서로 달라야 합니다.'); return; }
      if (persist()) { statusLine('#building-status', true, '건물 이름과 다각형 좌표를 저장했습니다.'); renderCampus(); renderBuildingEditor(); }
    });
    renderCampus();
    renderBuildingEditor();
  }

  function setDrawingButtons(on) {
    $('#building-draw-start').hidden = on;
    $('#building-draw-undo').hidden = !on;
    $('#building-draw-finish').hidden = !on;
    $('#building-draw-cancel').hidden = !on;
  }

  function startBuildingDrawing(buildingId) {
    buildingDraft = { editingId: buildingId || null, points: [] };
    setDrawingButtons(true);
    statusLine('#building-draw-status', true, '조감도 위에서 건물 외곽점을 순서대로 찍으세요. 3개 이상이면 완성할 수 있습니다.');
    renderCampus();
  }

  function cancelBuildingDrawing() {
    buildingDraft = null; setDrawingButtons(false);
    $('#building-draw-status').innerHTML = '';
    renderCampus();
  }

  function polygonBounds(points) {
    var xs = points.map(function (p) { return p.x; }), ys = points.map(function (p) { return p.y; });
    var x = Math.min.apply(Math, xs), y = Math.min.apply(Math, ys);
    return { x: x, y: y, w: Math.max.apply(Math, xs) - x, h: Math.max.apply(Math, ys) - y };
  }

  function finishBuildingDrawing() {
    if (!buildingDraft || buildingDraft.points.length < 3) {
      statusLine('#building-draw-status', false, '다각형을 만들려면 외곽점을 3개 이상 찍어야 합니다.'); return;
    }
    var bounds = polygonBounds(buildingDraft.points), building;
    if (buildingDraft.editingId) {
      building = db.buildings.find(function (b) { return b.id === buildingDraft.editingId; });
      if (building) { building.points = buildingDraft.points; Object.assign(building, bounds); }
    } else {
      var number = db.buildings.length + 1, name = '새 건물 ' + number;
      while (db.buildings.some(function (b) { return b.name === name; })) { number++; name = '새 건물 ' + number; }
      building = Object.assign({ id: St.newId('b'), name: name, points: buildingDraft.points }, bounds);
      db.buildings.push(building);
    }
    buildingDraft = null; setDrawingButtons(false); cacheDb();
    renderCampus(); renderBuildingEditor();
    statusLine('#building-draw-status', true, building ? '다각형을 완성했습니다. 아래 목록에서 건물 이름을 확인하고 저장하세요.' : '건물을 찾지 못했습니다.');
    if (building) {
      var input = $('#building-editor tr[data-id="' + building.id + '"] [name=buildingName]');
      if (input) { input.focus(); input.select(); }
    }
  }

  function renderBuildingEditor() {
    $('#building-editor tbody').innerHTML = buildingRecords().map(function (b) {
      return '<tr data-id="' + esc(b.id) + '"><td><input class="building-name-input" name="buildingName" value="' + esc(b.name) + '" required></td>'
        + '<td class="num">' + ((b.points || []).length) + '개</td><td><div class="btnrow">'
        + '<button class="btn small-btn" type="button" data-building-redraw="' + esc(b.id) + '">다시 그리기</button>'
        + '<button class="btn small-btn" type="button" data-building-delete="' + esc(b.id) + '">삭제</button></div></td></tr>';
    }).join('');
    $$('[data-building-redraw]').forEach(function (button) {
      button.addEventListener('click', function () { startBuildingDrawing(button.getAttribute('data-building-redraw')); });
    });
    $$('[data-building-delete]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-building-delete'), b = db.buildings.find(function (x) { return x.id === id; });
        if (!b) return;
        var assigned = db.equipments.filter(function (e) { return e.building === b.name; }).length;
        if (assigned) { alert('이 건물에 설비 ' + assigned + '건이 연결되어 있습니다. 설비 위치를 먼저 변경하세요.'); return; }
        if (!confirm('“' + b.name + '” 건물 영역을 삭제할까요?')) return;
        db.buildings = db.buildings.filter(function (x) { return x.id !== id; });
        if (persist()) { renderCampus(); renderBuildingEditor(); }
      });
    });
  }

  function renderCampus() {
    var bs = buildingRecords();
    var box = $('#campus');
    function pointsText(points) { return (points || []).map(function (p) { return Number(p.x).toFixed(2) + ',' + Number(p.y).toFixed(2); }).join(' '); }
    function center(points) {
      var n = points.length || 1;
      return { x: points.reduce(function (sum, p) { return sum + Number(p.x); }, 0) / n,
        y: points.reduce(function (sum, p) { return sum + Number(p.y); }, 0) / n };
    }
    var shapes = bs.map(function (b) {
      var n = db.equipments.filter(function (e) { return e.building === b.name; }).length;
      var c = center(b.points || []);
      return '<polygon class="campus-shape" data-b="' + esc(b.name) + '" data-building-id="' + esc(b.id) + '" points="' + pointsText(b.points) + '"><title>' + esc(b.name + ' · 설비 ' + n + '건') + '</title></polygon>'
        + '<text class="campus-label" x="' + c.x.toFixed(2) + '" y="' + c.y.toFixed(2) + '">' + esc(b.name) + ' · ' + n + '</text>';
    }).join('');
    var draft = buildingDraft ? '<polygon class="campus-draft" points="' + pointsText(buildingDraft.points) + '"></polygon>'
      + buildingDraft.points.map(function (p) { return '<circle class="campus-draft-point" cx="' + p.x + '" cy="' + p.y + '" r="1.1"></circle>'; }).join('') : '';
    box.innerHTML = '<div class="campus-layout' + (buildingDraft ? ' drawing' : '') + '" aria-label="건물 다각형 배치">'
      + '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' + shapes + draft + '</svg>'
      + (!bs.length && !buildingDraft ? '<p class="sub campus-empty">건물 추가를 눌러 첫 건물의 외곽선을 그리세요.</p>' : '') + '</div>';
    if (db.settings.mapImageData) {
      $('.campus-layout', box).style.backgroundImage = 'url("' + db.settings.mapImageData + '")';
      $('.campus-layout', box).classList.add('has-image');
    }

    var layout = $('.campus-layout', box);
    layout.addEventListener('click', function (event) {
      if (!buildingDraft) return;
      var rect = layout.getBoundingClientRect();
      buildingDraft.points.push({ x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)),
        y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) });
      renderCampus();
      statusLine('#building-draw-status', true, '외곽점 ' + buildingDraft.points.length + '개를 찍었습니다.'
        + (buildingDraft.points.length >= 3 ? ' 다각형 완성을 누르세요.' : ' 최소 3개가 필요합니다.'));
    });
    $$('.campus-shape', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (buildingDraft) return;
        $$('.campus-shape', box).forEach(function (x) { x.classList.remove('on'); });
        btn.classList.add('on');
        showBuilding(btn.getAttribute('data-b'));
      });
    });
  }

  function showBuilding(b) {
    $('#picked-title').textContent = b + ' 의 설비';
    var t = today();
    var list = db.equipments.filter(function (e) { return e.building === b; });
    $('#picked tbody').innerHTML = list.length ? list.map(function (e) {
      var next = soonestInspection(e, t), r = next.r;
      return '<tr><td class="mono">' + esc(e.code) + '</td><td>' + esc(e.name) + '</td>'
        + '<td>' + esc(e.kind) + '</td><td>' + esc(e.place) + '</td>'
        + '<td>' + esc(e.spec) + '</td><td>' + esc(e.power) + '</td>'
        + '<td>' + esc(e.mgr) + '</td>'
        + '<td class="mono">' + esc(r.nextText || '—') + ' ' + badge(r.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="sub">이 건물에 등록된 설비가 없습니다.</td></tr>';
  }

  /* ═════════════════════════════════════════════ 사내 저장소·AI 설정 */

  function setFormValues(form, values) {
    $$('[name]', form).forEach(function (i) {
      if (i.name === 'externalApiKey' || i.name === 'ocrApiKey') return;
      if (i.type === 'checkbox') i.checked = !!values[i.name];
      else i.value = values[i.name] == null ? '' : values[i.name];
    });
  }

  function settingsFromForms() {
    var out = {};
    $$('#storage-settings [name], #ai-settings [name], #law-api-settings [name], #job-settings [name], #ocr-settings [name]').forEach(function (i) {
      if (i.name === 'externalApiKey' || i.name === 'ocrApiKey') return;
      out[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    return out;
  }

  function statusLine(selector, good, message) {
    $(selector).innerHTML = '<div class="status-line ' + (good ? 'good' : 'bad') + '">' + esc(message) + '</div>';
  }

  function renderSyncSummary() {
    $('#sync-summary').innerHTML = '<div class="sync-kpis"><span>이 PC가 아는 서버 버전 <b>'
      + esc(db.sync.revision || 0) + '</b></span><span>마지막 작업자 <b>' + esc(db.sync.updatedBy || '기록 없음')
      + '</b></span><span>상태 <b>' + (db.sync.conflict ? '충돌 확인 필요' : (db.sync.enabled ? '자동 동기화' : '수동 선택 필요'))
      + '</b></span></div>';
  }

  function loadAudit() {
    I.audit(db.settings, 30).then(function (r) {
      var rows = r.ok ? r.items || [] : [];
      $('#sync-audit tbody').innerHTML = rows.length ? rows.map(function (x) {
        return '<tr><td class="mono">' + esc(x.revision) + '</td><td>' + esc(x.actor)
          + '</td><td>' + esc(x.device_name) + '</td><td class="mono">' + esc(String(x.created_at || '').replace('T', ' ').slice(0, 19)) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="sub">변경 기록을 불러오지 못했거나 아직 기록이 없습니다.</td></tr>';
    });
  }

  function initSettings() {
    setFormValues($('#storage-settings'), db.settings);
    setFormValues($('#ai-settings'), db.settings);
    setFormValues($('#law-api-settings'), db.settings);
    setFormValues($('#job-settings'), db.settings);
    setFormValues($('#ocr-settings'), db.settings);

    $('#storage-save').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms()); cacheDb();
      I.saveSettings(db.settings, '').then(function (r) {
        statusLine('#storage-status', r.ok, r.ok ? '공유폴더 경로를 사내 서버 설정에 저장했습니다.'
          : '경로는 이 브라우저에 저장했지만 사내 서버에는 연결하지 못했습니다.');
      });
    });
    $('#server-test').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms());
      statusLine('#storage-status', true, '사내 서버에 연결을 시험하고 있습니다.');
      I.health(db.settings).then(function (r) {
        statusLine('#storage-status', r.ok, r.ok ? '사내 서버 연결에 성공했습니다. 현재 권한: '
          + ({ admin: '관리자', editor: '편집자', viewer: '읽기 전용' }[r.role] || r.role || '확인 불가')
          : '연결하지 못했습니다: ' + r.error);
      });
    });
    $('#storage-test').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms());
      statusLine('#storage-status', true, '공유폴더 읽기·쓰기를 시험하고 있습니다.');
      I.testStorage(db.settings).then(function (r) {
        statusLine('#storage-status', r.ok, r.ok ? '공유폴더에 시험 파일을 쓰고 지웠습니다: ' + r.path
          : '공유폴더를 사용할 수 없습니다: ' + r.error);
      });
    });
    $('#settings-save').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms());
      var apiKey = $('#ai-settings [name=externalApiKey]').value;
      var ocrApiKey = $('#ocr-settings [name=ocrApiKey]').value;
      cacheDb();
      I.saveSettings(db.settings, apiKey, ocrApiKey).then(function (r) {
        if (r.ok) {
          $('#ai-settings [name=externalApiKey]').value = '';
          $('#ocr-settings [name=ocrApiKey]').value = '';
          statusLine('#settings-status', true, '설정을 사내 서버에 저장했습니다. API 키는 서버에만 보관됩니다.');
        } else {
          statusLine('#settings-status', false, '화면 설정은 이 브라우저에 저장했지만 사내 서버에는 연결하지 못했습니다. API 키는 저장하지 않았습니다.');
        }
      });
    });
    $('#sync-pull').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms()); cacheDb();
      if (!confirm('서버의 공용 자료로 이 PC 화면 자료를 바꿉니다. 계속할까요?')) return;
      statusLine('#sync-status', true, '서버 자료를 불러오고 있습니다.');
      I.loadState(db.settings).then(function (r) {
        if (!r.ok || !r.data) { statusLine('#sync-status', false, r.error || '서버에 저장된 공용 자료가 없습니다.'); return; }
        db = St.applyShared(db, r.data, { revision: r.revision, updatedAt: r.updatedAt,
          updatedBy: r.updatedBy, deviceName: r.deviceName, enabled: true, serverEmpty: false });
        cacheDb(); location.reload();
      });
    });
    $('#sync-push').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms()); cacheDb();
      if (!confirm('이 PC 자료로 공용 DB를 갱신합니다. 다른 PC 자료보다 이 자료가 최신인지 확인했나요?')) return;
      var identity = syncIdentity(); statusLine('#sync-status', true, '공용 DB에 저장하고 있습니다.');
      I.saveState(db.settings, St.sharedPayload(db), db.sync.revision, identity.actor, identity.deviceName, true)
        .then(function (r) {
          if (!r.ok) { statusLine('#sync-status', false, r.error || '공용 DB에 저장하지 못했습니다.'); return; }
          db.sync = Object.assign(db.sync, { revision: r.revision, updatedAt: r.updatedAt,
            updatedBy: r.updatedBy, deviceName: r.deviceName, conflict: false, enabled: true, serverEmpty: false });
          cacheDb(); renderSyncSummary(); loadAudit();
          statusLine('#sync-status', true, '공용 DB 저장을 완료했습니다. 버전 ' + r.revision);
        });
    });
    $('#sync-backup').addEventListener('click', function () {
      Object.assign(db.settings, settingsFromForms()); cacheDb();
      statusLine('#sync-status', true, '공용 DB를 백업하고 있습니다.');
      I.backup(db.settings).then(function (r) {
        statusLine('#sync-status', r.ok, r.ok ? '백업 완료: ' + r.path : (r.error || '백업하지 못했습니다.'));
      });
    });
    function loadBackups() {
      I.backups(db.settings).then(function (r) {
        var select = $('#backup-select'), items = r.ok ? r.items || [] : [];
        select.innerHTML = '<option value="">— 백업 선택 —</option>' + items.map(function (b) {
          return '<option value="' + esc(b.name) + '">' + esc(b.name) + ' · ' + Math.round(b.size / 1024) + 'KB</option>';
        }).join('');
      });
    }
    function loadJobs() {
      I.jobs(db.settings).then(function (r) {
        var rows = r.ok ? r.items || [] : [];
        $('#job-runs tbody').innerHTML = rows.length ? rows.map(function (j) {
          return '<tr><td>' + esc(j.status) + '</td><td>' + esc(j.queued) + '</td><td>' + esc(j.law_checked)
            + '</td><td>' + esc(j.law_changed) + '</td><td class="mono">' + esc(String(j.finished_at || '').replace('T', ' ').slice(0, 19)) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="sub">자동 점검 실행 기록이 없습니다.</td></tr>';
      });
    }
    $('#backup-refresh').addEventListener('click', loadBackups);
    $('#backup-restore').addEventListener('click', function () {
      var name = $('#backup-select').value;
      if (!name) { alert('복원할 백업을 선택하세요.'); return; }
      if (!confirm(name + ' 상태로 공용 DB를 복원합니다. 현재 상태는 먼저 안전 백업합니다. 계속할까요?')) return;
      statusLine('#backup-status', true, '백업을 복원하고 있습니다.');
      I.restore(db.settings, name).then(function (r) {
        statusLine('#backup-status', r.ok, r.ok ? '복원 완료. 복원 직전 안전 백업: ' + r.safetyBackup : (r.error || '복원하지 못했습니다.'));
      });
    });
    function runJob(forceLaws) {
      Object.assign(db.settings, settingsFromForms()); cacheDb();
      I.saveSettings(db.settings, '', '').then(function () {
        statusLine('#job-status', true, '자동 점검을 실행하고 있습니다. 오류 항목은 기록하고 나머지는 계속 처리합니다.');
        I.runJobs(db.settings, forceLaws).then(function (r) {
          var message = r.ok ? '알림 ' + r.queued + '건 추가 · 법령 ' + r.lawChecked + '건 확인 · 변경 ' + r.lawChanged + '건'
            : '일부 항목을 처리하지 못했습니다: ' + ((r.errors || []).join(' / ') || r.error || '확인 필요');
          statusLine('#job-status', !!r.ok, message); loadJobs();
        });
      });
    }
    $('#job-run').addEventListener('click', function () { runJob(false); });
    $('#job-run-laws').addEventListener('click', function () { runJob(true); });
    renderSyncSummary(); loadAudit(); loadBackups(); loadJobs();
  }

  /* ═══════════════════════════════════════ 내보내기·가져오기 */

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportJson() {
    download(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }),
             'facility-' + today() + '.json');
  }

  function importJson(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var d;
      try { d = JSON.parse(t); } catch (e) { alert('JSON 을 읽지 못했습니다: ' + e.message); return; }
      if (!d || !Array.isArray(d.equipments)) { alert('이 파일에는 설비 목록이 없습니다.'); return; }
      if (!confirm('지금 자료를 이 파일로 **바꿉니다**.\n설비 ' + d.equipments.length + '건'
        + ' · 이력 ' + ((d.history || []).length) + '건\n계속할까요?')) return;
      Object.keys(St.EMPTY).forEach(function (k) { db[k] = d[k] === undefined ? St.EMPTY[k] : d[k]; });
      if (persist()) location.reload();
    });
    ev.target.value = '';
  }

  function sheet(rows, name, file) {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    XLSX.writeFile(wb, file);
  }

  function exportEquipmentXlsx() {
    if (!db.equipments.length) { alert('내보낼 설비가 없습니다.'); return; }
    var t = today();
    sheet(db.equipments.map(function (e) {
      var r = soonestInspection(e, t).r;
      var latestLaw = L.latestReview(e.id, db.lawReviews);
      return {
        설비번호: e.code, 설비명: e.name, 종류: e.kind, 건물: e.building, 설치위치: e.place,
        제조사: e.manufacturer, 모델: e.model, 사양: e.spec, 용량: e.capacity,
        유량: e.flow, 압력: e.pressure, 소모전력: e.power, 냉난방용량: e.hvac, 설치일: e.installedAt,
        법정선임관리자: e.legalMgr, 유지관리자: e.mgr, 메일: e.mgrEmail,
        검사항목: inspectionsOf(e).map(function (i) { return i.name; }).join(' / '),
        마지막검사: inspectionsOf(e).map(function (i) { return i.name + ':' + (i.lastDate || '미입력'); }).join(' / '),
        '주기(개월)': inspectionsOf(e).map(function (i) { return i.name + ':' + (i.cycleMonths || '미입력'); }).join(' / '),
        검사비용: inspectionsOf(e).map(function (i) { return i.name + ':' + (i.cost == null ? '미입력' : i.cost); }).join(' / '),
        다음검사: r.nextText || '', 상태: r.status,
        법령확인일: (latestLaw && latestLaw.checkedAt) || e.lawCheckedAt || '', 비고: e.note,
        매뉴얼수: St.forEquipment(db.manuals, e.id).length,
        법령검토수: St.forEquipment(db.lawReviews, e.id).length
      };
    }), '설비', 'facility-equipment-' + t + '.xlsx');
  }

  function exportCostXlsx() {
    if (!lastForecast || !lastForecast.lines.length) { alert('내보낼 항목이 없습니다.'); return; }
    var rows = lastForecast.lines.map(function (l) {
      return { 항목: l.name, 구분: l.kind, 횟수: l.count, '현재 단가': l.unit,
        '물가 반영 단가': l.adjustedUnit, 합계: l.adjustedSum };
    });
    // 셀 수 없었던 것도 같은 파일에 넣는다. 따로 두면 안 보고 지나친다.
    rows.push({ 항목: '', 구분: '', 횟수: '', '현재 단가': '예비비 포함 최종', 합계: lastForecast.grandTotal });
    lastForecast.unknown.forEach(function (u) {
      rows.push({ 항목: '[셀 수 없음] ' + u, 구분: '', 횟수: '', 단가: '', 합계: '' });
    });
    sheet(rows, lastForecast.year + '년 예측', 'facility-cost-' + lastForecast.year + '.xlsx');
  }

  function exportEnergyXlsx() {
    if (!energyRows.length) { alert('내보낼 사용량이 없습니다.'); return; }
    var groups = E.groupByKind(energyRows);
    var all = [];
    E.CHART_KINDS.forEach(function (k) { all = all.concat(E.withDelta(groups[k] || [])); });
    all.sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });
    sheet(all.map(function (r) {
      return {
        연월: r.ym, 종류: r.kind, 사용량: r.usage, 단위: r.unit,
        '전월대비(%)': r.delta === null ? '' : r.delta,
        요금: r.cost === null ? '' : r.cost,   // 모르면 빈 칸 — 0 을 넣으면 공짜로 보인다
        원문: r.source
      };
    }), '에너지', 'facility-energy-' + today() + '.xlsx');
  }

  /* ═══════════════════════════════════════════════════ 예시 자료 */

  function seed() {
    var y = new Date().getFullYear();
    var managers = [
      { id: St.newId('mgr'), role: 'legal', name: '김철수', department: '시설안전팀', phone: '010-0000-0001', email: 'legal1@example.com', active: true, note: '승강기 법정선임' },
      { id: St.newId('mgr'), role: 'legal', name: '이정민', department: '기계설비팀', phone: '010-0000-0003', email: 'legal2@example.com', active: true, note: '보일러·냉동기 법정선임' },
      { id: St.newId('mgr'), role: 'legal', name: '정하늘', department: '환경전기팀', phone: '010-0000-0005', email: 'legal3@example.com', active: true, note: '전기·환경 설비 법정선임' },
      { id: St.newId('mgr'), role: 'maintenance', name: '박영희', department: '시설운영팀', phone: '010-0000-0002', email: 'facility1@example.com', active: true, note: '본관 유지관리' },
      { id: St.newId('mgr'), role: 'maintenance', name: '최민수', department: '시설운영팀', phone: '010-0000-0004', email: 'facility2@example.com', active: true, note: '연구동 유지관리' },
      { id: St.newId('mgr'), role: 'maintenance', name: '한지우', department: '환경관리팀', phone: '010-0000-0006', email: 'facility3@example.com', active: true, note: '실습동 유지관리' }
    ];
    var eq = [
      { code: 'U-EL-01', name: '본관 승객용 승강기 1호기', kind: '승강기', building: '본관',
        place: '지하 1층 기계실', spec: '15인승 / 1.0 m/s', power: '11.5 kW',
        legalMgr: '김철수 / 010-0000-0001', mgr: '박영희 / 010-0000-0002',
        mgrEmail: 'facility1@example.com', lastInspect: (y - 1) + '-09-20', cycleMonths: 12,
        inspectCost: 350000, lawCheckedAt: (y - 1) + '-09-20', manual: '공유폴더/설비/승강기' },
      { code: 'U-BO-01', name: '본관 온수보일러', kind: '보일러', building: '본관',
        place: '지하 2층 보일러실', manufacturer: '예시보일러', model: 'SB-1500',
        spec: '관류형', capacity: '1.5 t/h', pressure: '0.98 MPa', power: '7.5 kW',
        legalMgr: '이정민 / 010-0000-0003', mgr: '박영희 / 010-0000-0002',
        mgrEmail: 'facility1@example.com', lastInspect: y + '-03-11', cycleMonths: 12,
        inspectCost: 420000, lawCheckedAt: y + '-03-11', manual: '공유폴더/설비/보일러' },
      { code: 'U-CH-01', name: '연구동 터보냉동기', kind: '냉동기', building: '연구동',
        place: '옥상 기계실', manufacturer: '예시냉동', model: 'TC-300',
        spec: '수냉식 터보', capacity: '300 RT', flow: '1,200 LPM', power: '180 kW',
        legalMgr: '이정민 / 010-0000-0003', mgr: '최민수 / 010-0000-0004',
        mgrEmail: 'facility2@example.com', lastInspect: (y - 1) + '-06-01', cycleMonths: 12,
        inspectCost: 900000, lawCheckedAt: (y - 2) + '-06-01', manual: '공유폴더/설비/냉동기' },
      { code: 'U-PW-01', name: '연구동 수변전설비', kind: '수변전설비', building: '연구동',
        place: '지하 1층 전기실', spec: '22.9 kV / 1,500 kVA', power: '—',
        legalMgr: '정하늘 / 010-0000-0005', mgr: '최민수 / 010-0000-0004',
        mgrEmail: 'facility2@example.com', lastInspect: null, cycleMonths: null,
        inspectCost: null, lawCheckedAt: null, manual: '' },
      { code: 'U-WW-01', name: '실습동 폐수처리시설', kind: '폐수처리시설', building: '실습동',
        place: '뒤편 처리동', spec: '30 t/일', power: '15 kW',
        legalMgr: '정하늘 / 010-0000-0005', mgr: '한지우 / 010-0000-0006',
        mgrEmail: 'facility3@example.com', lastInspect: y + '-02-01', cycleMonths: 6,
        inspectCost: 260000, lawCheckedAt: y + '-02-01', manual: '공유폴더/설비/폐수' }
    ].map(function (e, i) {
      e.id = St.newId('eq');
      e.legalManagerId = managers[[0, 1, 1, 2, 2][i]].id;
      e.maintenanceManagerId = managers[[3, 3, 4, 4, 5][i]].id;
      return e;
    });

    var cons = [
      { equipmentId: eq[1].id, name: '버너 노즐', cycleMonths: 12, cost: 180000, lastDate: y + '-03-11' },
      { equipmentId: eq[2].id, name: '냉각수 필터', cycleMonths: 6, cost: 120000, lastDate: y + '-03-01' },
      { equipmentId: eq[2].id, name: '압축기 오일', cycleMonths: 24, cost: 640000, lastDate: (y - 1) + '-05-10' },
      { equipmentId: eq[4].id, name: '폭기조 산기관', cycleMonths: 36, cost: null, lastDate: (y - 2) + '-08-20' },
      { equipmentId: eq[0].id, name: '와이어로프', cycleMonths: 60, cost: 2400000, lastDate: (y - 3) + '-09-20' }
    ].map(function (c) { c.id = St.newId('c'); return c; });

    var hist = [
      { equipmentId: eq[1].id, kind: '법정검사', date: y + '-03-11', cost: 420000, vendor: '한국에너지공단', memo: '검사대상기기 정기검사 합격' },
      { equipmentId: eq[2].id, kind: '고장 AS', date: y + '-05-22', cost: 1350000, vendor: '대한기계', memo: '압축기 이상 소음 — 베어링 교체' },
      { equipmentId: eq[2].id, kind: '소모품 교체', date: y + '-03-01', cost: 120000, vendor: '대한기계', memo: '냉각수 필터 교체' },
      { equipmentId: eq[4].id, kind: '법정검사', date: y + '-02-01', cost: 260000, vendor: '환경관리공단', memo: '자가측정' },
      { equipmentId: eq[0].id, kind: '고장 AS', date: y + '-07-03', cost: null, vendor: '승강기서비스', memo: '도어 센서 조정 (금액 미확인)' }
    ].map(function (h) { h.id = St.newId('h'); return h; });

    var manuals = [
      { equipmentId: eq[1].id, title: '온수보일러 운전·정비 매뉴얼', version: 'Rev.2',
        filePath: '\\\\fileserver\\facility\\boiler\\SB-1500-manual.pdf', note: '사내 공유폴더 예시' },
      { equipmentId: eq[2].id, title: '터보냉동기 점검 매뉴얼', version: 'Rev.1',
        filePath: '\\\\fileserver\\facility\\chiller\\TC-300-manual.pdf', note: '사내 공유폴더 예시' }
    ].map(function (m) { m.id = St.newId('m'); m.addedAt = new Date().toISOString(); return m; });

    var lawReviews = [
      { equipmentId: eq[1].id, law: '에너지이용 합리화법', checkedAt: y + '-03-11',
        reviewer: '예시 담당자', note: '검사대상기기 해당 여부를 사내 자료로 검토',
        filePath: '\\\\fileserver\\facility\\law\\energy-act.pdf', needsReview: false },
      { equipmentId: eq[2].id, law: '고압가스 안전관리법', checkedAt: (y - 2) + '-06-01',
        reviewer: '예시 담당자', note: '설비 변경 시 재검토',
        filePath: '\\\\fileserver\\facility\\law\\gas-safety.pdf', needsReview: true }
    ].map(function (l) { l.id = St.newId('l'); return l; });

    var buildingData = [
      { id: 'b-main', name: '본관', x: 8, y: 12, w: 32, h: 30 },
      { id: 'b-research', name: '연구동', x: 55, y: 9, w: 34, h: 34 },
      { id: 'b-training', name: '실습동', x: 31, y: 58, w: 36, h: 28 }
    ];

    // 네 종류를 같은 12개월 축으로 비교할 수 있는 예시 자료
    var series = [
      { kind: '전력', unit: 'kWh', values: [128,119,105,96,108,142,176,181,149,103,111,133], scale: 1000, price: 146 },
      { kind: '수도', unit: 'm³', values: [920,870,890,910,940,1010,1080,1120,1040,960,930,950], scale: 1, price: 1150 },
      { kind: '가스', unit: 'Nm³', values: [18400,16200,12100,7600,4200,2600,2200,2400,3900,7800,13200,17600], scale: 1, price: 980 },
      { kind: '압축공기', unit: 'Nm³', values: [820,790,840,810,850,900,920,910,880,860,830,800], scale: 1000, price: 18 }
    ];
    var energy = [];
    series.forEach(function (s) {
      s.values.forEach(function (v, i) {
        var usage = v * s.scale;
        energy.push({ ym: (y - 1) + '-' + String(i + 1).padStart(2, '0'), year: y - 1, month: i + 1,
          kind: s.kind, usage: usage, unit: s.unit, cost: Math.round(usage * s.price), source: '(예시 자료)' });
      });
    });

    db.equipments = eq; db.consumables = cons; db.history = hist; db.manuals = manuals;
    db.lawReviews = lawReviews; db.buildings = buildingData; db.energy = energy;
    db.managers = managers;
    persist();
  }

  /* ═══════════════════════════════════════════════════ 시작 */

  function initCurrentPage() {
    if ($('#summary')) initIndex();
    if ($('#eq-form')) initEquipment();
    if ($('#insp')) initAlerts();
    if ($('#h-form')) initHistory();
    if ($('#cost-table')) initCost();
    if ($('#drop')) initEnergy();
    if ($('#campus')) initMap();
    if ($('#storage-settings')) initSettings();
    if ($('#manager-form')) initManagers();
  }

  function hasSharedData() {
    return St.SHARED_KEYS.some(function (key) { return (db[key] || []).length > 0; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!serverConfigured()) { initCurrentPage(); return; }
    I.loadState(db.settings).then(function (r) {
      if (r.ok && r.data) {
        db = St.applyShared(db, r.data, { revision: r.revision, updatedAt: r.updatedAt,
          updatedBy: r.updatedBy, deviceName: r.deviceName, enabled: true, serverEmpty: false });
        cacheDb();
      } else if (r.ok) {
        db.sync.serverEmpty = true;
        db.sync.enabled = !hasSharedData();
        cacheDb();
      }
      initCurrentPage();
      if (r.ok && r.data) showSyncStatus('good', '사내 공용 데이터 연결 · 버전 ' + r.revision);
      else if (r.ok && hasSharedData()) showSyncStatus('bad', '공용 DB가 비어 있습니다. 설정에서 이 PC 자료를 올릴지 선택하세요.');
      else if (!r.ok) showSyncStatus('bad', '사내 공용 서버에 연결하지 못해 이 PC 자료로 열었습니다.');
    });
  });
})();
