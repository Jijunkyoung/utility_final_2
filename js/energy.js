/**
 * energy.js — 에너지 고지서에서 월별 사용량을 뽑는다
 *
 * 고지서 PDF 는 회사마다 생김새가 다르다. 표로 된 것, 문장으로 된 것,
 * 한 장에 여러 달이 든 것. 그래서 **줄 단위로 "연월 + 숫자 + 단위"를 찾는** 방식으로 간다.
 * 표 구조를 가정하면 다른 양식에서 통째로 못 읽는다.
 *
 * ⚠ 못 읽은 것을 0 으로 채우지 않는다.
 *   사용량이 0 인 달과 못 읽은 달은 완전히 다른데, 그래프에서는 똑같이 바닥에 붙는다.
 *   "3월에 전기를 안 썼다"는 그래프를 보고 원인을 찾으러 다니게 된다.
 *   그래서 못 읽으면 **행 자체를 만들지 않고** 몇 줄을 못 읽었는지 알린다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Energy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHART_KINDS = ['전력', '수도', '가스', '압축공기'];

  /** '125,400' → 125400 · 못 읽으면 null */
  function num(s) {
    if (s == null) return null;
    var t = String(s).replace(/[,\s]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    var n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  // 흔한 단위. 대소문자를 가리지 않는다.
  var UNIT = /(kWh|MWh|Nm3|N㎥|m3|m³|㎥|Gcal|MJ|TOE|톤|ton|L|㎘)/i;

  // 연월 — '2026년 1월' · '2026-01' · '2026.01'
  var YM = /(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*월?/;
  var MONTH = /(\d{1,2})\s*월(?:분)?/;

  /** 사용량 앞뒤에 붙는 낱말로 종류를 짐작한다 */
  function guessKind(line) {
    if (/압축\s*공기|압공|콤프레[서샤]|compress(?:ed)?\s*air/i.test(line)) return '압축공기';
    if (/전력|전기|kwh|mwh/i.test(line)) return '전력';
    if (/가스|lng|도시가스/i.test(line)) return '가스';
    if (/수도|용수|상수/i.test(line)) return '수도';
    if (/열|스팀|증기|gcal/i.test(line)) return '열';
    return '기타';
  }

  function documentYear(text) {
    var years = String(text || '').match(/(?:19|20)\d{2}/g) || [];
    for (var i = 0; i < years.length; i++) {
      var y = Number(years[i]);
      if (y >= 1990 && y <= 2100) return y;
    }
    return null;
  }

  /** 날짜 줄과 사용량 줄이 PDF 표에서 갈라져도 가까운 두 줄까지 함께 읽는다. */
  function nearby(lines, index) {
    var parts = [lines[index]];
    for (var i = index + 1; i < lines.length && i <= index + 2; i++) {
      var next = lines[i].replace(/\s+/g, ' ').trim();
      if (!next) continue;
      if (YM.test(next) || MONTH.test(next)) break;
      parts.push(next);
    }
    return parts.join(' ');
  }

  function usageFrom(text) {
    var byUnit = new RegExp('(-?[\\d,]+(?:\\.\\d+)?)\\s*' + UNIT.source, 'i').exec(text);
    if (byUnit) return { usage: num(byUnit[1]), unit: byUnit[2] || '' };
    var byLabel = /(?:사용량|당월사용|검침량|사용)[^\d-]{0,16}(-?[\d,]+(?:\.\d+)?)/i.exec(text);
    return byLabel ? { usage: num(byLabel[1]), unit: '' } : null;
  }

  /**
   * 글에서 월별 사용량을 뽑는다.
   * @returns {{rows:Array, note:string, skipped:number}}
   */
  function parseUsage(text) {
    var sourceText = String(text || '');
    var lines = sourceText.split(/\r?\n/);
    var fallbackYear = documentYear(sourceText);
    var byYm = {};           // 같은 달·같은 종류가 두 번 나오면 나중 것이 이긴다
    var order = [];
    var looked = 0, skipped = 0;

    lines.forEach(function (raw, lineIndex) {
      var line = raw.replace(/\s+/g, ' ').trim();
      if (!line) return;
      var ym = YM.exec(line);
      var monthOnly = ym ? null : MONTH.exec(line);
      if (!ym && (!monthOnly || !fallbackYear)) return;
      looked++;

      var y = ym ? +ym[1] : fallbackYear;
      var mo = ym ? +ym[2] : +monthOnly[1];
      if (mo < 1 || mo > 12) { skipped++; return; }        // 13월은 버린다
      if (y < 1990 || y > 2100) { skipped++; return; }

      var context = nearby(lines, lineIndex);
      var found = usageFrom(context);
      if (!found || found.usage === null) { skipped++; return; }

      // 두 번째 숫자가 요금인지 본다 — '요금'·'원'·'금액' 이 붙어 있어야 인정한다.
      // 아무 숫자나 요금으로 잡으면 계약전력·역률 같은 것이 요금으로 들어간다.
      var cost = null;
      var costM = /(?:요금|금액|청구|합계)[^\d-]{0,10}(-?[\d,]+)|(-?[\d,]+)\s*원/.exec(context);
      if (costM) cost = num(costM[1] || costM[2]);

      var keyYm = y + '-' + String(mo).padStart(2, '0');
      var kind = guessKind(context);
      var key = keyYm + '|' + kind;
      if (!(key in byYm)) order.push(key);
      byYm[key] = {
        ym: keyYm, year: y, month: mo,
        kind: kind,
        usage: found.usage,
        unit: found.unit,
        cost: cost,                 // 없으면 null — 0 이 아니다
        source: context.slice(0, 160)
      };
    });

    var rows = order.map(function (k) { return byYm[k]; })
                    .sort(function (a, b) {
                      return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.kind.localeCompare(b.kind, 'ko');
                    });

    var note = '';
    if (!rows.length) {
      note = looked
        ? '연월은 찾았지만 사용량 숫자를 읽지 못했습니다 (' + looked + '줄). '
          + '표가 이미지로 된 PDF 일 수 있습니다 — 이 경우 글자가 아니라 그림이라 읽을 수 없습니다.'
        : '연월(예: 2026년 7월 또는 7월)과 사용량을 찾지 못했습니다. 다른 양식이거나 스캔본일 수 있습니다.';
    } else if (skipped) {
      note = rows.length + '개월을 읽었고 ' + skipped + '줄은 건너뛰었습니다.';
    }
    return { rows: rows, note: note, skipped: skipped };
  }

  /** 전월 대비 증감(%) 을 붙인다. 앞 달이 없으면 null — 0% 가 아니다. */
  function withDelta(rows) {
    return (rows || []).map(function (r, i) {
      var prev = i > 0 ? rows[i - 1] : null;
      var delta = null;
      if (prev && prev.kind === r.kind && prev.usage) {
        delta = Math.round((r.usage - prev.usage) / prev.usage * 1000) / 10;
      }
      var o = {}; for (var k in r) o[k] = r[k];
      o.delta = delta;
      return o;
    });
  }

  /** 종류별로 나눈다 — 전력과 가스를 한 축에 그리면 단위가 달라 뜻이 없다 */
  function groupByKind(rows) {
    var g = {};
    (rows || []).forEach(function (r) {
      var kind = r.kind === '기타' ? guessKind(r.source || '') : r.kind;
      var copy = {}; for (var k in r) copy[k] = r[k];
      copy.kind = kind;
      (g[kind] = g[kind] || []).push(copy);
    });
    Object.keys(g).forEach(function (kind) {
      g[kind].sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });
    });
    return g;
  }

  return {
    CHART_KINDS: CHART_KINDS,
    parseUsage: parseUsage, withDelta: withDelta, groupByKind: groupByKind, num: num
  };
});
