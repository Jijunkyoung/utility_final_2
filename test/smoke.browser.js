/* 브라우저에 실제로 띄워 아홉 장이 그려지는지 본다.
 *
 *   node test/smoke.browser.js
 *
 * 규칙 테스트(test/logic.test.js)가 전부 통과해도 app.js 의 오타 하나면
 * 페이지가 빈 화면이 된다. 규칙은 맞는데 아무도 그것을 볼 수 없는 상태다.
 * 파일을 읽어서는 안 잡힌다 — 실제로 띄워 봐야 잡힌다.
 *
 * 「예시 자료 넣기」 한 번이 설비·소모품·이력·에너지를 모두 넣으므로,
 * 그것을 누르고 아홉 장을 차례로 도는 것이 가장 넓게 훑는 길이다.
 * 자료가 localStorage 에 있으므로 **같은 컨텍스트를 계속 쓴다.**
 *
 * playwright 가 없으면 조용히 건너뛴다. 이것 하나 때문에 다른 테스트가
 * 막히면 아무도 안 돌리게 된다. CI 에서는 설치하고 돌린다.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다 (CI 에서는 설치 후 돌립니다).');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function group(t) { console.log('\n' + t); }
function ok(c, label, detail) {
  if (c) passed++; else { failed++; console.log('  X ' + label); if (detail) console.log('      ' + detail); }
}

/* 정적 서버가 내주는 MIME.
 *
 * ⚠ **.mjs 를 빠뜨리면 안 된다.** 브라우저는 모듈 스크립트의 MIME 을 엄격히
 * 검사해서 octet-stream 으로 오면 실행을 거부한다. 이 앱은 고지서 PDF 를
 * lib/pdf.min.mjs 로 읽는다. 빠뜨리면 에너지 화면이 조용히 멈춘다.
 */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',   /* 한글 CMap — PDF 한글이 빈 문자열이 되지 않게 */
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* 서버가 못 내준 것을 모아 둔다. 테스트가 못 서는 이유가 앱이 아니라
 * 이 서버일 수 있고, 그때 시간 초과만 나면 원인을 못 찾는다. */
var missed = [];

function serve(port) {
  return http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      missed.push(rel);
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}

