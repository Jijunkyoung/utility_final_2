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
  var SCHEMA_VERSION = 4;
  var SHARED_KEYS = ['equipments', 'history', 'consumables', 'manuals', 'lawReviews',
    'lawDocuments', 'analysisResults', 'energy', 'buildings', 'managers'];

  var EMPTY = {
    schemaVersion: SCHEMA_VERSION,
    equipments: [],   // 설비
    history: [],      // 이력 (교체·AS·검사)
    consumables: [],  // 소모품
    manuals: [],      // 설비별 매뉴얼/파일 메타데이터
    lawReviews: [],   // 설비별 법령 검토 기록
    lawDocuments: [], // 설비별로 내부 저장한 법령 원문·버전
    analysisResults: [], // 매뉴얼·법령 분석 결과와 근거
    energy: [],       // 에너지 사용량
    buildings: [],    // {id,name,x,y,w,h} — 조감도와 설비를 이름으로 연결
    managers: [],     // 법정선임·유지관리 담당자 통합 대장
    settings: {
      /* 서버 주소는 사용자가 설정 화면에서 명시적으로 넣은 뒤에만 접속한다.
       * 기본값으로 localhost를 호출하면 서버를 설치하지 않은 브라우저마다 오류가 남는다. */
      sharedPath: '', serverUrl: '', serverToken: '', syncActor: '', deviceName: '', aiMode: 'rules',
      localAiUrl: 'http://127.0.0.1:11434', localAiModel: '',
      externalAiUrl: '', externalAiModel: '', allowExternalFallback: false,
      lawApiUrl: 'https://www.law.go.kr/DRF', lawApiOc: ''
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
      var out = {
        id: b.id || buildingId(name),
        name: name,
        x: Number.isFinite(Number(b.x)) ? Number(b.x) : 4 + col * 24,
        y: Number.isFinite(Number(b.y)) ? Number(b.y) : 8 + row * 30,
        w: Number.isFinite(Number(b.w)) ? Number(b.w) : 20,
        h: Number.isFinite(Number(b.h)) ? Number(b.h) : 22
      };
      if (name) known[name] = true;
      return out;
    }).filter(function (b) { return b.name; });

    (d.equipments || []).forEach(function (e) {
      var name = text(e.building).trim();
      if (!name || known[name]) return;
      var i = d.buildings.length, col = i % 4, row = Math.floor(i / 4);
      d.buildings.push({
        id: buildingId(name), name: name,
        x: 4 + col * 24, y: 8 + row * 30, w: 20, h: 22
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
    ['history', 'consumables', 'manuals', 'lawReviews', 'lawDocuments', 'analysisResults'].forEach(function (key) {
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
