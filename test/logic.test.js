/**
 * 날짜 계산 검사
 *
 * 왜 따로 검사하나
 *   날짜는 **눈으로 검산하기 어렵다.** 이틀 밀린 것을 화면에서 알아채기는 거의 불가능하다.
 *   그런데 이 시스템에서 이틀은 "법정검사 기한을 넘겼는가"를 가른다.
 *
 * 무엇을 검사하나
 *   ① 말일 처리 — 1/31 + 1개월이 3/3 이 되면 안 된다
 *   ② 모를 때 지어내지 않는가 — 이력이 없으면 "없다"고 해야지 오늘 기준으로 세면 안 된다
 *   ③ 한 해에 여러 번 돌아오는 주기를 제대로 세는가
 *
 * 실행:  node test/logic.test.js
 */
'use strict';
const S = require('../js/schedule.js');
const L = require('../js/law.js');
const E = require('../js/energy.js');
const St = require('../js/store.js');

let pass = 0;
const fails = [];

function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${what}\n      기대: ${b}\n      실제: ${a}`);
}
function ok(cond, what) { eq(!!cond, true, what); }

/* ── ① 날짜 더하기 — 말일 ─────────────────────────────────────────── */

eq(S.fmt(S.addMonths(S.parseDate('2026-01-31'), 1)), '2026-02-28',
   '1/31 + 1개월 = 2/28 (그냥 더하면 3/3 이 된다)');
eq(S.fmt(S.addMonths(S.parseDate('2024-01-31'), 1)), '2024-02-29',
   '윤년이면 2/29');
eq(S.fmt(S.addMonths(S.parseDate('2026-03-31'), 1)), '2026-04-30',
   '3/31 + 1개월 = 4/30');
eq(S.fmt(S.addMonths(S.parseDate('2026-08-15'), 12)), '2027-08-15',
   '12개월 = 1년');
eq(S.fmt(S.addMonths(S.parseDate('2026-11-30'), 3)), '2027-02-28',
   '해를 넘겨도 말일이 붙는다');

/* ── 잘못된 날짜 ──────────────────────────────────────────────────── */

eq(S.parseDate('2026-02-30'), null, '2/30 은 날짜가 아니다 (3/2 로 넘어가면 안 된다)');
eq(S.parseDate('2026-13-01'), null, '13월은 없다');
eq(S.parseDate(''), null, '빈 값');
eq(S.parseDate('내년 봄'), null, '날짜가 아닌 글자');
eq(S.fmt(S.parseDate('2026.7.5')), '2026-07-05', '점 구분·한 자리도 읽는다');

/* ── ② 검사일 계산 ────────────────────────────────────────────────── */

let r = S.nextInspection('2026-01-15', 12, '2026-08-26');
eq(r.nextText, '2027-01-15', '마지막 1/15 + 12개월');
eq(r.status, '여유', '아직 142일 남았다');

r = S.nextInspection('2025-09-20', 12, '2026-08-26');
eq(r.status, '알림', '20일 남으면 알림 (기본 30일 전)');
eq(r.dday, 25, '남은 일수');

r = S.nextInspection('2025-06-01', 12, '2026-08-26');
eq(r.status, '기한 초과', '이미 지났다');
ok(r.dday < 0, '지난 것은 음수');

r = S.nextInspection('2025-08-26', 12, '2026-08-26');
eq(r.status, '오늘', '바로 오늘이 기한');

/* ── 모를 때 지어내지 않는다 ──────────────────────────────────────── */

r = S.nextInspection(null, 12, '2026-08-26');
eq(r.status, '이력 없음', '마지막 검사일이 없으면 "이력 없음"');
eq(r.next, null, '  → 날짜를 지어내지 않는다');
ok(r.why.length > 0, '  → 왜 모르는지 적는다');

r = S.nextInspection('2026-01-15', null, '2026-08-26');
eq(r.status, '주기 없음', '주기가 없으면 "주기 없음"');
eq(r.next, null, '  → 날짜를 지어내지 않는다');

r = S.nextInspection('2026-01-15', 0, '2026-08-26');
eq(r.status, '주기 없음', '주기 0 도 마찬가지');

/* 소모품은 기본 알림이 14일 전 — 검사보다 짧다 */
r = S.nextReplacement('2026-03-01', 6, '2026-08-26');
eq(r.status, '알림', '9/1 까지 6일 → 알림');
r = S.nextInspection('2026-03-01', 6, '2026-08-26');
eq(r.status, '알림', '같은 날짜라도 검사는 30일 전부터');
r = S.nextReplacement('2026-04-01', 6, '2026-08-26');
eq(r.status, '여유', '10/1 까지 36일 → 소모품은 아직 여유');

/* ── ③ 내년 비용 ──────────────────────────────────────────────────── */

let f = S.forecastYear([
  { name: '필터', kind: '소모품', lastDate: '2026-01-10', cycleMonths: 6, cost: 120000 },
], 2027);
eq(f.lines[0].count, 2, '6개월 주기 → 한 해에 두 번');
eq(f.total, 240000, '  → 두 배로 잡힌다 (한 번으로 세면 절반이 된다)');

f = S.forecastYear([
  { name: '벨트', kind: '소모품', lastDate: '2026-05-01', cycleMonths: 12, cost: 80000 },
], 2027);
eq(f.lines[0].count, 1, '12개월 주기 → 한 번');
eq(f.total, 80000, '  합계');

/* 비용을 모르면 0 으로 세지 않는다 */
f = S.forecastYear([
  { name: '베어링', kind: '소모품', lastDate: '2026-05-01', cycleMonths: 12, cost: null },
  { name: '필터', kind: '소모품', lastDate: '2026-05-01', cycleMonths: 12, cost: 50000 },
], 2027);
eq(f.total, 50000, '비용 미상은 합계에서 뺀다');
eq(f.unknown.length, 1, '  대신 "모른다"고 남긴다');
ok(/비용 미상/.test(f.unknown[0]), '  왜 뺐는지 적는다');

f = S.forecastYear([
  { name: '펌프', lastDate: null, cycleMonths: 12, cost: 10000 },
], 2027);
eq(f.total, 0, '마지막 일자가 없으면 셀 수 없다');
eq(f.unknown.length, 1, '  모르는 것으로 남긴다');

/* 기준 연도 밖은 세지 않는다 */
f = S.forecastYear([
  { name: '먼 것', lastDate: '2026-01-01', cycleMonths: 60, cost: 100 },
], 2027);
eq(f.lines.length, 0, '5년 주기 → 2027 년에는 안 온다');

/* 큰 금액 순으로 나온다 */
f = S.forecastYear([
  { name: '작은것', lastDate: '2026-01-01', cycleMonths: 12, cost: 1000 },
  { name: '큰것', lastDate: '2026-01-01', cycleMonths: 12, cost: 900000 },
], 2027);
eq(f.lines[0].name, '큰것', '큰 금액이 위로');

/* ── ④ 법령 참고표 ────────────────────────────────────────────────── */

const laws = L.lawsFor('승강기');
ok(laws.length > 0, '승강기에 대한 참고 법령이 있다');
ok(laws.every(x => x.law && x.searchUrl), '  법령명과 검색 링크가 함께 온다');
ok(laws.every(x => x.cycleMonths === undefined || x.cycleMonths === null),
   '  주기는 지어내지 않는다 — 용량·종별에 따라 달라 확인해야 한다');

eq(L.lawsFor('듣도보도 못한 설비'), [], '모르는 설비는 빈 배열 (아무거나 붙이지 않는다)');
ok(L.KINDS.length >= 6, '설비 종류 목록이 있다');
ok(L.KINDS.every(k => typeof k === 'string'), '  전부 글자');

/* 확인이 필요한 설비 골라내기 */
const need = L.needsReview([
  { id: 1, name: 'A', kind: '승강기', lawCheckedAt: '2026-08-01', cycleMonths: 12, spec: '15인승' },
  { id: 2, name: 'B', kind: '승강기', lawCheckedAt: null,         cycleMonths: 12, spec: '15인승' },
  { id: 3, name: 'C', kind: '승강기', lawCheckedAt: '2026-08-01', cycleMonths: null, spec: '15인승' },
  { id: 4, name: 'E', kind: '승강기', lawCheckedAt: '2026-08-01', cycleMonths: 12, spec: '' },
], '2026-08-26');
eq(need.map(x => x.id), [2, 3, 4], '법령 미확인·주기 미상·사양 없음을 고른다');
ok(need[0].reasons.length > 0, '  왜 골랐는지 적는다');
ok(/사양/.test(need[2].reasons.join()), '  사양이 없으면 법령 대조가 안 된다고 알린다');

const old = L.needsReview([
  { id: 9, name: 'D', kind: '승강기', lawCheckedAt: '2025-01-01', cycleMonths: 12, spec: '15인승' },
], '2026-08-26');
eq(old.length, 1, '확인한 지 1년이 넘으면 다시 확인 대상');
ok(/지났/.test(old[0].reasons.join()), '  며칠 지났는지 적는다');

/* 설비 상세의 법령 후보는 입력 사양을 보여 주되 적용 여부를 단정하지 않는다 */
const equipmentLaws = L.lawsForEquipment({
  id: 'eq1', name: '온수보일러', kind: '보일러', capacity: '1.5 t/h', pressure: '0.98 MPa'
});
ok(equipmentLaws.length > 0, '설비 종류로 상세 법령 후보를 만든다');
ok(equipmentLaws[0].basis.indexOf('1.5 t/h') >= 0 && equipmentLaws[0].basis.indexOf('0.98 MPa') >= 0,
   '  용량·압력을 검토 입력값으로 함께 보여 준다');
ok(equipmentLaws.every(x => x.cycleMonths === null), '  상세 후보도 검사 주기를 지어내지 않는다');

const reviewed = L.needsReview([
  { id: 'eq1', name: 'A', kind: '보일러', lawCheckedAt: null, cycleMonths: 12, capacity: '1.5 t/h' }
], '2026-08-26', 365, [
  { equipmentId: 'eq1', law: '에너지이용 합리화법', checkedAt: '2026-08-20', needsReview: false }
]);
eq(reviewed.length, 0, '설비별 최신 법령 검토 기록을 확인일로 사용한다');

const recheck = L.needsReview([
  { id: 'eq1', name: 'A', kind: '보일러', cycleMonths: 12, capacity: '1.5 t/h' }
], '2026-08-26', 365, [
  { equipmentId: 'eq1', checkedAt: '2026-08-20', needsReview: true }
]);
ok(/재검토/.test(recheck[0].reasons.join()), '재검토 필요 표시를 확인 필요 목록에 반영한다');

/* ── ⑤ 저장 자료 v1 → v2 하위호환 ───────────────────────────────── */

const migrated = St.normalize({
  equipments: [{ id: 'eq1', name: '온수보일러', building: '본관' }],
  history: [], consumables: [], energy: []
});
eq(migrated.schemaVersion, 2, '이전 자료를 현재 스키마 버전으로 올린다');
ok(Array.isArray(migrated.manuals) && Array.isArray(migrated.lawReviews),
   '  매뉴얼·법령 검토 컬렉션을 빈 배열로 보완한다');
eq(migrated.buildings[0].name, '본관', '  설비의 건물명으로 좌표 레코드를 만든다');
ok(['x', 'y', 'w', 'h'].every(k => Number.isFinite(migrated.buildings[0][k])),
   '  조감도 좌표가 설비와 분리되어 있다');
eq(St.forEquipment([
  { equipmentId: 'eq1', name: 'A' }, { equipmentId: 'eq2', name: 'B' }
], 'eq1').map(x => x.name), ['A'], '설비 ID 기준으로 관련 데이터를 필터링한다');

const removed = St.removeEquipment({
  equipments: [{ id: 'eq1' }, { id: 'eq2' }],
  history: [{ equipmentId: 'eq1' }, { equipmentId: 'eq2' }],
  consumables: [{ equipmentId: 'eq1' }],
  manuals: [{ equipmentId: 'eq1' }],
  lawReviews: [{ equipmentId: 'eq1' }],
  buildings: [], energy: []
}, 'eq1');
eq(removed.equipments.map(x => x.id), ['eq2'], '설비를 삭제한다');
eq(removed.history.map(x => x.equipmentId), ['eq2'], '  다른 설비 이력은 남긴다');
ok(['consumables', 'manuals', 'lawReviews'].every(k => removed[k].length === 0),
   '  연결된 소모품·매뉴얼·법령 기록도 함께 삭제한다');

/* ── ⑥ 에너지 사용량 읽기 ────────────────────────────────────────── */

let g = E.parseUsage(`
2026년 1월 전력 사용량 125,400 kWh 요금 18,310,000 원
2026년 2월 전력 사용량 118,900 kWh 요금 17,240,000 원
`);
eq(g.rows.length, 2, '두 달을 읽는다');
eq(g.rows[0].ym, '2026-01', '연월');
eq(g.rows[0].usage, 125400, '천단위 쉼표를 걷어낸다');
eq(g.rows[0].cost, 18310000, '요금도 읽는다');

g = E.parseUsage('2026-03  가스  3,210 m3');
eq(g.rows[0].ym, '2026-03', 'YYYY-MM 형식도 읽는다');
eq(g.rows[0].unit, 'm3', '단위를 그대로 둔다');
eq(g.rows[0].cost, null, '요금이 없으면 0 이 아니라 null');

g = E.parseUsage('2026년 7월 전력 사용량 98,700 kWh');
eq(g.rows[0].ym, '2026-07', '1월이 없어도 7월 한 달만 읽는다');

g = E.parseUsage('2026년 전기요금 고지서\n청구월 7월\n사용량 88,400 kWh');
eq(g.rows[0].ym, '2026-07', '연도와 월·사용량이 다른 줄이어도 조합한다');

g = E.parseUsage(`
2026년 7월 수도 사용량 1,200 m3
2026년 7월 도시가스 사용량 3,400 Nm3
2026년 7월 압축공기 사용량 8,900 Nm3
`);
eq(g.rows.length, 3, '같은 달의 서로 다른 에너지 종류를 모두 남긴다');
eq(g.rows.map(r => r.kind).sort(), ['가스', '수도', '압축공기'].sort(),
   '수도·가스·압축공기를 기타가 아닌 별도 종류로 나눈다');
eq(Object.keys(E.groupByKind(g.rows)).sort(), ['가스', '수도', '압축공기'].sort(),
   '수도·가스·압축공기가 각각 별도 그래프 묶음이 된다');

g = E.parseUsage('아무 숫자도 없는 글');
eq(g.rows.length, 0, '못 읽으면 빈 배열');
ok(g.note.length > 0, '  왜 못 읽었는지 알린다');

g = E.parseUsage('2026년 13월 전력 999 kWh');
eq(g.rows.length, 0, '13월은 버린다');

/* 같은 달이 두 번 나오면 뒤엣것으로 덮는다 (재발행 고지서) */
g = E.parseUsage(`
2026년 1월 전력 100 kWh
2026년 1월 전력 120 kWh
`);
eq(g.rows.length, 1, '같은 달은 하나로');
eq(g.rows[0].usage, 120, '  나중 값으로');

/* 월 순서대로 정렬 */
g = E.parseUsage(`
2026년 3월 전력 300 kWh
2026년 1월 전력 100 kWh
`);
eq(g.rows.map(r => r.ym), ['2026-01', '2026-03'], '연월 순으로 정렬');

/* ── 결과 ────────────────────────────────────────────────────────── */
console.log('─'.repeat(62));
if (fails.length) {
  fails.forEach(f => console.log('  ❌ ' + f));
  console.log('─'.repeat(62));
  console.log(`  통과 ${pass} · 실패 ${fails.length}`);
  process.exit(1);
}
console.log(`  ✅ ${pass}개 모두 통과`);
process.exit(0);
