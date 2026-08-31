/**
 * analysis.js — 매뉴얼·법령의 보수적인 규칙 분석과 AI 요청 형식
 *
 * AI가 없어도 근거 문장을 추려 주되, 법적 적합 판정을 지어내지 않는다.
 * 로컬/외부 AI 결과도 사용자가 확인하기 전에는 일정이나 판정에 반영하지 않는다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Analysis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function text(v) { return v == null ? '' : String(v).trim(); }
  function compact(v) { return text(v).replace(/\s+/g, ' '); }
  function lines(input) {
    return text(input).split(/(?:\r?\n|(?<=[.!?]))\s+/)
      .map(compact).filter(function (s) { return s.length >= 8; });
  }

  function lawDiff(previousValue, currentValue) {
    var before = lines(previousValue), after = lines(currentValue);
    var beforeSet = {}, afterSet = {};
    before.forEach(function (s) { beforeSet[s] = true; });
    after.forEach(function (s) { afterSet[s] = true; });
    var removed = before.filter(function (s) { return !afterSet[s]; });
    var added = after.filter(function (s) { return !beforeSet[s]; });
    var changed = added.length > 0 || removed.length > 0;
    return {
      changed: changed,
      added: added.slice(0, 100),
      removed: removed.slice(0, 100),
      summary: changed
        ? '추가 ' + added.length + '개 · 삭제/변경 전 ' + removed.length + '개 문장을 확인했습니다.'
        : '문장 단위 변경이 없습니다.'
    };
  }

  function missingLawSpecs(equipment, content) {
    var e = equipment || {}, source = text(content), checks = [
      { label: '용량', keys: ['capacity'], pattern: /용량|출력|톤|kW|MW|RT/i },
      { label: '유량', keys: ['flow'], pattern: /유량|m³\/h|m3\/h|Nm³\/h|Nm3\/h/i },
      { label: '압력', keys: ['pressure'], pattern: /압력|MPa|kPa/i },
      { label: '소모전력', keys: ['power'], pattern: /소모전력|소비전력|정격전력/i },
      { label: '냉난방능력', keys: ['hvac'], pattern: /냉방능력|난방능력|냉난방능력|냉동능력/i },
      { label: '법정선임관리자', keys: ['legalManagerId', 'legalMgr'], pattern: /법정선임|선임.*관리자|관리자.*선임/ },
      { label: '검사주기', keys: ['cycleMonths'], pattern: /검사주기|정기검사|매\s*\d+\s*(?:개월|년)/ }
    ];
    return checks.filter(function (check) {
      return check.pattern.test(source) && !check.keys.some(function (key) {
        return e[key] !== null && e[key] !== undefined && String(e[key]).trim() !== '';
      });
    }).map(function (check) { return check.label; });
  }

  function cycleOf(sentence) {
    var m = /(\d[\d,]*(?:\.\d+)?)\s*(시간|일|주|개월|달|년)\s*(?:마다|주기|이내|후)?/.exec(sentence);
    if (!m) return { cycleText: '', cycleMonths: null };
    var n = Number(m[1].replace(/,/g, '')), unit = m[2], months = null;
    if (unit === '개월' || unit === '달') months = n;
    else if (unit === '년') months = n * 12;
    return { cycleText: m[0], cycleMonths: months };
  }

  var PARTS = [
    ['흡입 필터', /흡입\s*필터|에어\s*필터/], ['오일 필터', /오일\s*필터/],
    ['필터', /필터/], ['윤활유', /윤활유|오일\s*교환/], ['벨트', /벨트/],
    ['베어링', /베어링/], ['패킹', /패킹|가스켓/], ['배터리', /배터리|축전지/],
    ['냉매', /냉매/], ['안전밸브', /안전\s*밸브/]
  ];

  function itemName(sentence, fallback) {
    for (var i = 0; i < PARTS.length; i++) if (PARTS[i][1].test(sentence)) return PARTS[i][0];
    var m = /([가-힣A-Za-z0-9·\- ]{2,24})(?:을|를|은|는|의)?\s*(?:교체|교환|점검|검사|청소|확인)/.exec(sentence);
    return compact(m ? m[1] : fallback).slice(0, 30);
  }

  function unique(items) {
    var seen = {};
    return items.filter(function (x) {
      var key = x.name + '|' + x.cycleText + '|' + x.evidence;
      if (seen[key]) return false; seen[key] = true; return true;
    });
  }

  function manual(textValue) {
    var source = lines(textValue), consumables = [], inspections = [];
    source.forEach(function (s) {
      var cycle = cycleOf(s);
      if (/교체|교환|보충/.test(s) && PARTS.some(function (p) { return p[1].test(s); })) {
        consumables.push({ name: itemName(s, '소모품'), cycleText: cycle.cycleText,
          cycleMonths: cycle.cycleMonths, evidence: s.slice(0, 240) });
      }
      if (/점검|검사|청소|교정|확인/.test(s)) {
        inspections.push({ name: itemName(s, '정기점검'), cycleText: cycle.cycleText,
          cycleMonths: cycle.cycleMonths, evidence: s.slice(0, 240) });
      }
    });
    return {
      provider: 'rules',
      summary: source.slice(0, 4).join(' ').slice(0, 600) || '분석할 수 있는 본문이 없습니다.',
      consumables: unique(consumables).slice(0, 30),
      inspections: unique(inspections).slice(0, 30),
      warnings: source.length ? [] : ['PDF가 스캔 이미지이거나 지원하지 않는 문서 형식일 수 있습니다.']
    };
  }

  function equipmentValue(e, field) {
    var labels = { legalMgr: '법정선임관리자', cycleMonths: '검사주기', pressure: '압력',
      capacity: '용량', hvac: '냉난방능력', spec: '기타사양' };
    var v = e && e[field];
    return { label: labels[field] || field, value: text(v) };
  }

  function fieldsFor(requirement) {
    var out = [];
    if (/용량|능력|출력|톤|kW|MW|RT/i.test(requirement)) out.push('capacity');
    if (/압력|MPa|kPa/i.test(requirement)) out.push('pressure');
    if (/냉동|냉난방/.test(requirement)) out.push('hvac');
    if (/선임|관리자|조종자/.test(requirement)) out.push('legalMgr');
    if (/주기|정기검사|정기점검/.test(requirement)) out.push('cycleMonths');
    return out.length ? out.filter(function (v, i, a) { return a.indexOf(v) === i; }) : ['spec'];
  }

  function articleOf(requirement) {
    var m = /(?:제\s*)?\d+\s*조(?:의\s*\d+)?(?:\s*(?:제\s*)?\d+\s*항)?/.exec(requirement);
    return compact(m && m[0]);
  }

  function thresholdOf(requirement) {
    var m = /(\d[\d,.]*\s*(?:kW|MW|RT|kcal\/h|t\/h|톤|마력|m³\/h|Nm³\/h|MPa|kPa|명|대)\s*(?:이상|초과|이하|미만))/i.exec(requirement);
    return compact(m && m[1]);
  }

  function detailedRequirement(requirement, actuals) {
    var source = compact(requirement), article = articleOf(source), threshold = thresholdOf(source);
    var out = (article ? article + '의 적용 내용으로 ' : '저장된 법령 자료에는 ')
      + '“' + source.replace(/[.。]$/, '') + '”라고 기록되어 있습니다.';
    if (threshold) out += ' 원문에서 확인된 적용 기준은 ' + threshold + '입니다.';
    (actuals || []).forEach(function (actual) {
      out += ' 해당 설비의 ' + actual.label + '은(는) ' + (actual.value || '미입력') + '입니다.';
    });
    if (!article || !threshold) {
      var missing = [];
      if (!article) missing.push('조문 번호');
      if (!threshold) missing.push('정량 기준');
      out += ' ' + missing.join('·') + '은 저장된 원문에서 확인되지 않아 담당자가 원문을 추가 확인해야 합니다.';
    }
    return out;
  }

  function enrichLawRows(equipment, rows) {
    return (rows || []).map(function (row) {
      var fields = fieldsFor(row.requirement || ''), actuals = fields.map(function (field) {
        return equipmentValue(equipment || {}, field);
      });
      var out = Object.assign({}, row);
      out.equipmentField = actuals.map(function (a) { return a.label; }).join(' / ');
      out.equipmentValue = actuals.map(function (a) { return a.value || '미입력'; }).join(' / ');
      out.requirementDetail = detailedRequirement(out.requirement || '저장된 법령 원문을 확인해야 합니다.', actuals);
      if (actuals.some(function (a) { return !a.value; })) out.status = '정보 부족';
      return out;
    });
  }

  function law(equipment, documents) {
    var rows = [];
    (documents || []).forEach(function (doc) {
      var obligations = lines(doc.content).filter(function (s) {
        return /하여야|해야|검사|점검|선임|기준|용량|압력|허가|신고/.test(s);
      }).slice(0, 20);
      if (!obligations.length) obligations = [doc.about || '저장된 법령 원문을 확인해야 합니다.'];
      obligations.forEach(function (requirement) {
        var fields = fieldsFor(requirement), actuals = fields.map(function (field) {
          return equipmentValue(equipment || {}, field);
        });
        rows.push({ law: doc.law, sourceId: doc.id, requirement: requirement.slice(0, 300),
          equipmentField: actuals.map(function (a) { return a.label; }).join(' / '),
          equipmentValue: actuals.map(function (a) { return a.value || '미입력'; }).join(' / '),
          requirementDetail: detailedRequirement(requirement, actuals),
          status: actuals.every(function (a) { return a.value; }) ? '확인 필요' : '정보 부족',
          evidence: doc.effectiveDate ? '시행일 ' + doc.effectiveDate : (doc.sourceUrl || '내부 저장 자료'),
          action: actuals.every(function (a) { return a.value; }) ? '담당자가 법령 조건과 수치를 대조하세요.'
            : actuals.filter(function (a) { return !a.value; }).map(function (a) { return a.label; }).join(', ') + '을(를) 입력하세요.' });
      });
    });
    return { provider: 'rules', rows: rows, warning: '자동 결과는 참고용이며 담당자의 최종 확인이 필요합니다.' };
  }

  function prompt(kind, equipment, textValue) {
    var schema = kind === 'manual'
      ? '{"summary":"...","consumables":[{"name":"","cycleText":"","cycleMonths":null,"evidence":""}],"inspections":[{"name":"","cycleText":"","cycleMonths":null,"evidence":""}],"warnings":[]}'
      : '{"rows":[{"law":"","article":"제00조 제0항 또는 확인 불가","threshold":"원문 기준 수치 또는 확인 불가","requirement":"원문 요구사항","requirementDetail":"조문·기준 수치·현재 설비 입력값을 포함한 상세 비교 설명","equipmentField":"","equipmentValue":"","status":"충족|미충족|확인 필요|정보 부족","evidence":"원문 인용","action":""}],"warning":""}';
    return '당신은 공장 유틸리티 설비 문서 검토 보조자입니다. 문서에 없는 값과 검사주기를 추측하지 마세요. '
      + '모든 결과에는 원문 근거를 넣고 JSON만 반환하세요.\n설비정보: '
      + JSON.stringify(equipment || {}) + '\n문서:\n' + text(textValue).slice(0, 60000)
      + '\n반환형식: ' + schema;
  }

  function normalizeAi(kind, value) {
    var out = value;
    if (typeof out === 'string') {
      try { out = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch (e) { return null; }
    }
    if (!out || typeof out !== 'object') return null;
    if (kind === 'manual' && !Array.isArray(out.consumables)) return null;
    if (kind === 'law' && !Array.isArray(out.rows)) return null;
    return out;
  }

  return { manual: manual, law: law, lawDiff: lawDiff, missingLawSpecs: missingLawSpecs,
    enrichLawRows: enrichLawRows,
    prompt: prompt, normalizeAi: normalizeAi, cycleOf: cycleOf };
});