(async function main() {
  var PORT = 8815;
  var server = serve(PORT);
  var browser = await chromium.launch();
  var errors = [];
  var base = 'http://127.0.0.1:' + PORT + '/';

  function go(p) { return page.goto(base + p, { waitUntil: 'networkidle' }); }
  var page;

  try {
    page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

    group('1. 개요 — 아무것도 없을 때');
    await go('');
    ok(await page.isVisible('#seed'), '「예시 자료 넣기」 단추가 보인다');
    ok(await page.isVisible('#empty-hint'), '자료가 없다는 안내가 보인다');

    group('2. 예시 자료 한 번으로 네 가지가 들어간다');
    await page.click('#seed');
    try {
      await page.waitForSelector('#summary .kpi, #summary .stat, #summary td', { timeout: 15000 });
    } catch (e) {
      /* 시간 초과만 던지면 원인을 알 수 없다. 화면과 서버 상태를 함께 적는다. */
      var dump = (await page.textContent('#summary')).replace(/\s+/g, ' ').slice(0, 160);
      ok(false, '예시를 넣으면 개요에 숫자가 나온다',
         '#summary: ' + (dump || '(비어 있음)') +
         ' | 못 내준 파일: ' + (missed.length ? missed.join(', ') : '없음') +
         ' | 오류: ' + (errors.slice(0, 2).join(' | ') || '없음'));
      throw e;
    }
    /* 저장 열쇠를 여기에 베껴 적지 않는다 — store.js 가 바꾸면 조용히 어긋난다.
     * 앱이 쓰는 Store.load() 를 그대로 부른다. */
    var counts = await page.evaluate(function () {
      var db = Store.load();
      return [ (db.equipments || []).length, (db.consumables || []).length,
               (db.history || []).length, (db.energy || []).length,
               (db.manuals || []).length, (db.lawReviews || []).length,
               (db.buildings || []).length, (db.managers || []).length ];
    });
    ok(counts.every(function (n) { return n > 0; }),
       '설비·소모품·이력·에너지·매뉴얼·법령검토·건물좌표·담당자가 모두 들어갔다 (' + counts.join(' / ') + ')');
    ok(!(await page.isVisible('#empty-hint')), '「자료 없음」 안내가 사라진다');

    group('3. 설비 — 법령은 알려 주되 주기는 알려 주지 않는다');
    await go('equipment.html');
    ok((await page.textContent('#eq-count')).indexOf('0건') < 0,
       '설비 목록에 건수가 나온다 (' + (await page.textContent('#eq-count')).trim() + ')');
    ok(await page.locator('#eq-table tbody tr').count() > 0, '설비 표에 줄이 있다');
    ok(await page.isVisible('#eq-create-open'), '설비 등록은 목록 위 버튼으로 보인다');
    await page.click('#eq-create-open');
    ok(await page.isVisible('#eq-create'), '설비 등록 버튼을 누르면 입력 창이 열린다');
    ok(await page.locator('#eq-form [name="legalManagerId"] option').count() > 1
       && await page.locator('#eq-form [name="maintenanceManagerId"] option').count() > 1,
       '법정선임·유지관리 담당자를 통합 대장에서 고른다');
    var registrationLabels = await page.locator('#eq-form .register-row>label').allTextContents();
    ok(registrationLabels.join('|') === [
      '설비번호','설비명','종류','모델명','제조사','용량','유량','압력','소모전력','냉난방능력',
      '기타사양','위치','세부위치','설치일','법정선임관리자','유지관리자','유지관리자 메일',
      '법정검사','검사주기','검사비용','법령 확인일','매뉴얼 업로드'
    ].join('|'), '설비 등록 항목이 요청 순서대로 한 줄씩 나온다');
    await page.selectOption('#kind', '기타');
    ok(await page.isVisible('#kind-other'), '종류가 기타이면 직접 입력 칸이 열린다');

    /* 이 저장소의 중심 규칙이다. 종류를 고르면 법령은 나오되
     * **주기 숫자를 주지 않는다.** 주면 아무도 다시 확인하지 않는다. */
    await page.selectOption('#kind', '승강기');
    await page.waitForTimeout(120);
    var hint = (await page.textContent('#law-hint')).replace(/\s+/g, ' ');
    ok(hint.indexOf('승강기 안전관리법') >= 0, '관련 법령 이름이 나온다', hint.slice(0, 120));
    ok(await page.locator('#law-hint a').count() > 0, '법령을 찾아볼 링크가 있다');
    ok(hint.indexOf('검사 주기는 여기서 알려 드리지 않습니다') >= 0,
       '주기를 알려 주지 않는다고 분명히 적는다', hint.slice(0, 160));
    ok(!/\d+\s*개월마다|\d+\s*년마다|주기\s*[:：]\s*\d/.test(hint),
       '법령 안내에 주기 숫자를 지어내지 않는다', hint.slice(0, 160));
    await page.click('#eq-create-close');

    group('3-1. 설비 상세 — 다섯 탭이 같은 설비 ID 자료를 저장한다');
    await page.locator('#eq-table [data-detail]').first().click();
    ok(await page.isVisible('#eq-detail'), '상세 패널이 열린다');
    ok(await page.locator('#eq-detail [data-detail-tab]').count() === 5,
       '기본정보·소모품·이력·매뉴얼·법령 탭이 있다');

    await page.click('[data-detail-tab="consumables"]');
    ok(await page.locator('#detail-consumables tbody tr').count() > 0, '설비별 소모품이 나온다');
    await page.click('[data-detail-tab="history"]');
    ok(await page.locator('#detail-history tbody tr').count() > 0, '설비별 이력이 나온다');
    await page.click('[data-detail-tab="manuals"]');
    ok(await page.locator('#detail-manuals li').count() > 0, '설비별 매뉴얼이 나온다');
    await page.fill('#detail-manual-form [name="title"]', '연기 테스트 매뉴얼');
    await page.fill('#detail-manual-form [name="filePath"]', '\\\\fileserver\\test\\manual.pdf');
    await page.click('#detail-manual-save');
    ok((await page.textContent('#detail-manuals')).indexOf('연기 테스트 매뉴얼') >= 0,
       '매뉴얼 경로/메타데이터를 저장한다');
    await page.fill('#detail-manual-form [name="title"]', '필터 교체 매뉴얼');
    await page.setInputFiles('#manual-file', { name: 'manual.txt', mimeType: 'text/plain',
      buffer: Buffer.from('흡입 필터는 6개월마다 교체한다. 안전밸브는 12개월마다 검사한다.', 'utf8') });
    await page.click('#detail-manual-save');
    try {
      await page.waitForSelector('#detail-manual-analysis .analysis-card', { timeout: 8000 });
    } catch (manualError) {
      var manualDiag = await page.evaluate(function () {
        var db = Store.load(), input = document.querySelector('#manual-file');
        return {
          selectedFiles: input && input.files ? input.files.length : -1,
          status: (document.querySelector('#manual-status') || {}).textContent || '',
          analysisHtml: (document.querySelector('#detail-manual-analysis') || {}).innerHTML || '',
          manuals: (db.manuals || []).slice(-3)
        };
      });
      throw new Error('매뉴얼 분석 진단: ' + JSON.stringify(manualDiag)
        + ' | 브라우저 오류: ' + errors.slice(-4).join(' | ') + ' | ' + manualError.message);
    }
    ok(await page.locator('#detail-manual-analysis .analysis-card').count() > 0,
       '업로드한 매뉴얼을 분석해 요약을 표시한다');
    ok((await page.textContent('#detail-manual-analysis')).indexOf('6개월') >= 0
       && await page.locator('[data-apply-manual-consumable]').count() > 0,
       '소모품 교체주기와 일정 등록 버튼을 제안한다');

    await page.click('[data-detail-tab="laws"]');
    ok(await page.locator('#detail-law-candidates .law-candidate').count() > 0,
       '설비 사양 기반 법령 후보가 나온다');
    await page.locator('#detail-law-candidates [data-law-candidate]').first().click();
    ok(await page.locator('#detail-law-documents .law-document').count() > 0,
       '법령 후보를 눌러 내부 DB 목록에 저장한다');
    await page.click('#detail-law-document-new');
    ok(await page.isEditable('#detail-law-document-form [name="law"]'),
       '자동 후보에 없어도 법령명을 직접 입력할 수 있다');
    await page.fill('#detail-law-document-form [name="law"]', '산업안전보건기준에 관한 규칙');
    await page.fill('#detail-law-document-form [name="about"]', '설비 안전조치 직접 등록 시험');
    await page.fill('#detail-law-document-form [name="sourceUrl"]', 'https://www.law.go.kr/');
    await page.fill('#detail-law-document-form [name="content"]', '사업주는 설비에 필요한 안전조치를 하여야 한다.');
    await page.click('#detail-law-document-save');
    ok((await page.textContent('#detail-law-documents')).indexOf('산업안전보건기준에 관한 규칙') >= 0
       && await page.locator('#detail-law-documents a[href^="https://www.law.go.kr/"]').count() > 0,
       '직접 입력한 연관법령과 출처를 해당 설비 내부 DB에 저장한다');
    await page.fill('#detail-law-document-form [name="content"]',
      '제12조 제3항에서는 용량 1.0 t/h 이상인 경우 법정선임관리자를 선임하여야 한다. 설비는 정기검사를 실시하여야 한다.');
    await page.click('#detail-law-document-save');
    await page.click('#detail-law-review-run');
    await page.waitForSelector('#detail-law-comparison .comparison-table tbody tr', { timeout: 5000 });
    ok(await page.locator('#detail-law-comparison .comparison-table tbody tr').count() > 0,
       '저장한 법령과 설비 사양의 비교 검토표를 만든다');
    ok((await page.textContent('#detail-law-comparison')).indexOf('정보 부족') >= 0
       || (await page.textContent('#detail-law-comparison')).indexOf('확인 필요') >= 0,
       '자동 검토가 부족한 정보나 담당자 확인 필요를 분명히 표시한다');
    ok((await page.textContent('#detail-law-comparison')).indexOf('제12조 제3항') >= 0
       && (await page.textContent('#detail-law-comparison')).indexOf('1.0 t/h 이상') >= 0,
       '법령 요구사항에 원문 조문과 정량 기준을 자세히 표시한다');
    await page.locator('#detail-law-comparison tr', { hasText: '산업안전보건기준에 관한 규칙' })
      .locator('[data-law-review-row]').first().click();
    ok(await page.inputValue('#detail-law-form [name="law"]') === '산업안전보건기준에 관한 규칙'
       && (await page.inputValue('#detail-law-form [name="requirement"]')).indexOf('제12조 제3항') >= 0,
       '비교표 버튼을 누르면 법령명과 요구사항이 검토 기록에 자동 입력된다');
    ok(!(await page.isEditable('#detail-law-form [name="law"]'))
       && await page.isEditable('#detail-law-form [name="reviewResult"]'),
       '자동 반영 항목은 잠그고 검토결과만 입력할 수 있다');
    await page.fill('#detail-law-form [name="reviewResult"]', '현장 설비 사양과 원문을 대조함');
    await page.click('#detail-law-save');
    ok((await page.textContent('#detail-laws')).indexOf('현장 설비 사양과 원문을 대조함') >= 0,
       '자동 입력된 요구사항과 검토결과를 설비별로 저장한다');
    ok((await page.textContent('#detail-laws .law-summary')).length < 90
       && await page.locator('#detail-laws [data-law-full]').count() > 0,
       '저장 목록은 요구사항을 짧게 요약하고 전체 글보기 버튼을 제공한다');
    await page.locator('#detail-laws [data-law-full]').first().click();
    ok(await page.isVisible('#law-requirement-dialog')
       && (await page.textContent('#law-requirement-full')).indexOf('제12조 제3항') >= 0,
       '전체 글보기 팝업에서 잘리지 않은 법령 요구사항을 확인한다');
    await page.click('#law-requirement-close');
    await page.click('#detail-close');

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#eq-table [data-detail]').first().click();
    await page.click('[data-detail-tab="manuals"]');
    ok((await page.textContent('#detail-manuals')).indexOf('연기 테스트 매뉴얼') >= 0,
       '새로고침 뒤에도 상세 자료가 유지된다');
    await page.click('#detail-close');

    group('4. 담당자 — 통합 대장과 설비 연결 건수를 관리한다');
    await go('managers.html');
    ok(await page.locator('#manager-table tbody tr').count() > 0, '담당자 통합 대장에 줄이 있다');
    ok((await page.textContent('#manager-stats')).indexOf('연결된 설비') >= 0,
       '담당자와 연결된 설비 건수를 요약한다');
    await page.fill('#manager-form [name="name"]', '연기 담당자');
    await page.fill('#manager-form [name="email"]', 'smoke@example.com');
    await page.click('#manager-save');
    ok((await page.textContent('#manager-table')).indexOf('연기 담당자') >= 0,
       '새 담당자를 대장에 저장한다');

    group('5. 알림 — 시기를 계산하고 문안을 만들어 준다');
    await go('alerts.html');
    ok((await page.textContent('#alert-stats')).trim().length > 0, '알림 요약이 나온다');
    var alerts = (await page.textContent('#insp')) + (await page.textContent('#cons'));
    ok(alerts.replace(/\s+/g, '').length > 0, '검사·교체 목록이 그려진다');
    await page.click('#make-mail');
    await page.waitForTimeout(200);
    var mail = await page.inputValue('#mail-body').catch(function () { return ''; });
    if (!mail) mail = (await page.textContent('#mail-body')) || '';
    ok(mail.replace(/\s+/g, '').length > 0, '담당자별 알림 문안이 만들어진다',
       mail.slice(0, 80));
    ok(await page.isVisible('#copy-mail'), 'SMTP 미설정 환경을 위한 수동 복사 단추가 있다');
    await page.click('#queue-alerts');
    ok(await page.locator('#notification-table [data-notice-approve]').count() > 0,
       '임박한 검사·교체 알림을 승인 대기함에 추가한다');
    await page.locator('#notification-table [data-notice-approve]').first().click();
    ok((await page.textContent('#notification-table')).indexOf('승인') >= 0
       && await page.locator('#notification-table [data-notice-complete]').count() > 0,
       '담당자가 승인한 알림만 발송 또는 수동 완료 처리할 수 있다');

    group('6. 이력 — 금액을 모르면 「미상」');
    await go('history.html');
    ok(await page.locator('#h-table tbody tr').count() > 0, '이력 표에 줄이 있다');
    var hsum = (await page.textContent('#h-sum')).replace(/\s+/g, ' ');
    ok(hsum.length > 0, '설비별 누계가 나온다', hsum.slice(0, 100));
    var target = await page.evaluate(function () {
      var d = Store.load(), c = d.consumables[0]; return c && { equipmentId: c.equipmentId, consumableId: c.id };
    });
    await page.selectOption('#h-eq', target.equipmentId);
    await page.selectOption('#h-form [name="kind"]', '소모품 교체');
    ok(await page.isVisible('#h-form [data-history-consumable]'), '소모품 교체 이력에서는 교체한 품목을 직접 선택한다');
    await page.selectOption('#h-form [name="consumableId"]', target.consumableId);
    await page.fill('#h-form [name="date"]', '2026-08-30');
    await page.fill('#h-form [name="memo"]', '자동 완료일 반영 시험');
    await page.click('#h-save');
    ok(await page.evaluate(function (id) {
      var c = Store.load().consumables.find(function (x) { return x.id === id; }); return c && c.lastDate === '2026-08-30';
    }, target.consumableId), '교체 이력을 저장하면 해당 소모품의 마지막 교체일을 자동 갱신한다');

    group('7. 비용 — 셀 수 없었던 것을 따로 남긴다');
    await go('cost.html');
    await page.click('#calc');
    await page.waitForTimeout(300);
    ok((await page.textContent('#cost-stats')).trim().length > 0, '차년도 요약이 나온다');
    ok(await page.isVisible('#cost-inflation') && await page.isVisible('#cost-contingency')
       && (await page.textContent('#cost-stats')).indexOf('예비비 포함 최종') >= 0,
       '물가상승률과 예비비를 반영한 최종 예산을 표시한다');
    var unknown = (await page.textContent('#cost-unknown')).replace(/\s+/g, ' ');
    ok(unknown.length > 0, '「셀 수 없었던 것」 자리가 채워진다', unknown.slice(0, 120));

    group('8. 에너지 — 12개월이 표와 그래프로');
    await go('energy.html');
    ok(await page.locator('#energy-table tbody tr').count() > 0, '에너지 표에 줄이 있다');
    var svg = await page.locator('#charts svg').count();
    ok(svg === 4, '전력·수도·가스·압축공기 그래프 네 개를 SVG 로 그린다 (' + svg + '개)');
    var chartTitles = await page.locator('#charts .energy-chart h3').allTextContents();
    ok(chartTitles.map(function (t) { return t.replace(/\s*\(.*/, ''); }).join('|') === '전력|수도|가스|압축공기',
       '기타 없이 네 종류 그래프만 정해진 순서로 보인다');
    ok(await page.isVisible('#drop'), '고지서를 끌어다 놓는 자리가 보인다');
    await page.click('#paste-toggle');
    ok(await page.isVisible('#paste') && await page.isVisible('#paste-apply'),
       '글 입력창을 열면 적용 버튼이 함께 보인다');
    await page.fill('#paste', '2028년 7월 수도 사용량 1,234 m3');
    ok(await page.isEnabled('#paste-apply'), '글을 입력해야 적용 버튼이 활성화된다');
    await page.click('#paste-apply');
    ok((await page.textContent('#energy-table')).indexOf('2028-07') >= 0
       && (await page.textContent('#read-note')).indexOf('적용했습니다') >= 0,
       '적용 버튼을 눌러 붙여넣은 사용량을 표와 그래프 데이터에 반영한다');

    group('8-1. 설정 — 공유폴더·공용 DB와 두 가지 AI 연결을 고른다');
    await go('settings.html');
    ok(await page.isVisible('#storage-settings [name="sharedPath"]')
       && await page.isVisible('#storage-test'), '공유폴더 경로와 읽기·쓰기 시험 버튼이 있다');
    ok(await page.isVisible('#storage-settings [name="serverToken"]')
       && await page.isVisible('#sync-pull') && await page.isVisible('#sync-push') && await page.isVisible('#sync-backup'),
       '서버 토큰과 공용 자료 불러오기·저장·백업 버튼이 있다');
    ok(await page.locator('#ai-settings [name="aiMode"] option').count() === 4,
       '규칙·로컬 AI·외부 API·자동 선택 모드를 제공한다');
    ok(await page.isVisible('#ai-settings [name="externalApiKey"]')
       && await page.isVisible('#ai-settings [name="localAiUrl"]'),
       '외부 API와 로컬 AI 설정을 모두 제공한다');
    ok(await page.isVisible('#job-run') && await page.isVisible('#job-run-laws')
       && await page.isVisible('#backup-restore'),
       '자동 점검 실행과 백업 복원 기능을 제공한다');
    ok(await page.isVisible('#ocr-settings [name="ocrApiUrl"]')
       && await page.isVisible('#ocr-settings [name="ocrApiKey"]'),
       '스캔 PDF용 서버 OCR 설정을 제공한다');

    group('9. 조감도 — 건물을 눌러 그 건물 설비 보기');
    await go('map.html');
    var bldgs = await page.locator('#campus .bldg, #campus [data-bldg], #campus g, #campus rect').count();
    ok(bldgs > 0, '건물이 그려진다 (' + bldgs + '개)');
    ok(await page.locator('#campus [data-building-id]').count() === bldgs,
       '건물 ID와 좌표 구조로 배치된다');
    ok(await page.locator('#campus-image').count() === 1 && await page.locator('#building-editor tbody tr').count() === bldgs,
       '조감도 배경 이미지와 건물 좌표를 화면에서 편집할 수 있다');

    group('10. 좁은 화면에서 가로로 넘치지 않는다');
    await go('');
    await page.setViewportSize({ width: 380, height: 780 });
    await page.waitForTimeout(150);
    var over = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    ok(over <= 1, '가로 스크롤이 생기지 않는다 (넘침 ' + over + 'px)');

    group('11. 콘솔에 오류가 없다');
    ok(errors.length === 0, '자바스크립트 오류 없음', errors.slice(0, 3).join(' | '));
    /* 이 서버가 못 내준 파일이 있으면 앱이 아니라 테스트가 틀린 것이다 */
    ok(missed.length === 0, '테스트 서버가 필요한 파일을 다 내줬다', missed.join(', '));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failed ? 'X' : 'O') + ' ' + passed + ' 통과 / ' + failed + ' 실패');
  process.exit(failed ? 1 : 0);
}());
