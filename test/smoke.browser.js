/* 브라우저에 실제로 띄워 일곱 장이 그려지는지 본다.
 *
 *   node test/smoke.browser.js
 *
 * 규칙 테스트(test/logic.test.js)가 61개 전부 통과해도 app.js 의 오타 하나면
 * 페이지가 빈 화면이 된다. 규칙은 맞는데 아무도 그것을 볼 수 없는 상태다.
 * 파일을 읽어서는 안 잡힌다 — 실제로 띄워 봐야 잡힌다.
 *
 * 「예시 자료 넣기」 한 번이 설비·소모품·이력·에너지를 모두 넣으므로,
 * 그것을 누르고 일곱 장을 차례로 도는 것이 가장 넓게 훑는 길이다.
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
               (db.history || []).length, (db.energy || []).length ];
    });
    ok(counts[0] > 0 && counts[1] > 0 && counts[2] > 0 && counts[3] > 0,
       '설비·소모품·이력·에너지가 모두 들어갔다 (' + counts.join(' / ') + ')');
    ok(!(await page.isVisible('#empty-hint')), '「자료 없음」 안내가 사라진다');

    group('3. 설비 — 법령은 알려 주되 주기는 알려 주지 않는다');
    await go('equipment.html');
    ok((await page.textContent('#eq-count')).indexOf('0건') < 0,
       '설비 목록에 건수가 나온다 (' + (await page.textContent('#eq-count')).trim() + ')');
    ok(await page.locator('#eq-table tbody tr').count() > 0, '설비 표에 줄이 있다');

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

    group('4. 알림 — 시기를 계산하고 문안을 만들어 준다');
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
    ok(await page.isVisible('#copy-mail'), '복사 단추가 있다 (직접 보내지는 않는다)');

    group('5. 이력 — 금액을 모르면 「미상」');
    await go('history.html');
    ok(await page.locator('#h-table tbody tr').count() > 0, '이력 표에 줄이 있다');
    var hsum = (await page.textContent('#h-sum')).replace(/\s+/g, ' ');
    ok(hsum.length > 0, '설비별 누계가 나온다', hsum.slice(0, 100));

    group('6. 비용 — 셀 수 없었던 것을 따로 남긴다');
    await go('cost.html');
    await page.click('#calc');
    await page.waitForTimeout(300);
    ok((await page.textContent('#cost-stats')).trim().length > 0, '차년도 요약이 나온다');
    var unknown = (await page.textContent('#cost-unknown')).replace(/\s+/g, ' ');
    ok(unknown.length > 0, '「셀 수 없었던 것」 자리가 채워진다', unknown.slice(0, 120));

    group('7. 에너지 — 12개월이 표와 그래프로');
    await go('energy.html');
    ok(await page.locator('#energy-table tbody tr').count() > 0, '에너지 표에 줄이 있다');
    var svg = await page.locator('#charts svg').count();
    ok(svg > 0, '그래프를 SVG 로 직접 그린다 (' + svg + '개)');
    ok(await page.isVisible('#drop'), '고지서를 끌어다 놓는 자리가 보인다');

    group('8. 조감도 — 건물을 눌러 그 건물 설비 보기');
    await go('map.html');
    var bldgs = await page.locator('#campus .bldg, #campus [data-bldg], #campus g, #campus rect').count();
    ok(bldgs > 0, '건물이 그려진다 (' + bldgs + '개)');

    group('9. 좁은 화면에서 가로로 넘치지 않는다');
    await go('');
    await page.setViewportSize({ width: 380, height: 780 });
    await page.waitForTimeout(150);
    var over = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    ok(over <= 1, '가로 스크롤이 생기지 않는다 (넘침 ' + over + 'px)');

    group('10. 콘솔에 오류가 없다');
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
