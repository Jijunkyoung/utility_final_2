/**
 * schedule.js — 언제 무엇을 해야 하는지 계산한다 (순수 함수)
 *
 * 이 시스템이 실제로 값을 내는 지점은 **날짜 계산**이다.
 *   · 법정검사가 언제 돌아오는가 → 한 달 전에 알려야 한다
 *   · 소모품 교체 주기가 됐는가
 *   · 내년에 돈이 얼마나 드는가
 *
 * 날짜 계산은 눈으로 검산하기 어려워 조용히 틀리기 쉽다.
 * 그래서 화면과 분리해 Node 에서 그대로 검사한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Schedule = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 'YYYY-MM-DD' → Date(현지 0시). 시간대에 휘둘리지 않게 직접 뜯는다. */
  function parseDate(v) {
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    // 2026-02-30 같은 값은 3월로 넘어간다 — 되돌려 확인해 걸러 낸다
    if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d;
  }

  function fmt(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * 개월 단위로 더한다.
   *
   * ⚠ 말일 처리가 함정이다. 1월 31일 + 1개월을 그냥 더하면 3월 3일이 된다
   *   (2월에 31일이 없어 넘어간다). 검사 주기가 조용히 이틀 밀린다.
   *   그래서 그 달의 마지막 날로 붙인다 — 1월 31일 + 1개월 = 2월 28/29일.
   */
  function addMonths(d, months) {
    if (!d) return null;
    var y = d.getFullYear(), m = d.getMonth() + months, day = d.getDate();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  }

  /** 두 날짜 사이 일수 (b - a). 시간은 보지 않는다. */
  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  /**
   * 다음 검사일과 알림 상태.
   *
   * @param last     마지막 검사일
   * @param months   검사 주기(개월)
   * @param today    기준일
   * @param leadDays 며칠 전에 알릴지 (기본 30 — 기획서의 "한 달 전")
   */
  function nextInspection(last, months, today, leadDays) {
    var l = parseDate(last), t = parseDate(today) || new Date();
    var lead = leadDays === undefined ? 30 : leadDays;
    if (!months || !Number.isFinite(Number(months)) || Number(months) <= 0) {
      return { next: null, dday: null, status: '주기 없음',
               why: '검사 주기가 정해지지 않았습니다' };
    }
    if (!l) {
      // 마지막 검사일을 모르면 다음 검사일도 모른다. 오늘 기준으로 세면
      // 이미 지난 검사를 안 지난 것처럼 만든다.
      return { next: null, dday: null, status: '이력 없음',
               why: '마지막 검사일이 없어 다음 검사일을 알 수 없습니다' };
    }
    var next = addMonths(l, Number(months));
    var dday = daysBetween(t, next);
    var status;
    if (dday < 0) status = '기한 초과';
    else if (dday === 0) status = '오늘';
    else if (dday <= lead) status = '알림';
    else status = '여유';
    return { next: next, nextText: fmt(next), dday: dday, status: status, why: '' };
  }

  /** 소모품 교체 — 검사와 같은 규칙이되 낱말만 다르다 */
  function nextReplacement(last, months, today, leadDays) {
    var r = nextInspection(last, months, today, leadDays === undefined ? 14 : leadDays);
    if (r.status === '이력 없음') r.why = '마지막 교체일이 없어 다음 교체일을 알 수 없습니다';
    return r;
  }

  /**
   * 내년 예상 비용.
   *
   * 기준 연도 안에 **돌아오는 횟수**를 세어 곱한다.
   * 주기가 6개월이면 한 해에 두 번이므로 두 배가 된다 — 한 번으로 세면 절반으로 잡힌다.
   */
  function forecastYear(items, year) {
    var start = new Date(year, 0, 1), end = new Date(year, 11, 31);
    var lines = [], total = 0, unknown = [];
    (items || []).forEach(function (it) {
      var months = Number(it.cycleMonths);
      var last = parseDate(it.lastDate);
      // ⚠ Number(null) 은 0 이다. 그냥 Number() 로 바꾸면 **비용 미상이 0 원으로 집계된다.**
      //   합계는 멀쩡해 보이고 어디에도 표가 나지 않는다. 빈 문자열도 마찬가지다.
      //   그래서 "값이 있는가"를 먼저 묻고 그 다음에 숫자로 바꾼다.
      var hasCost = it.cost !== null && it.cost !== undefined && String(it.cost).trim() !== '';
      var cost = hasCost ? Number(it.cost) : NaN;
      if (!months || months <= 0 || !last) {
        unknown.push(it.name + ' — ' + (!last ? '마지막 일자 없음' : '주기 없음'));
        return;
      }
      if (!Number.isFinite(cost)) {
        // 비용을 모르면 **0 으로 세지 않는다.** 0 으로 세면 예산이 적게 잡히고
        // 그 사실이 어디에도 드러나지 않는다.
        unknown.push(it.name + ' — 비용 미상');
        return;
      }
      var n = 0, d = addMonths(last, months);
      var guard = 0;
      while (d <= end && guard++ < 400) {
        if (d >= start) n++;
        d = addMonths(d, months);
      }
      if (n > 0) {
        lines.push({ name: it.name, kind: it.kind || '', count: n, unit: cost, sum: n * cost });
        total += n * cost;
      }
    });
    lines.sort(function (a, b) { return b.sum - a.sum; });
    return { year: year, lines: lines, total: total, unknown: unknown };
  }

  return { parseDate: parseDate, fmt: fmt, addMonths: addMonths, daysBetween: daysBetween,
           nextInspection: nextInspection, nextReplacement: nextReplacement,
           forecastYear: forecastYear };
});
