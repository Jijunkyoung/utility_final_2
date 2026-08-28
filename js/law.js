/**
 * law.js — 설비 종류로 관련 법령을 찾아 주고, 확인이 필요한 것을 골라낸다
 *
 * ⚠ 이 파일이 하지 않는 일을 먼저 적는다.
 *
 * **검사 주기(개월)를 알려 주지 않는다.**
 *   같은 "보일러"라도 용량·종별·설치 장소에 따라 주기가 다르다.
 *   숫자 하나를 박아 두면 그럴듯해 보이고, 그래서 아무도 다시 확인하지 않는다.
 *   틀린 주기로 법정검사를 놓치면 그건 실제 피해다.
 *   그래서 **주기는 사람이 확인해 입력하는 값**으로 두고, 여기서는 어디를 봐야 하는지만 준다.
 *
 * **법령을 자동으로 받아 오지 않는다.**
 *   기획서는 국가법령정보센터 Open API 를 쓰자고 했지만 두 가지가 걸린다.
 *     · 인증키와 서버가 필요하다 — 브라우저만으로는 안 된다
 *     · 사내 폐쇄망에서는 애초에 바깥으로 못 나간다
 *   대신 **"확인해야 할 것" 목록을 뽑아 주고 검색 링크를 건다.**
 *   자동 발송 대신 할 일 목록이 되는 셈인데, 폐쇄망에서도 돌고
 *   틀린 법령 정보가 자동으로 퍼질 위험도 없다.
 *
 * 아래 법령명은 실재하는 법률 이름이다. 조문·주기는 담지 않았다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Law = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEARCH = 'https://www.law.go.kr/lsSc.do?menuId=1&query=';

  /**
   * 설비 종류 → 관련 법령.
   * cycleMonths 를 일부러 넣지 않았다 (위 설명 참조).
   */
  var TABLE = {
    '승강기': [
      { law: '승강기 안전관리법', about: '설치검사·정기검사·정밀안전검사' }
    ],
    '수변전설비': [
      { law: '전기안전관리법', about: '전기설비 정기검사·안전관리자 선임' }
    ],
    '비상발전기': [
      { law: '전기안전관리법', about: '전기설비 정기검사' },
      { law: '대기환경보전법', about: '배출시설에 해당하는 경우' }
    ],
    '보일러': [
      { law: '에너지이용 합리화법', about: '검사대상기기 검사·조종자 선임' },
      { law: '산업안전보건법', about: '안전검사 대상에 해당하는 경우' }
    ],
    '압력용기': [
      { law: '산업안전보건법', about: '안전검사' },
      { law: '고압가스 안전관리법', about: '고압가스에 해당하는 경우' }
    ],
    '냉동기': [
      { law: '고압가스 안전관리법', about: '냉동제조시설 허가·검사' },
      { law: '에너지이용 합리화법', about: '검사대상기기에 해당하는 경우' }
    ],
    '공조기': [
      { law: '실내공기질 관리법', about: '적용 대상 건축물인 경우' }
    ],
    '소방시설': [
      { law: '화재의 예방 및 안전관리에 관한 법률', about: '자체점검·안전관리자 선임' },
      { law: '소방시설 설치 및 관리에 관한 법률', about: '설치·관리 기준' }
    ],
    '대기오염방지시설': [
      { law: '대기환경보전법', about: '배출시설 신고·자가측정' }
    ],
    '폐수처리시설': [
      { law: '물환경보전법', about: '배출시설 신고·자가측정·기술인 선임' }
    ],
    '위험물저장시설': [
      { law: '위험물안전관리법', about: '정기점검·안전관리자 선임' }
    ],
    '지하수시설': [
      { law: '지하수법', about: '수질검사' }
    ],
    '기타': []
  };

  var KINDS = Object.keys(TABLE);

  /** 관련 법령 + 검색 링크. 모르는 종류면 빈 배열 — 아무거나 붙이지 않는다. */
  function lawsFor(kind) {
    var list = TABLE[kind];
    if (!list) return [];
    return list.map(function (x) {
      return {
        law: x.law,
        about: x.about,
        // 주기는 담지 않는다. 있는 것처럼 보이면 확인하지 않게 된다.
        cycleMonths: null,
        searchUrl: SEARCH + encodeURIComponent(x.law)
      };
    });
  }

  function value(v) { return v == null ? '' : String(v).trim(); }

  /**
   * 상세 화면용 후보. 설비 종류로 후보를 좁히되, 입력된 사양은 검토 근거로만 보여 준다.
   * 용량·압력 값으로 적용 여부나 검사 주기를 자동 판정하지 않는다.
   */
  function lawsForEquipment(equipment) {
    var e = equipment || {};
    var facts = [
      ['설비명', e.name], ['종류', e.kind], ['사양', e.spec], ['용량', e.capacity],
      ['유량', e.flow], ['압력', e.pressure], ['냉난방용량', e.hvac]
    ].filter(function (x) { return value(x[1]); });
    var missing = [
      ['사양', e.spec], ['용량', e.capacity], ['압력', e.pressure], ['냉난방용량', e.hvac]
    ].filter(function (x) { return !value(x[1]); }).map(function (x) { return x[0]; });
    var basis = facts.map(function (x) { return x[0] + ' ' + value(x[1]); }).join(' · ');
    return lawsFor(e.kind).map(function (x) {
      return {
        law: x.law,
        about: x.about,
        cycleMonths: null,
        basis: basis,
        missing: missing.slice()
      };
    });
  }

  function latestReview(equipmentId, lawReviews) {
    var mine = (lawReviews || []).filter(function (r) {
      return r.equipmentId === equipmentId && parse(r.checkedAt);
    }).sort(function (a, b) { return a.checkedAt < b.checkedAt ? 1 : -1; });
    return mine.length ? mine[0] : null;
  }

  /** 며칠 지났는지 */
  function daysSince(dateStr, today) {
    var a = parse(dateStr), b = parse(today) || new Date();
    if (!a) return null;
    return Math.round((b - a) / 86400000);
  }
  function parse(v) {
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d;
  }

  /**
   * 사람이 법령을 다시 확인해야 하는 설비를 고른다.
   *
   * 기획서 4번(법령 개정 모니터링)을 폐쇄망에서 할 수 있는 형태로 바꾼 것이다.
   * 개정 여부를 자동으로 알 수는 없으니, **오래 확인하지 않은 것**과
   * **법령 비교에 필요한 값이 빠진 것**을 대신 뽑는다.
   *
   * @param staleDays 며칠이 지나면 다시 확인할지 (기본 365)
   */
  function needsReview(equipments, today, staleDays, lawReviews) {
    var limit = staleDays === undefined ? 365 : staleDays;
    var out = [];
    (equipments || []).forEach(function (e) {
      var reasons = [];
      var review = latestReview(e.id, lawReviews);
      var checkedAt = review ? review.checkedAt : e.lawCheckedAt;
      var d = daysSince(checkedAt, today);
      if (d === null) reasons.push('법령을 확인한 기록이 없습니다');
      else if (d > limit) reasons.push('확인한 지 ' + d + '일 지났습니다');

      if (review && review.needsReview === true) {
        reasons.push('최근 검토에서 재검토 필요로 표시했습니다');
      }

      if (!e.cycleMonths || Number(e.cycleMonths) <= 0) {
        reasons.push('법정검사 주기가 입력되지 않았습니다 — 용량·종별에 따라 다르므로 확인이 필요합니다');
      }
      // 법령을 대조하려면 사양이 있어야 한다. 없으면 비교 자체가 안 된다.
      if (![e.spec, e.capacity, e.pressure, e.hvac].some(function (v) { return value(v); })) {
        reasons.push('사양이 비어 있어 법령 적용 여부를 대조할 수 없습니다');
      }
      if (reasons.length) out.push({ id: e.id, name: e.name, kind: e.kind, reasons: reasons });
    });
    return out;
  }

  return {
    KINDS: KINDS, lawsFor: lawsFor, lawsForEquipment: lawsForEquipment,
    latestReview: latestReview, needsReview: needsReview, SEARCH: SEARCH
  };
});
