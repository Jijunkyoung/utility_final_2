/**
 * store.js — 자료를 담는 곳
 *
 * 이 브라우저에만 저장한다(localStorage). 서버가 없다.
 * 폐쇄망에서 돌아야 하고, 설비 대장은 담당자 한 사람이 관리하는 자료라 이걸로 충분하다.
 *
 * ⚠ 대신 두 가지를 반드시 지킨다.
 *   ① **어디에 저장되는지 화면에 적는다.** 모르고 쓰면 브라우저를 정리했을 때
 *      자료가 사라진 이유를 알 수 없다.
 *   ② **내보내기·가져오기를 둔다.** 다른 PC 로 옮기거나 백업할 길이 없으면
 *      실무에서 못 쓴다.
 */
(function (root) {
  'use strict';

  var KEY = 'hd-facility-v1';

  var EMPTY = {
    equipments: [],   // 설비
    history: [],      // 이력 (교체·AS·검사)
    consumables: [],  // 소모품
    energy: [],       // 에너지 사용량
    buildings: [],    // 건물 (조감도)
    savedAt: null
  };

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return clone(EMPTY);
      var d = JSON.parse(raw);
      // 나중에 항목이 늘어도 예전 자료가 깨지지 않게 빈 값을 채운다
      Object.keys(EMPTY).forEach(function (k) {
        if (d[k] === undefined) d[k] = clone(EMPTY[k]);
      });
      return d;
    } catch (e) {
      return clone(EMPTY);
    }
  }

  function save(d) {
    d.savedAt = new Date().toISOString();
    try {
      root.localStorage.setItem(KEY, JSON.stringify(d));
      return { ok: true };
    } catch (e) {
      // 용량이 차면 저장이 실패하는데 화면은 그대로다 — 반드시 알린다.
      return { ok: false, error: '저장하지 못했습니다: ' + (e && e.message || e)
             + '\n브라우저 저장 공간이 찼을 수 있습니다. 내보내기로 백업한 뒤 정리하세요.' };
    }
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /** 새 id — 시각 + 무작위. 같은 밀리초에 두 건을 넣어도 겹치지 않는다. */
  function newId(prefix) {
    return (prefix || 'x') + Date.now().toString(36)
         + Math.floor(Math.random() * 1e4).toString(36);
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); } catch (e) {}
  }

  root.Store = { KEY: KEY, load: load, save: save, newId: newId, reset: reset, EMPTY: EMPTY };
})(typeof self !== 'undefined' ? self : this);
