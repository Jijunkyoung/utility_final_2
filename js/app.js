/**
 * app.js — 화면
 *
 * 페이지가 일곱 개지만 자료는 하나다(Store).
 * 각 페이지에만 있는 요소를 찾아 그 페이지의 준비 함수를 부른다.
 * 페이지마다 파일을 나누면 공통 계산이 흩어져 서로 어긋난다.
 */
(function () {
  'use strict';

  var S = window.Schedule, L = window.Law, E = window.Energy, St = window.Store;
  var db = St.load();
  var currentDetailEquipmentId = null;
  var selectedManualFile = null;

  /* ────────────────────────────────────────────────────────── 도구 */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function won(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function today() { return S.fmt(new Date()); }

  function persist() {
    var r = St.save(db);
    if (!r.ok) alert(r.error);
    return r.ok;
  }

  function eqById(id) {
    for (var i = 0; i < db.equipments.length; i++) {
      if (db.equipments[i].id === id) return db.equipments[i];
    }
    return null;
  }
  function eqName(id) { var e = eqById(id); return e ? (e.code ? e.code + ' ' + e.name : e.name) : '(삭제된 설비)'; }

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
      var r = S.nextInspection(e.lastInspect, e.cycleMonths, t, leadI);
      out.push({ type: '법정검사', eq: e, item: '정기검사', r: r, cost: e.inspectCost });
    });
    db.consumables.forEach(function (c) {
      var r = S.nextReplacement(c.lastDate, c.cycleMonths, t, leadR);
      out.push({ type: '소모품', eq: eqById(c.equipmentId), item: c.name, r: r, cost: c.cost });
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
      if (o.kind === '기타') o.kind = $('#kind-other').value.trim();
      // 숫자로 둘 것만 숫자로. 빈 값은 null 로 둔다 — 0 으로 두면 "주기 0" 이 되어
      // "주기 없음" 과 구분이 안 된다.
      ['cycleMonths', 'inspectCost'].forEach(function (k) {
        o[k] = o[k] === '' ? null : Number(o[k]);
      });
      ensureBuilding(o.building);
      db.equipments.push(o);
      if (persist()) {
        f.reset(); syncOtherKind(false); renderEquipment(); closeCreateDialog();
      }
    });
    $('#eq-clear').addEventListener('click', function () { $('#eq-form').reset(); syncOtherKind(false); });

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
    $('#manual-file').addEventListener('change', function () {
      selectedManualFile = this.files && this.files[0] || null;
      $('#manual-file-label').textContent = selectedManualFile ? selectedManualFile.name : '파일 선택';
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
        + '<td class="mono">' + esc(e.lastInspect || '—') + '</td>'
        + '<td class="num">' + (e.cycleMonths ? e.cycleMonths + '개월' : '—') + '</td>'
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
      x: 4 + col * 24, y: 8 + row * 30, w: 20, h: 22 });
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
    $('#manual-file').value = '';
    $('#manual-file-label').textContent = '파일 선택';
    $('#detail-history-form [name=date]').value = today();
    $('#detail-law-form [name=checkedAt]').value = today();
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
      + field('법정선임관리자', 'legalMgr', e.legalMgr)
      + field('유지관리자', 'mgr', e.mgr)
      + field('유지관리자 메일', 'mgrEmail', e.mgrEmail, 'email')
      + field('법정검사', 'lastInspect', e.lastInspect, 'date')
      + field('검사주기(개월)', 'cycleMonths', e.cycleMonths, 'number', ' min="1" step="1"')
      + field('검사비용(원)', 'inspectCost', e.inspectCost, 'number', ' min="0" step="1000"')
      + field('법령 확인일', 'lawCheckedAt', e.lawCheckedAt, 'date')
      + field('비고', 'note', e.note);
  }

  function renderEquipmentDetail() {
    var e = detailEquipment();
    if (!e) return;
    $('#detail-title').textContent = e.name || '설비 상세';
    $('#detail-code').textContent = (e.code || '설비번호 없음') + ' · ' + (e.kind || '종류 미입력');
    renderDetailBasic(e);
    renderDetailConsumables(e);
    renderDetailHistory(e);
    renderDetailManuals(e);
    renderDetailLaws(e);
  }

  function saveDetailBasic() {
    var e = detailEquipment(), f = $('#detail-basic-form');
    if (!e || !f.reportValidity()) return;
    $$('[name]', f).forEach(function (i) { e[i.name] = i.value.trim(); });
    ['cycleMonths', 'inspectCost'].forEach(function (k) {
      e[k] = e[k] === '' ? null : Number(e[k]);
    });
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
    if (o.kind === '법정검사' && (!e.lastInspect || o.date > e.lastInspect)) e.lastInspect = o.date;
    db.consumables.forEach(function (c) {
      if (c.equipmentId === e.id && o.kind === '소모품 교체'
          && o.memo.indexOf(c.name) >= 0 && (!c.lastDate || o.date > c.lastDate)) c.lastDate = o.date;
    });
    if (persist()) {
      f.reset(); f.querySelector('[name=date]').value = today();
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
    var o = { id: St.newId('m'), equipmentId: e.id, addedAt: new Date().toISOString() };
    $$('[name]', f).forEach(function (i) { o[i.name] = i.value.trim(); });
    if (selectedManualFile) {
      o.fileName = selectedManualFile.name;
      o.fileSize = selectedManualFile.size;
      o.fileType = selectedManualFile.type;
      o.fileLastModified = selectedManualFile.lastModified;
    }
    db.manuals.push(o);
    if (persist()) {
      f.reset(); selectedManualFile = null; $('#manual-file-label').textContent = '파일 선택';
      renderDetailManuals(e);
    }
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
      var meta = [m.version, m.fileName, formatBytes(m.fileSize), m.note].filter(Boolean).join(' · ');
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
  }

  function saveDetailLaw() {
    var e = detailEquipment(), f = $('#detail-law-form');
    if (!e || !f.reportValidity()) return;
    var o = { id: St.newId('l'), equipmentId: e.id };
    $$('[name]', f).forEach(function (i) {
      o[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    db.lawReviews.push(o);
    if (persist()) {
      f.reset(); f.querySelector('[name=checkedAt]').value = today();
      renderDetailLaws(e); renderEquipment();
    }
  }

  function renderDetailLaws(e) {
    var candidates = L.lawsForEquipment(e);
    $('#detail-law-candidates').innerHTML = candidates.length
      ? '<div class="candidate-grid">' + candidates.map(function (c, i) {
          return '<article class="law-candidate"><h4>' + esc(c.law) + '</h4><p>' + esc(c.about) + '</p>'
            + '<p><b>검토 입력값:</b> ' + esc(c.basis || '사양 미입력') + '</p>'
            + (c.missing.length ? '<p>추가 확인 권장: ' + esc(c.missing.join(', ')) + '</p>' : '')
            + '<button class="btn small-btn" data-law-candidate="' + i + '">이 법령 검토 기록</button></article>';
        }).join('') + '</div>'
      : '<div class="note">이 설비 종류에 등록된 법령 후보가 없습니다. 사내 법령 자료를 확인한 뒤 아래에 직접 기록하세요.</div>';
    $$('#detail-law-candidates [data-law-candidate]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = candidates[Number(b.getAttribute('data-law-candidate'))];
        $('#detail-law-form [name=law]').value = c ? c.law : '';
        $('#detail-law-form [name=law]').focus();
      });
    });

    var list = St.forEquipment(db.lawReviews, e.id).sort(function (a, b) { return a.checkedAt < b.checkedAt ? 1 : -1; });
    $('#detail-laws tbody').innerHTML = list.length ? list.map(function (r) {
      return '<tr><td><button class="btn small-btn" data-law-del="' + esc(r.id) + '">삭제</button></td>'
        + '<td>' + esc(r.law) + '</td><td class="mono">' + esc(r.checkedAt) + '</td><td>' + esc(r.reviewer) + '</td>'
        + '<td>' + (r.needsReview ? '<b style="color:var(--warn)">필요</b>' : '완료') + '</td>'
        + '<td>' + esc(r.filePath) + '</td><td>' + esc(r.note) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="sub">저장된 법령 검토 기록이 없습니다.</td></tr>';
    $$('#detail-laws [data-law-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.lawReviews = db.lawReviews.filter(function (x) { return x.id !== b.getAttribute('data-law-del'); });
        if (persist()) { renderDetailLaws(e); renderEquipment(); }
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
    $('#copy-mail').addEventListener('click', function () {
      var ta = $('#mail-body');
      ta.select();
      try { document.execCommand('copy'); this.textContent = '복사됨'; }
      catch (e) { alert('복사하지 못했습니다. 직접 선택해 복사하세요.'); }
      var b = this;
      setTimeout(function () { b.textContent = '복사'; }, 1600);
    });
    renderAlerts();
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

    $('#insp tbody').innerHTML = db.equipments.length ? db.equipments.map(function (e) {
      var r = S.nextInspection(e.lastInspect, e.cycleMonths, p.t, p.i);
      return '<tr' + (r.status === '기한 초과' ? ' class="flag"' : '') + '>'
        + '<td class="mono">' + esc(e.code) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.kind) + '</td>'
        + '<td class="mono">' + esc(e.lastInspect || '—') + '</td>'
        + '<td class="num">' + (e.cycleMonths ? e.cycleMonths + '개월' : '—') + '</td>'
        + '<td class="mono">' + esc(r.nextText || '—') + '</td>'
        + '<td class="num">' + (r.dday === null ? '—' : r.dday + '일') + '</td>'
        + '<td>' + badge(r.status) + (r.why ? '<div class="sub" style="white-space:normal">' + esc(r.why) + '</div>' : '') + '</td>'
        + '<td>' + esc(e.mgr) + '</td></tr>';
    }).join('') : '<tr><td colspan="9" class="sub">등록된 설비가 없습니다.</td></tr>';

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

  /* ═══════════════════════════════════════════════════ 이력 */

  function initHistory() {
    fillEqSelect($('#h-eq'));
    $('#h-form [name=date]').value = today();
    $('#h-save').addEventListener('click', function (ev) {
      ev.preventDefault();
      var f = $('#h-form');
      if (!f.reportValidity()) return;
      var o = { id: St.newId('h') };
      $$('#h-form [name]').forEach(function (i) { o[i.name] = i.value.trim(); });
      // 빈 금액은 null. 0 으로 두면 "0 원짜리 공사" 가 되어 예측이 낮아진다.
      o.cost = o.cost === '' ? null : Number(o.cost);
      db.history.push(o);
      if (persist()) { f.reset(); $('#h-form [name=date]').value = today(); renderHistory(); }
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
      var mine = db.history.filter(function (h) {
        return h.equipmentId === e.id && h.kind === '법정검사' && S.parseDate(h.date);
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      if (mine.length && mine[0].date !== e.lastInspect) { e.lastInspect = mine[0].date; changed++; }
    });
    db.consumables.forEach(function (c) {
      var mine = db.history.filter(function (h) {
        return h.equipmentId === c.equipmentId && h.kind === '소모품 교체'
          && S.parseDate(h.date) && (h.memo || '').indexOf(c.name) >= 0;
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      if (mine.length && mine[0].date !== c.lastDate) { c.lastDate = mine[0].date; changed++; }
    });
    if (!changed) { alert('반영할 것이 없습니다.\n\n소모품은 이력의 “내용” 에 소모품 이름이 들어 있어야 짝지어집니다.'); return; }
    if (persist()) alert(changed + '건을 반영했습니다.');
  }

  /* ═══════════════════════════════════════════════════ 비용 */

  function initCost() {
    $('#year').value = new Date().getFullYear() + 1;
    $('#calc').addEventListener('click', renderCost);
    $('#cost-xlsx').addEventListener('click', exportCostXlsx);
    renderCost();
  }

  /** 예측 대상 = 설비의 법정검사 + 소모품 */
  function costItems() {
    var items = db.equipments.map(function (e) {
      return { name: (e.code ? e.code + ' ' : '') + e.name + ' 정기검사', kind: '법정검사',
               lastDate: e.lastInspect, cycleMonths: e.cycleMonths, cost: e.inspectCost };
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
    lastForecast = f;

    $('#cost-stats').innerHTML =
        '<div class="stat">' + y + '년 예상<b>' + won(f.total) + '</b></div>'
      + '<div class="stat">항목<b>' + f.lines.length + '건</b></div>'
      + '<div class="stat">셀 수 없음<b' + (f.unknown.length ? ' style="color:var(--warn)"' : '') + '>'
        + f.unknown.length + '건</b></div>';

    $('#cost-table tbody').innerHTML = f.lines.length ? f.lines.map(function (l) {
      return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.kind) + '</td>'
        + '<td class="num">' + l.count + '회</td>'
        + '<td class="num">' + won(l.unit) + '</td>'
        + '<td class="num"><b>' + won(l.sum) + '</b></td></tr>';
    }).join('') : '<tr><td colspan="5" class="sub">' + y + '년에 돌아오는 항목이 없습니다.</td></tr>';

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
      var ta = $('#paste');
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    $('#paste').addEventListener('input', function () {
      ingest(E.parseUsage(this.value), '붙여넣은 글');
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
          var g = E.parseUsage(text);
          ingest(g, f.name);
          done(g.rows.length ? g.rows.length + '개월' : '읽지 못함');
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
    var preferred = ['전력', '수도', '가스', '압축공기', '열', '기타'];
    var kinds = Object.keys(groups).sort(function (a, b) {
      var ai = preferred.indexOf(a), bi = preferred.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b, 'ko');
    });

    $('#charts').innerHTML = kinds.length ? kinds.map(function (k) {
      return chartSvg(k, E.withDelta(groups[k]));
    }).join('') : '<p class="sub">아직 읽어 온 사용량이 없습니다.</p>';

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
    var bw = (W - padL - padR) / rows.length;
    var colors = { '전력': '#0b6e99', '수도': '#2374c6', '가스': '#d87917', '압축공기': '#6b4fc5', '열': '#c64c3c', '기타': '#667482' };
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
    var unit = rows[0] && rows[0].unit ? ' (' + rows[0].unit + ')' : '';
    return '<div class="card energy-chart"><h3 style="font-size:15.5px;margin-bottom:8px">'
      + esc(kind) + esc(unit) + '</h3>'
      + '<div style="overflow-x:auto"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" '
      + 'style="min-width:520px;display:block" role="img" aria-label="' + esc(kind) + ' 월별 사용량">'
      + ticks + bars + '</svg></div></div>';
  }

  /* ═══════════════════════════════════════════════════ 조감도 */

  function initMap() {
    renderCampus();
  }

  function renderCampus() {
    var bs = buildingRecords();
    var box = $('#campus');
    if (!bs.length) {
      box.innerHTML = '<p class="sub">설비에 <b>건물</b> 을 적으면 여기에 나타납니다.</p>';
      return;
    }
    box.innerHTML = '<div class="campus-layout" aria-label="건물 좌표 배치">' + bs.map(function (b) {
      var n = db.equipments.filter(function (e) { return e.building === b.name; }).length;
      return '<button type="button" class="bldg" data-b="' + esc(b.name) + '" data-building-id="' + esc(b.id) + '" '
        + 'style="left:' + Number(b.x) + '%;top:' + Number(b.y) + '%;width:' + Number(b.w) + '%;height:' + Number(b.h) + '%">'
        + '<b>' + esc(b.name) + '</b><span>' + n + '건</span></button>';
    }).join('') + '</div>';

    $$('.bldg').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.bldg').forEach(function (x) { x.classList.remove('on'); });
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
      var r = S.nextInspection(e.lastInspect, e.cycleMonths, t);
      return '<tr><td class="mono">' + esc(e.code) + '</td><td>' + esc(e.name) + '</td>'
        + '<td>' + esc(e.kind) + '</td><td>' + esc(e.place) + '</td>'
        + '<td>' + esc(e.spec) + '</td><td>' + esc(e.power) + '</td>'
        + '<td>' + esc(e.mgr) + '</td>'
        + '<td class="mono">' + esc(r.nextText || '—') + ' ' + badge(r.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="sub">이 건물에 등록된 설비가 없습니다.</td></tr>';
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
      var r = S.nextInspection(e.lastInspect, e.cycleMonths, t);
      var latestLaw = L.latestReview(e.id, db.lawReviews);
      return {
        설비번호: e.code, 설비명: e.name, 종류: e.kind, 건물: e.building, 설치위치: e.place,
        제조사: e.manufacturer, 모델: e.model, 사양: e.spec, 용량: e.capacity,
        유량: e.flow, 압력: e.pressure, 소모전력: e.power, 냉난방용량: e.hvac, 설치일: e.installedAt,
        법정선임관리자: e.legalMgr, 유지관리자: e.mgr, 메일: e.mgrEmail,
        마지막검사: e.lastInspect || '', '주기(개월)': e.cycleMonths || '',
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
      return { 항목: l.name, 구분: l.kind, 횟수: l.count, 단가: l.unit, 합계: l.sum };
    });
    // 셀 수 없었던 것도 같은 파일에 넣는다. 따로 두면 안 보고 지나친다.
    rows.push({ 항목: '', 구분: '', 횟수: '', 단가: '합계', 합계: lastForecast.total });
    lastForecast.unknown.forEach(function (u) {
      rows.push({ 항목: '[셀 수 없음] ' + u, 구분: '', 횟수: '', 단가: '', 합계: '' });
    });
    sheet(rows, lastForecast.year + '년 예측', 'facility-cost-' + lastForecast.year + '.xlsx');
  }

  function exportEnergyXlsx() {
    if (!energyRows.length) { alert('내보낼 사용량이 없습니다.'); return; }
    var groups = E.groupByKind(energyRows);
    var all = [];
    Object.keys(groups).forEach(function (k) { all = all.concat(E.withDelta(groups[k])); });
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
    ].map(function (e) { e.id = St.newId('eq'); return e; });

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

    // 에너지는 예시 12개월 — 여름·겨울이 높은 실제 모양을 따른다
    var base = [128, 119, 105, 96, 108, 142, 176, 181, 149, 103, 111, 133];
    var energy = base.map(function (v, i) {
      return { ym: (y - 1) + '-' + String(i + 1).padStart(2, '0'), year: y - 1, month: i + 1,
               kind: '전력', usage: v * 1000, unit: 'kWh', cost: Math.round(v * 1000 * 146),
               source: '(예시 자료)' };
    });

    db.equipments = eq; db.consumables = cons; db.history = hist; db.manuals = manuals;
    db.lawReviews = lawReviews; db.buildings = buildingData; db.energy = energy;
    persist();
  }

  /* ═══════════════════════════════════════════════════ 시작 */

  document.addEventListener('DOMContentLoaded', function () {
    if ($('#summary')) initIndex();
    if ($('#eq-form')) initEquipment();
    if ($('#insp')) initAlerts();
    if ($('#h-form')) initHistory();
    if ($('#cost-table')) initCost();
    if ($('#drop')) initEnergy();
    if ($('#campus')) initMap();
  });
})();
