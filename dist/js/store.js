/**
 * store.js — 자료 저장 계층
 *
 * 화면은 localStorage 를 직접 호출하지 않는다. 지금은 한 PC의 브라우저에 저장하지만,
 * 이 파일의 load/save 만 사내 API로 바꾸면 화면 코드는 그대로 둘 수 있게 한다.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'hd-facility-v1';
  var SCHEMA_VERSION = 8;
  var SHARED_KEYS = ['equipments', 'history', 'consumables', 'manuals', 'lawReviews',
    'lawDocuments', 'lawVersions', 'lawChanges', 'analysisResults', 'energy', 'buildings',
    'managers', 'notificationQueue'];

  var EMPTY = {
    schemaVersion: SCHEMA_VERSION,
    equipments: [],   // 설비
    history: [],      // 이력 (교체·AS·검사)
    consumables: [],  // 소모품
    manuals: [],      // 설비별 매뉴얼/파일 메타데이터
    lawReviews: [],   // 설비별 법령 검토 기록
    lawDocuments: [], // 설비별로 내부 저장한 법령 원문·버전
    lawVersions: [],  // 법령 원문을 갱신할 때 보존하는 시점별 사본
    lawChanges: [],   // 이전·최신 원문 차이와 설비 영향 검토 상태
    analysisResults: [], // 매뉴얼·법령 분석 결과와 근거
    energy: [],       // 에너지 사용량
    buildings: [],    // {id,name,x,y,w,h,points:[{x,y}]} — 다각형 조감도 영역
    managers: [],     // 법정선임·유지관리 담당자 통합 대장
    notificationQueue: [], // 검사·교체 알림 승인/발송 기록
    settings: {
      /* 서버 주소는 사용자가 설정 화면에서 명시적으로 넣은 뒤에만 접속한다.
       * 기본값으로 localhost를 호출하면 서버를 설치하지 않은 브라우저마다 오류가 남는다. */
      sharedPath: '', serverUrl: '', serverToken: '', syncActor: '', deviceName: '', aiMode: 'rules',
      localAiUrl: 'http://127.0.0.1:11434', localAiModel: '',
      externalAiUrl: '', externalAiModel: '', allowExternalFallback: false,
      lawApiUrl: 'https://www.law.go.kr/DRF', lawApiOc: '',
      ocrApiUrl: 'https://api.upstage.ai/v1/document-digitization',
      inspectionLeadDays: 30, replacementLeadDays: 30, lawCheckEveryDays: 7,
      costInflation: 3, costContingency: 5, mapImageData: ''
    },
    sync: { revision: 0, updatedAt: null, updatedBy: '', deviceName: '', conflict: false,
      enabled: false, serverEmpty: false },
    savedAt: null
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function text(v) { return v == null ? '' : String(v); }

  function buildingId(name) {
    var s = text(name).trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣_-]/g, '');
    return 'b-' + (s || 'building');
  }

  /**
   * 이전 v1 자료를 v2 모양으로 채운다. 원래 값은 버리지 않는다.
   * 자동 배치는 4열 기준 백분율 좌표이며, 향후 img/campus.png 좌표로 바꿀 수 있다.
   */
  function normalize(input) {
    var d = input && typeof input === 'object' ? clone(input) : {};
    Object.keys(EMPTY).forEach(function (k) {
      if (d[k] === undefined || (Array.isArray(EMPTY[k]) && !Array.isArray(d[k]))) {
        d[k] = clone(EMPTY[k]);
      }
    });
    d.settings = Object.assign(clone(EMPTY.settings), d.settings || {});
    d.sync = Object.assign(clone(EMPTY.sync), d.sync && typeof d.sync === 'object' ? d.sync : {});

    var known = {};
    d.buildings = d.buildings.map(function (b, i) {
      if (typeof b === 'string') b = { name: b };
      b = b || {};
      var name = text(b.name).trim();
      var col = i % 4, row = Math.floor(i / 4);
      var x = Number.isFinite(Number(b.x)) ? Number(b.x) : 4 + col * 24;
      var y = Number.isFinite(Number(b.y)) ? Number(b.y) : 8 + row * 30;
      var w = Number.isFinite(Number(b.w)) ? Number(b.w) : 20;
      var h = Number.isFinite(Number(b.h)) ? Number(b.h) : 22;
      var points = Array.isArray(b.points) ? b.points.map(function (p) {
        return { x: Number(p && p.x), y: Number(p && p.y) };
      }).filter(function (p) {
        return Number.isFinite(p.x) && Number.isFinite(p.y)
          && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
      }) : [];
      if (points.length < 3) points = [
        { x: x, y: y }, { x: x + w, y: y },
        { x: x + w, y: y + h }, { x: x, y: y + h }
      ];
      var out = {
        id: b.id || buildingId(name),
        name: name,
        x: x, y: y, w: w, h: h, points: points
      };
      if (name) known[name] = true;
      return out;
    }).filter(function (b) { return b.name; });

    (d.equipments || []).forEach(function (e) {
      var inspections = Array.isArray(e.inspections) ? e.inspections : [];
      inspections = inspections.map(function (item, index) {
        item = item || {};
        var cycle = item.cycleMonths === '' || item.cycleMonths == null ? null : Number(item.cycleMonths);
        var cost = item.cost === '' || item.cost == null ? null : Number(item.cost);
        return {
          id: item.id || (e.id || 'equipment') + '-inspection-' + (index + 1),
          name: text(item.name).trim() || '정기검사',
          lastDate: text(item.lastDate).trim(),
          cycleMonths: Number.isFinite(cycle) && cycle > 0 ? cycle : null,
          cost: Number.isFinite(cost) && cost >= 0 ? cost : null
        };
      });
      if (!inspections.length && (e.lastInspect || e.cycleMonths || e.inspectCost !== undefined && e.inspectCost !== null)) {
        inspections.push({
          id: (e.id || 'equipment') + '-inspection-1', name: '정기검사',
          lastDate: text(e.lastInspect).trim(),
          cycleMonths: Number(e.cycleMonths) > 0 ? Number(e.cycleMonths) : null,
          cost: e.inspectCost === '' || e.inspectCost == null ? null : Number(e.inspectCost)
        });
      }
      e.inspections = inspections;
      if (inspections.length) {
        e.lastInspect = inspections[0].lastDate || '';
        e.cycleMonths = inspections[0].cycleMonths;
        e.inspectCost = inspections[0].cost;
      }
      var name = text(e.building).trim();
      if (!name || known[name]) return;
      var i = d.buildings.length, col = i % 4, row = Math.floor(i / 4);
      d.buildings.push({
        id: buildingId(name), name: name,
        x: 4 + col * 24, y: 8 + row * 30, w: 20, h: 22,
        points: [{ x: 4 + col * 24, y: 8 + row * 30 }, { x: 24 + col * 24, y: 8 + row * 30 },
          { x: 24 + col * 24, y: 30 + row * 30 }, { x: 4 + col * 24, y: 30 + row * 30 }]
      });
      known[name] = true;
    });

    d.schemaVersion = SCHEMA_VERSION;
    return d;
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      return normalize(raw ? JSON.parse(raw) : EMPTY);
    } catch (e) {
      return normalize(EMPTY);
    }
  }

  function save(input) {
    var d = normalize(input);
    // 호출자가 들고 있는 객체도 정규화된 컬렉션을 보게 한다.
    Object.keys(d).forEach(function (k) { input[k] = d[k]; });
    input.savedAt = new Date().toISOString();
    try {
      root.localStorage.setItem(KEY, JSON.stringify(input));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '저장하지 못했습니다: ' + (e && e.message || e)
             + '\n브라우저 저장 공간이 찼을 수 있습니다. 내보내기로 백업한 뒤 정리하세요.' };
    }
  }

  /** 새 id — 시각 + 무작위. 같은 밀리초에 두 건을 넣어도 겹치지 않는다. */
  function newId(prefix) {
    return (prefix || 'x') + Date.now().toString(36)
         + Math.floor(Math.random() * 1e4).toString(36);
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); } catch (e) {}
  }

  function forEquipment(list, equipmentId) {
    return (list || []).filter(function (x) { return x.equipmentId === equipmentId; });
  }

  function sharedPayload(input) {
    var d = normalize(input), out = {};
    SHARED_KEYS.forEach(function (key) { out[key] = clone(d[key]); });
    return out;
  }

  function applyShared(input, shared, meta) {
    var d = normalize(input), source = shared && typeof shared === 'object' ? shared : {};
    SHARED_KEYS.forEach(function (key) {
      d[key] = Array.isArray(source[key]) ? clone(source[key]) : [];
    });
    d.sync = Object.assign(d.sync, meta || {}, { conflict: false });
    return normalize(d);
  }

  /** 설비와 설비 ID에 매달린 상세 자료를 한 번에 지운다. */
  function removeEquipment(input, equipmentId) {
    var d = normalize(input);
    d.equipments = d.equipments.filter(function (x) { return x.id !== equipmentId; });
    ['history', 'consumables', 'manuals', 'lawReviews', 'lawDocuments', 'lawVersions', 'lawChanges',
      'analysisResults', 'notificationQueue'].forEach(function (key) {
      d[key] = d[key].filter(function (x) { return x.equipmentId !== equipmentId; });
    });
    return d;
  }

  return {
    KEY: KEY, SCHEMA_VERSION: SCHEMA_VERSION, EMPTY: EMPTY, SHARED_KEYS: SHARED_KEYS,
    load: load, save: save, normalize: normalize, newId: newId,
    reset: reset, forEquipment: forEquipment, removeEquipment: removeEquipment,
    buildingId: buildingId, sharedPayload: sharedPayload, applyShared: applyShared
  };
});
