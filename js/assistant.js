/** 저장 자료에서 질문 근거를 찾는다. 원문 밖의 사실은 만들지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FacilityAssistant = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function search(db, question, scope) {
    var q = String(question || '').toLowerCase(), tokens = q.match(/[a-z0-9가-힣_-]+/g) || [];
    var kind = /압축공기|압공/.test(q) ? '압축공기' : /전력|전기/.test(q) ? '전력'
      : /가스/.test(q) ? '가스' : /용수|수도/.test(q) ? '수도' : '';
    var months = [], m, re = /(20\d{2})\s*(?:년|[-./])\s*(\d{1,2})\s*월?/g;
    while ((m = re.exec(q))) months.push(m[1] + '-' + m[2].padStart(2, '0'));
    var year = (q.match(/(20\d{2})\s*년/) || [])[1];
    var monthOnly = !months.length ? (q.match(/(?:^|\s)(\d{1,2})\s*월/) || [])[1] : '';
    var date = new Date();
    if (/올해/.test(q)) year = String(date.getFullYear());
    if (/작년/.test(q)) year = String(date.getFullYear() - 1);
    if (/이번\s*달|지난\s*달/.test(q)) {
      var relative = new Date(date.getFullYear(), date.getMonth() - (/지난\s*달/.test(q) ? 1 : 0), 1);
      months = [relative.getFullYear() + '-' + String(relative.getMonth() + 1).padStart(2, '0')]; monthOnly = '';
    }
    var relevant = tokens.map(function (t) { return t.replace(/(에서|으로|에는|의|은|는|을|를|이|가)$/, ''); }).filter(function (t) { return t.length > 1 && !/^(검색|알려|보여|찾아|사용량|설비|법령|목록|전체|있어|어떻게|어디|현황|합계|얼마|사양|등록|총|\d{4}년|\d{1,2}월)/.test(t); });
    function score(row) { var raw = JSON.stringify(row).toLowerCase().replace(/\s/g, ''); return relevant.reduce(function (s, t) { return s + (raw.indexOf(t) >= 0 ? 1 : 0); }, 0); }
    var equipment = (db.equipments || []).slice();
    var ranked = equipment.map(function (e) { return { row: e, score: score(e) }; });
    if (relevant.length) ranked = ranked.filter(function (e) { return e.score; });
    ranked.sort(function (a, b) { return b.score - a.score; });
    equipment = ranked.map(function (x) {
      var e = x.row, out = {};
      ['id','code','name','kind','model','manufacturer','capacity','flow','pressure','power','hvac','spec','building','place','installed','inspections'].forEach(function (k) { if (e[k] !== undefined) out[k] = e[k]; });
      return out;
    });
    var energy = (db.energy || []).filter(function (e) {
      return (!kind || e.kind === kind) && (!months.length || months.indexOf(e.ym) >= 0)
        && (!monthOnly || Number(String(e.ym).slice(5)) === Number(monthOnly))
        && (months.length || !year || String(e.ym).indexOf(year + '-') === 0);
    });
    var totals = {};
    energy.forEach(function (e) {
      if (typeof e.usage !== 'number' || !Number.isFinite(e.usage) || !e.unit) return;
      var key = e.kind + '|' + (e.unit || '단위 미확인');
      totals[key] = (totals[key] || 0) + e.usage;
    });
    if (scope === 'law') { equipment = []; energy = []; totals = {}; }
    if (scope === 'equipment') { energy = []; totals = {}; }
    if (scope === 'energy') equipment = [];
    if (scope === 'all' && /사용량|요금|전력|가스|수도|용수/.test(q) && !/설비|사양|모델/.test(q)) equipment = [];
    if (scope === 'all' && !/사용량|요금|전력|가스|수도|용수|에너지/.test(q)) { energy = []; totals = {}; }
    return { equipments: equipment.slice(0, 80), energy: energy.slice(0, 120), totals: totals,
      equipmentCount: equipment.length, energyCount: energy.length,
      truncated: equipment.length > 80 || energy.length > 120,
      range: months.length ? months.join(', ') : year || (monthOnly ? '연도 미지정 · 모든 연도의 ' + monthOnly + '월' : '저장된 기간 전체') };
  }
  function reviewRows(rows) {
    return (Array.isArray(rows) ? rows : []).slice(0, 200).map(function (r) {
      var o = Object.assign({}, r), warnings = [];
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(o.ym || '')) warnings.push('연월 확인');
      if (typeof o.usage !== 'number' || !Number.isFinite(o.usage) || o.usage < 0) warnings.push('사용량 확인');
      if (['전력','수도','가스','압축공기','열'].indexOf(o.kind) < 0) warnings.push('종류 확인');
      if (!/^(kWh|MWh|Nm³|Nm3|N㎥|m³|m3|㎥|Gcal|MJ|TOE|톤|ton|L|㎘)$/i.test(o.unit || '')) warnings.push('단위 확인');
      if (o.confidence === 'low') warnings.push('모델 판독 불확실');
      o.source = o.source || o.evidence || '';
      if (!o.source) warnings.push('원문 근거 확인');
      o.cost = typeof o.cost === 'number' && Number.isFinite(o.cost) && o.cost >= 0 ? o.cost : null;
      o.warnings = warnings;
      return o;
    });
  }
  return { search: search, reviewRows: reviewRows };
});
