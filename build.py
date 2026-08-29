#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
페이지를 굽는다.  실행:  python3 build.py

왜 생성기를 두나
  메뉴가 여러 개다. 페이지마다 손으로 적으면 하나를 더할 때 모든 파일을 고쳐야 하고,
  꼭 한 곳을 빠뜨린다. 메뉴는 여기 한 곳에만 적는다.

⚠ 본문은 반드시 `<main>` 안에 넣는다.
  위아래 여백이 `main{padding:34px 0 60px}` 한 곳에만 있어서,
  `<div>` 로 바꾸면 히어로와 첫 제목이 붙어 버린다.
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

SITE = "Facility AI"
DESC = "캠퍼스 유틸리티 설비와 에너지 사용량을 한 곳에서 관리합니다."
BASE = "https://aebonlee.github.io/hd-project15/"

# (파일, 메뉴이름, 제목, 설명)
MENU = [
    ("index.html",     "개요",   "설비·에너지 통합 관리",
     "지금 챙겨야 할 것부터 봅니다. 기한이 임박한 검사·교체와 올해 남은 비용."),
    ("equipment.html", "설비",   "설비 등록·목록",
     "설비 사양과 담당자, 관련 법령을 한 건씩 등록합니다. 여기 적은 값이 나머지 화면의 근거가 됩니다."),
    ("managers.html",  "담당자", "담당자 통합 대장",
     "법정선임관리자와 유지관리자의 연락처, 재직 상태, 담당 설비를 한 곳에서 관리합니다."),
    ("alerts.html",    "알림",   "검사·교체 알림",
     "법정검사와 소모품 교체 시기를 계산해 임박한 순서로 보여 줍니다."),
    ("history.html",   "이력",   "이력 관리",
     "교체·고장 AS·법정검사를 마칠 때마다 날짜와 금액을 남깁니다. 이 기록이 비용 예측의 근거입니다."),
    ("cost.html",      "비용",   "차년도 비용 예측",
     "등록된 주기와 단가로 내년에 돌아오는 항목과 금액을 셉니다."),
    ("energy.html",    "에너지", "에너지 사용량 분석",
     "월별 고지서 PDF에서 사용량을 뽑아 그래프로 보고 엑셀로 내보냅니다."),
    ("map.html",       "조감도", "캠퍼스 조감도",
     "건물을 누르면 그 건물에 설치된 설비와 사양을 봅니다."),
    ("settings.html",  "설정",   "저장소·AI 연결 설정",
     "사내 공유폴더와 로컬 AI·외부 API 연결을 설정하고 권한을 시험합니다."),
]

HEAD = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} | {site}</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="css/style.css">
<!-- === HD:META:BEGIN (자동 생성 — scripts 로 다시 굽습니다) === -->
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="canonical" href="{base}{canon}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{site}">
<meta property="og:url" content="{base}{canon}">
<meta property="og:title" content="{title} — {site}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{base}{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} — {site}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{base}{og}">
<!-- === HD:META:END === -->
</head>
<body>

<nav class="topnav"><div class="topnav-inner">
  <a class="topnav-brand" href="index.html">Facility AI<small>유틸리티 설비·에너지</small></a>
  <ul class="topnav-links">
{links}
  </ul>
</div></nav>

<header class="hero"><div class="wrap">
  <div class="eyebrow">HD 생성형 AI 업무자동화 전문가과정 · 기획 지준경</div>
  <h1>{title}</h1>
  <p>{desc}</p>
</div></header>

<main><div class="wrap">
"""

FOOT = """</div></main>

<footer><div class="wrap">
  <p>{site} — 캠퍼스 유틸리티 설비·에너지 통합 관리.
     사내 서버가 연결되면 파일은 설정한 공유폴더에, 연결 전 임시 자료는 이 브라우저에 저장됩니다.</p>
  <p class="sub">문의 dreamitbiz@naver.com · 010-2634-2426 · 카카오톡 aebon</p>
</div></footer>

<script src="lib/xlsx.full.min.js"></script>
<script src="js/store.js"></script>
<script src="js/schedule.js"></script>
<script src="js/law.js"></script>
<script src="js/energy.js"></script>
<script src="js/analysis.js"></script>
<script src="js/integration.js"></script>
<script src="js/app.js"></script>
{extra}
</body>
</html>
"""


def build(fname, body, extra=""):
    idx = [m for m in MENU if m[0] == fname][0]
    _, _, title, desc = idx
    links = "\n".join(
        '    <li><a href="{}"{}>{}</a></li>'.format(
            f, ' class="active"' if f == fname else "", label)
        for f, label, _, _ in MENU)
    canon = "" if fname == "index.html" else fname
    og = "og-index.png" if fname == "index.html" else "og-%s.png" % fname.replace(".html", "")
    if not os.path.exists(os.path.join(HERE, og)):
        og = "og-index.png"
    html = (HEAD.format(title=title, desc=desc, site=SITE, base=BASE,
                        canon=canon, og=og, links=links)
            + body.strip() + "\n"
            + FOOT.format(site=SITE, extra=extra))
    p = os.path.join(HERE, fname)
    io.open(p, "w", encoding="utf-8").write(html)
    return fname


PAGES = {}

# ─────────────────────────────────────────────────────────── 개요
PAGES["index.html"] = """
<div id="empty-hint" class="note" hidden>
  아직 등록된 설비가 없습니다. <a href="equipment.html">설비 화면</a>에서 먼저 등록하거나,
  아래 <b>예시 자료 넣기</b>로 어떻게 쓰는지 살펴보세요.
  <div class="btnrow"><button class="btn" id="seed">예시 자료 넣기</button></div>
</div>

<h2>지금 챙겨야 할 것</h2>
<div class="stats" id="summary"></div>

<div class="card">
  <h3 style="font-size:16px;margin-bottom:4px">기한이 가까운 순서</h3>
  <p class="sub">법정검사는 30일 전부터, 소모품 교체는 14일 전부터 알립니다.</p>
  <div class="tablewrap" style="max-height:none"><table id="due">
    <thead><tr><th>구분</th><th>설비</th><th>항목</th><th>기한</th><th>남은 일수</th><th>상태</th></tr></thead>
    <tbody></tbody></table></div>
</div>

<div class="card">
  <h3 style="font-size:16px;margin-bottom:4px">확인이 필요한 것</h3>
  <p class="sub">법령을 오래 확인하지 않았거나, 법령을 대조할 값이 빠진 설비입니다.</p>
  <div id="review"></div>
</div>

<h2>이 도구가 하는 일과 하지 않는 일</h2>
<div class="note">
  <p style="margin:0 0 8px"><b>합니다</b> — 설비 대장, 검사·교체 시기 계산, 이력과 금액 기록,
     차년도 비용 예측, 고지서 PDF에서 사용량 뽑기, 건물별 설비 조회.</p>
  <p style="margin:0"><b>하지 않습니다</b> — 법령 자동 조회와 메일 자동 발송.
     둘 다 서버와 인증키가 필요하고 사내 폐쇄망에서는 나갈 수 없습니다.
     대신 <b>확인해야 할 것을 목록으로 뽑아</b> 주고 법령 검색 링크를 겁니다.</p>
</div>
"""

# ─────────────────────────────────────────────────────────── 설비
PAGES["equipment.html"] = """
<div class="section-toolbar">
  <div><h2>설비 목록 <span class="sub" id="eq-count"></span></h2>
    <p class="sub">설비를 선택하면 사양·소모품·이력·매뉴얼·법령을 한 번에 관리할 수 있습니다.</p></div>
  <button class="btn primary" id="eq-create-open" type="button">+ 설비 등록</button>
</div>
<div class="btnrow equipment-tools">
  <button class="btn" id="export">내보내기 (JSON)</button>
  <label class="btn" for="import-file">가져오기</label>
  <input type="file" id="import-file" accept=".json">
  <button class="btn" id="export-xlsx">엑셀로 내보내기</button>
</div>
	<div class="tablewrap"><table id="eq-table">
	  <thead><tr><th>관리</th><th>설비번호</th><th>설비명</th><th>종류</th><th>건물</th><th>위치</th>
	    <th>사양</th><th>유지관리자</th><th>마지막 검사</th><th>주기</th><th>법령 확인일</th></tr></thead>
	  <tbody></tbody></table></div>

  <dialog id="eq-create" class="register-dialog" aria-labelledby="eq-create-title">
    <div class="register-head">
      <div><p class="sub">신규 설비</p><h2 id="eq-create-title">설비 등록</h2></div>
      <button class="btn" id="eq-create-close" type="button" aria-label="설비 등록 닫기">닫기</button>
    </div>
    <form id="eq-form" class="register-form">
      <div class="register-row"><label for="eq-code">설비번호</label><input id="eq-code" name="code" required placeholder="U-EL-01"></div>
      <div class="register-row"><label for="eq-name">설비명</label><input id="eq-name" name="name" required placeholder="본관 승객용 승강기 1호기"></div>
      <div class="register-row"><label for="kind">종류</label><div class="register-control"><select name="kind" id="kind" required></select><input id="kind-other" placeholder="기타 설비 종류를 입력하세요" hidden></div></div>
      <div class="register-row"><label for="eq-model">모델명</label><input id="eq-model" name="model" placeholder="모델명"></div>
      <div class="register-row"><label for="eq-manufacturer">제조사</label><input id="eq-manufacturer" name="manufacturer" placeholder="제조사"></div>
      <div class="register-row"><label for="eq-capacity">용량</label><input id="eq-capacity" name="capacity" placeholder="1.5 t/h / 300 RT"></div>
      <div class="register-row"><label for="eq-flow">유량</label><input id="eq-flow" name="flow" placeholder="120 ㎥/h"></div>
      <div class="register-row"><label for="eq-pressure">압력</label><input id="eq-pressure" name="pressure" placeholder="0.98 MPa"></div>
      <div class="register-row"><label for="eq-power">소모전력</label><input id="eq-power" name="power" placeholder="11.5 kW"></div>
      <div class="register-row"><label for="eq-hvac">냉난방능력</label><input id="eq-hvac" name="hvac" placeholder="냉방 300 RT"></div>
      <div class="register-row"><label for="eq-spec">기타사양</label><input id="eq-spec" name="spec" placeholder="운전 조건, 규격 등"></div>
      <div class="register-row"><label for="eq-building">위치</label><input id="eq-building" name="building" placeholder="본관" list="bldg-list"><datalist id="bldg-list"></datalist></div>
      <div class="register-row"><label for="eq-place">세부위치</label><input id="eq-place" name="place" placeholder="지하 1층 기계실"></div>
      <div class="register-row"><label for="eq-installed">설치일</label><input id="eq-installed" name="installedAt" type="date"></div>
      <div class="register-row"><label for="eq-legal-mgr">법정선임관리자</label><select id="eq-legal-mgr" name="legalManagerId"></select></div>
      <div class="register-row"><label for="eq-mgr">유지관리자</label><select id="eq-mgr" name="maintenanceManagerId"></select></div>
      <div class="register-row"><label for="eq-mgr-email">유지관리자 메일</label><input id="eq-mgr-email" name="mgrEmail" type="email" readonly placeholder="담당자 대장에서 자동 표시"></div>
      <div class="register-row"><label for="eq-last-inspect">법정검사</label><input id="eq-last-inspect" name="lastInspect" type="date"></div>
      <div class="register-row"><label for="eq-cycle">검사주기</label><div class="input-with-unit"><input id="eq-cycle" name="cycleMonths" type="number" min="1" step="1" placeholder="12"><span>개월</span></div></div>
      <div class="register-row"><label for="eq-cost">검사비용</label><div class="input-with-unit"><input id="eq-cost" name="inspectCost" type="number" min="0" step="1000" placeholder="0"><span>원</span></div></div>
      <div class="register-row"><label for="eq-law-date">법령 확인일</label><input id="eq-law-date" name="lawCheckedAt" type="date"></div>
      <div class="register-row"><label for="eq-manual-file">매뉴얼 업로드</label><div class="register-control"><label class="btn file-button" id="eq-manual-file-button" for="eq-manual-file">파일 선택</label><input id="eq-manual-file" type="file" accept=".pdf,.txt,.csv,.xlsx,.xls,.docx"><span class="sub" id="eq-manual-file-name">설비 저장 후 공유폴더에 업로드하고 분석합니다.</span></div></div>
    </form>
    <div id="law-hint"></div>
    <div class="register-actions">
      <button class="btn" id="eq-clear" type="button">입력 지우기</button>
      <button class="btn primary" id="eq-save" type="button">설비 등록</button>
    </div>
  </dialog>

	<dialog id="eq-detail" class="detail-dialog" aria-labelledby="detail-title">
	  <div class="detail-head">
	    <div><p class="sub" id="detail-code"></p><h2 id="detail-title">설비 상세</h2></div>
	    <button class="btn" id="detail-close" type="button" aria-label="상세 닫기">닫기</button>
	  </div>
	  <div class="detail-tabs" role="tablist" aria-label="설비 상세 메뉴">
	    <button type="button" class="detail-tab on" data-detail-tab="basic" role="tab">기본정보</button>
	    <button type="button" class="detail-tab" data-detail-tab="consumables" role="tab">소모품</button>
	    <button type="button" class="detail-tab" data-detail-tab="history" role="tab">이력</button>
	    <button type="button" class="detail-tab" data-detail-tab="manuals" role="tab">매뉴얼</button>
	    <button type="button" class="detail-tab" data-detail-tab="laws" role="tab">법령</button>
	  </div>

	  <section class="detail-panel on" data-detail-panel="basic">
	    <form id="detail-basic-form" class="grid-form"></form>
	    <div class="btnrow"><button class="btn primary" id="detail-basic-save" type="button">기본정보 저장</button></div>
	  </section>

	  <section class="detail-panel" data-detail-panel="consumables" hidden>
	    <form id="detail-consumable-form" class="grid-form compact-form">
	      <label>소모품명 <input name="name" required placeholder="필터"></label>
	      <label>교체주기(개월) <input name="cycleMonths" type="number" min="1" step="1" required></label>
	      <label>최근교체일 <input name="lastDate" type="date"></label>
	      <label>단가(원) <input name="cost" type="number" min="0" step="1000" placeholder="모르면 비워 둠"></label>
	      <label>메모 <input name="note"></label>
	    </form>
	    <div class="btnrow"><button class="btn primary" id="detail-consumable-save" type="button">소모품 추가</button></div>
	    <div class="tablewrap detail-table"><table id="detail-consumables"><thead><tr><th></th><th>소모품</th><th>주기</th><th>최근교체</th><th>예정일</th><th>상태</th><th>단가</th></tr></thead><tbody></tbody></table></div>
	  </section>

	  <section class="detail-panel" data-detail-panel="history" hidden>
	    <form id="detail-history-form" class="grid-form compact-form">
	      <label>구분 <select name="kind"><option>유지보수</option><option>고장 AS</option><option>법정검사</option><option>소모품 교체</option><option>기타</option></select></label>
	      <label>일자 <input name="date" type="date" required></label>
	      <label>업체 <input name="vendor"></label>
	      <label>금액(원) <input name="cost" type="number" min="0" step="1000" placeholder="모르면 비워 둠"></label>
	      <label style="grid-column:1/-1">내용 <input name="memo" required></label>
	    </form>
	    <div class="btnrow"><button class="btn primary" id="detail-history-save" type="button">이력 추가</button></div>
	    <div class="tablewrap detail-table"><table id="detail-history"><thead><tr><th></th><th>일자</th><th>구분</th><th>내용</th><th>업체</th><th>금액</th></tr></thead><tbody></tbody></table></div>
	  </section>

	  <section class="detail-panel" data-detail-panel="manuals" hidden>
	    <form id="detail-manual-form" class="grid-form compact-form">
	      <label>문서명 <input name="title" required placeholder="운전·정비 매뉴얼"></label>
	      <label>버전 <input name="version" placeholder="Rev.1"></label>
	      <label style="grid-column:span 2">사내/로컬 파일 경로 <input name="filePath" placeholder="\\\\fileserver\\facility\\manual.pdf"></label>
	      <label>매뉴얼 파일 <span class="btn file-button" id="manual-file-label">파일 선택</span><input id="manual-file" type="file" accept=".pdf,.txt,.csv,.xlsx,.xls,.docx"></label>
	      <label>메모 <input name="note"></label>
	    </form>
	    <p class="sub">사내 서버가 연결되면 원본은 설정한 공유폴더에 저장합니다. 연결 전에는 메타데이터와 분석 결과만 브라우저에 임시 저장합니다.</p>
	    <div id="manual-status"></div>
	    <div class="btnrow"><button class="btn primary" id="detail-manual-save" type="button">업로드·분석</button></div>
	    <ul class="detail-list" id="detail-manuals"></ul>
	    <div id="detail-manual-analysis"></div>
	  </section>

	  <section class="detail-panel" data-detail-panel="laws" hidden>
	    <div class="note"><b>법령 후보는 적용 확정이 아닙니다.</b> 후보를 내부 DB에 저장한 뒤 법령 원문과 설비 사양을 비교 검토합니다. 자동 결과는 담당자가 최종 확인해야 합니다.</div>
	    <div id="detail-law-candidates"></div>
	    <h3 class="detail-subtitle">내부 DB에 저장한 법령</h3>
	    <div id="detail-law-documents"></div>
	    <h3 class="detail-subtitle">연관법령 직접 추가·수정</h3>
	    <p class="sub">자동 후보에 없는 법령도 이 설비의 연관법령으로 직접 등록할 수 있습니다. 법령명만 필수이며, 확인한 출처와 적용 조항을 함께 남기면 비교검토 근거가 됩니다.</p>
	    <form id="detail-law-document-form" class="grid-form compact-form">
	      <label>법령명 <input name="law" required placeholder="예: 산업안전보건법"></label>
	      <label>연관 내용 <input name="about" placeholder="이 설비와 관련된 이유·적용 범위"></label>
	      <label style="grid-column:1/-1">출처 URL <input name="sourceUrl" type="url" placeholder="https://www.law.go.kr/..."></label>
	      <label>시행일/기준일 <input name="effectiveDate" type="date"></label>
	      <label style="grid-column:1/-1">법령 원문 또는 적용 조항 <textarea name="content" rows="7" placeholder="국가법령정보센터에서 확인한 적용 조항을 붙여넣거나 법령 파일을 선택하세요."></textarea></label>
	      <label>법령 파일 <span class="btn file-button" id="law-file-label">파일 선택</span><input id="law-file" type="file" accept=".pdf,.txt,.hwp,.docx"></label>
	    </form>
	    <div class="btnrow">
	      <button class="btn primary" id="detail-law-document-save" type="button">연관법령 추가·저장</button>
	      <button class="btn" id="detail-law-document-new" type="button">새 법령 입력</button>
	      <button class="btn green" id="detail-law-review-run" type="button">저장 법령 비교 검토</button>
	    </div>
	    <div id="detail-law-document-status"></div>
	    <div id="detail-law-comparison"></div>
	    <h3 class="detail-subtitle">검토 기록 추가</h3>
	    <form id="detail-law-form" class="grid-form compact-form">
	      <label>법령명 <input name="law" required></label>
	      <label>확인일 <input name="checkedAt" type="date" required></label>
	      <label>확인자 <input name="reviewer"></label>
	      <label>첨부/파일경로 <input name="filePath" placeholder="사내 법령자료 경로"></label>
	      <label style="grid-column:1/-1">메모 <input name="note" placeholder="적용 조문, 판단 근거, 다음 확인사항"></label>
	      <label class="check-label"><input name="needsReview" type="checkbox"> 재검토 필요</label>
	    </form>
	    <div class="btnrow"><button class="btn primary" id="detail-law-save" type="button">검토 기록 저장</button></div>
	    <div class="tablewrap detail-table"><table id="detail-laws"><thead><tr><th></th><th>법령명</th><th>확인일</th><th>확인자</th><th>재검토</th><th>파일경로</th><th>메모</th></tr></thead><tbody></tbody></table></div>
	  </section>
	</dialog>
	"""

# ─────────────────────────────────────────────────────────── 알림
PAGES["alerts.html"] = """
<div class="card">
  <div class="btnrow" style="margin-top:0">
    <label style="display:flex;align-items:center;gap:8px">기준일
      <input type="date" id="today" style="min-height:38px"></label>
    <label style="display:flex;align-items:center;gap:8px">검사 알림
      <input type="number" id="lead-inspect" value="30" min="1" style="width:80px;min-height:38px">일 전</label>
    <label style="display:flex;align-items:center;gap:8px">교체 알림
      <input type="number" id="lead-replace" value="14" min="1" style="width:80px;min-height:38px">일 전</label>
  </div>
</div>

<div class="stats" id="alert-stats"></div>

<h2>법정검사</h2>
<div class="tablewrap"><table id="insp">
  <thead><tr><th>설비번호</th><th>설비명</th><th>종류</th><th>마지막 검사</th><th>주기</th>
    <th>다음 검사</th><th>남은 일수</th><th>상태</th><th>유지관리자</th></tr></thead>
  <tbody></tbody></table></div>

<h2>소모품 교체</h2>
<div class="tablewrap"><table id="cons">
  <thead><tr><th>설비</th><th>소모품</th><th>마지막 교체</th><th>주기</th>
    <th>다음 교체</th><th>남은 일수</th><th>상태</th><th>단가</th></tr></thead>
  <tbody></tbody></table></div>

<div class="note" id="mail-note">
  <b>메일 발송은 이 도구가 하지 않습니다.</b>
  자동 발송에는 서버와 메일 계정이 필요하고, 사내 폐쇄망에서는 나갈 수 없습니다.
  대신 아래 버튼으로 <b>알릴 내용을 만들어</b> 드립니다. 복사해 사내 메일로 보내세요.
  <div class="btnrow">
    <button class="btn" id="make-mail">알림 문안 만들기</button>
    <button class="btn" id="copy-mail" disabled>복사</button>
  </div>
  <textarea id="mail-body" rows="10" hidden
    style="width:100%;margin-top:12px;font-family:ui-monospace,monospace;font-size:13px;
           padding:12px;border:1px solid var(--line);border-radius:8px"></textarea>
</div>
"""

# ─────────────────────────────────────────────────────────── 이력
PAGES["history.html"] = """
<div class="card">
  <h3 style="font-size:16px;margin-bottom:10px">이력 추가</h3>
  <form id="h-form" class="grid-form">
    <label>설비 <select name="equipmentId" id="h-eq" required></select></label>
    <label>구분
      <select name="kind">
        <option>법정검사</option><option>소모품 교체</option><option>고장 AS</option><option>기타</option>
      </select></label>
    <label>일자 <input name="date" type="date" required></label>
    <label>금액(원) <input name="cost" type="number" min="0" step="1000" placeholder="모르면 비워 둡니다"></label>
    <label>업체 <input name="vendor"></label>
    <label style="grid-column:1/-1">내용 <input name="memo" placeholder="필터 4개 교체 / 정기검사 합격"></label>
  </form>
  <div class="note" style="margin-bottom:0">
    <b>금액을 모르면 비워 두세요.</b> 0 을 넣으면 비용 예측에서 <b>0 원짜리 항목</b>으로 잡혀
    예산이 실제보다 적게 나옵니다. 비워 두면 “미상”으로 따로 세어 눈에 보입니다.
  </div>
  <div class="btnrow">
    <button class="btn primary" id="h-save">추가</button>
    <button class="btn" id="h-apply" title="법정검사·소모품 교체 이력을 설비의 마지막 일자에 반영합니다">
      마지막 일자에 반영</button>
  </div>
</div>

<h2>이력 <span class="sub" id="h-count"></span></h2>
<div class="tablewrap"><table id="h-table">
  <thead><tr><th></th><th>일자</th><th>설비</th><th>구분</th><th>내용</th><th>업체</th><th>금액</th></tr></thead>
  <tbody></tbody></table></div>

<h2>설비별 누계</h2>
<div class="tablewrap"><table id="h-sum">
  <thead><tr><th>설비</th><th>건수</th><th>합계 금액</th><th>금액 미상</th></tr></thead>
  <tbody></tbody></table></div>
"""

# ─────────────────────────────────────────────────────────── 비용
PAGES["cost.html"] = """
<div class="card">
  <div class="btnrow" style="margin-top:0">
    <label style="display:flex;align-items:center;gap:8px">기준 연도
      <input type="number" id="year" min="2000" max="2100" style="width:110px;min-height:38px"></label>
    <button class="btn primary" id="calc">계산</button>
    <button class="btn" id="cost-xlsx">엑셀로 내보내기</button>
  </div>
  <p class="sub" style="margin:12px 0 0">
    그 해에 <b>돌아오는 횟수</b>를 세어 곱합니다. 주기가 6개월이면 한 해에 두 번이므로 두 배입니다.
  </p>
</div>

<div class="stats" id="cost-stats"></div>

<h2>항목별</h2>
<div class="tablewrap"><table id="cost-table">
  <thead><tr><th>항목</th><th>구분</th><th>횟수</th><th>단가</th><th>합계</th></tr></thead>
  <tbody></tbody></table></div>

<h2>셀 수 없었던 것</h2>
<p class="sub">아래 항목은 합계에 넣지 않았습니다. <b>0 원으로 세면 예산이 적게 잡히고 그 사실이 드러나지 않기 때문입니다.</b></p>
<ul class="filelist" id="cost-unknown"></ul>
"""

# ─────────────────────────────────────────────────────────── 에너지
PAGES["energy.html"] = """
<div class="card">
  <label class="drop" id="drop" for="file">
    <b>고지서 PDF 를 끌어다 놓거나 눌러서 고릅니다</b>
    <span>여러 장을 한 번에 넣어도 됩니다 · PDF · CSV · 엑셀</span>
  </label>
  <input type="file" id="file" accept=".pdf,.csv,.xlsx,.xls" multiple>
  <ul class="filelist" id="files"></ul>
  <div id="read-note"></div>
  <div class="btnrow">
    <button class="btn" id="paste-toggle" type="button" aria-controls="paste-panel" aria-expanded="false">글로 붙여넣기</button>
    <button class="btn" id="energy-xlsx" disabled>엑셀로 내보내기</button>
    <button class="btn" id="energy-clear">비우기</button>
  </div>
  <div id="paste-panel" class="paste-panel" hidden>
    <label for="paste"><b>고지서 내용을 붙여넣으세요</b></label>
    <p class="sub">연월·종류·사용량이 포함된 글을 넣은 뒤 적용 버튼을 누릅니다.</p>
    <textarea id="paste" rows="7" placeholder="2026년 7월 전력 사용량 125,400 kWh 요금 18,310,000 원"></textarea>
    <div class="paste-actions">
      <span class="sub">Ctrl + Enter로도 적용할 수 있습니다.</span>
      <button class="btn primary" id="paste-apply" type="button" disabled>적용</button>
    </div>
  </div>
</div>

<h2>월별 사용량</h2>
<div id="charts" class="energy-chart-grid"></div>

<div class="tablewrap"><table id="energy-table">
  <thead><tr><th>연월</th><th>종류</th><th>사용량</th><th>단위</th><th>전월 대비</th><th>요금</th><th>읽은 줄</th></tr></thead>
  <tbody></tbody></table></div>
"""

# ─────────────────────────────────────────────────────────── 조감도
PAGES["map.html"] = """
<div class="card">
	  <h3 style="font-size:16px;margin-bottom:6px">건물 배치</h3>
	  <p class="sub">건물을 누르면 그 건물의 설비가 아래에 나옵니다.
	     건물은 설비에 적은 <b>건물</b> 값과 분리된 건물 ID·좌표로 배치됩니다.</p>
  <div id="campus"></div>
</div>

<h2 id="picked-title">건물을 고르세요</h2>
<div class="tablewrap"><table id="picked">
  <thead><tr><th>설비번호</th><th>설비명</th><th>종류</th><th>위치</th><th>사양</th>
    <th>소모전력</th><th>유지관리자</th><th>다음 검사</th></tr></thead>
  <tbody></tbody></table></div>

	<div class="note">
	  <b>실제 조감도 그림을 쓰려면</b> 이미지를 <code>img/campus.png</code> 로 넣고
	  <code>buildings</code>의 백분율 좌표를 그림에 맞추면 됩니다. 지금은 같은 좌표 구조에
	  네모를 배치합니다 — 그림 없이도 어느 건물에 무엇이 있는지는 바로 보입니다.
	</div>
"""

# ─────────────────────────────────────────────────────────── 설정
PAGES["settings.html"] = """
<div class="settings-layout">
  <section class="card">
    <h2>사내 공유폴더</h2>
    <p class="sub">브라우저만으로는 공유폴더에 직접 쓸 수 없습니다. 사내 Windows 서버 프로그램을 실행한 뒤 아래 경로를 지정하세요.</p>
    <form id="storage-settings" class="grid-form settings-form">
      <label>사내 서버 주소 <input name="serverUrl" placeholder="http://서버PC이름:8765"></label>
      <label>공유폴더 UNC 경로 <input name="sharedPath" placeholder="\\\\fileserver\\facility\\FacilityAI"></label>
      <label>서버 접근 토큰 <input name="serverToken" type="password" autocomplete="off" placeholder="config.local.json의 apiToken"></label>
      <label>작업자 이름 <input name="syncActor" placeholder="예: 지준경"></label>
      <label>PC 이름 <input name="deviceName" placeholder="예: 유틸리티실-PC01"></label>
    </form>
    <div class="btnrow">
      <button class="btn primary" id="storage-save" type="button">이 경로로 설정</button>
      <button class="btn" id="server-test" type="button">서버 연결 시험</button>
      <button class="btn" id="storage-test" type="button">공유폴더 읽기·쓰기 시험</button>
    </div>
    <div id="storage-status"></div>
  </section>

  <section class="card">
    <h2>공용 데이터 동기화</h2>
    <p class="sub">공용 DB와 이 PC 자료가 다르면 자동으로 덮어쓰지 않습니다. 사용할 자료를 확인해 직접 선택하세요.</p>
    <div class="sync-summary" id="sync-summary"></div>
    <div class="btnrow">
      <button class="btn primary" id="sync-pull" type="button">서버 자료 불러오기</button>
      <button class="btn" id="sync-push" type="button">이 PC 자료를 서버에 저장</button>
      <button class="btn" id="sync-backup" type="button">공용 DB 지금 백업</button>
    </div>
    <div id="sync-status"></div>
    <h3 class="detail-subtitle">최근 변경 기록</h3>
    <div class="tablewrap"><table id="sync-audit"><thead><tr><th>버전</th><th>작업자</th><th>PC</th><th>시각</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="card">
    <h2>AI 분석 방식</h2>
    <p class="sub">법령·매뉴얼은 규칙 분석을 기본으로 하며, 허용된 환경에서는 로컬 AI 또는 외부 API를 선택할 수 있습니다.</p>
    <form id="ai-settings" class="grid-form settings-form">
      <label>분석 모드 <select name="aiMode"><option value="rules">규칙 기반만</option><option value="local">로컬 AI</option><option value="external">외부 API</option><option value="auto">로컬 우선 자동 선택</option></select></label>
      <label>로컬 AI 주소 <input name="localAiUrl" placeholder="http://127.0.0.1:11434"></label>
      <label>로컬 AI 모델 <input name="localAiModel" placeholder="예: qwen2.5:7b-instruct-q4_K_M"></label>
      <label>외부 API 주소 <input name="externalAiUrl" placeholder="OpenAI 호환 /v1/chat/completions 주소"></label>
      <label>외부 API 모델 <input name="externalAiModel" placeholder="회사에서 승인한 모델명"></label>
      <label>외부 API 키 <input name="externalApiKey" type="password" autocomplete="new-password" placeholder="서버에만 저장 · 화면에는 다시 표시하지 않음"></label>
      <label class="check-label"><input name="allowExternalFallback" type="checkbox"> 로컬 AI 실패 시 외부 전송 허용</label>
    </form>
    <div class="security-note">외부 전송 허용 전 회사 보안정책을 확인하세요. API 키와 원문은 GitHub나 브라우저 저장소에 기록하지 않습니다.</div>
  </section>

  <section class="card">
    <h2>국가법령정보센터 API</h2>
    <form id="law-api-settings" class="grid-form settings-form">
      <label>API 기본 주소 <input name="lawApiUrl" placeholder="https://www.law.go.kr/DRF"></label>
      <label>OC 인증값 <input name="lawApiOc" placeholder="승인받은 OC 값"></label>
    </form>
    <div class="btnrow"><button class="btn primary" id="settings-save" type="button">설정 저장</button></div>
    <div id="settings-status"></div>
  </section>
</div>
"""

# ─────────────────────────────────────────────────────────── 담당자
PAGES["managers.html"] = """
<div class="card">
  <h2>담당자 등록·수정</h2>
  <p class="sub">연락처를 설비마다 반복 입력하지 않고 한 번 등록한 뒤 담당 설비와 연결합니다.</p>
  <form id="manager-form" class="grid-form">
    <input name="id" type="hidden">
    <label>구분 <select name="role"><option value="legal">법정선임관리자</option><option value="maintenance">유지관리자</option><option value="both">법정선임·유지관리 겸임</option></select></label>
    <label>이름 <input name="name" required></label>
    <label>부서 <input name="department"></label>
    <label>연락처 <input name="phone" type="tel"></label>
    <label>메일 <input name="email" type="email"></label>
    <label>상태 <select name="active"><option value="true">재직·담당 중</option><option value="false">휴직·퇴직·담당 해제</option></select></label>
    <label style="grid-column:1/-1">메모 <input name="note"></label>
  </form>
  <div class="btnrow"><button class="btn primary" id="manager-save" type="button">담당자 저장</button><button class="btn" id="manager-clear" type="button">입력 지우기</button></div>
</div>
<div class="stats" id="manager-stats"></div>
<div class="tablewrap"><table id="manager-table"><thead><tr><th>관리</th><th>구분</th><th>이름</th><th>부서</th><th>연락처</th><th>메일</th><th>담당 설비</th><th>상태</th></tr></thead><tbody></tbody></table></div>
"""


def main():
    made = []
    for f, _, _, _ in MENU:
        made.append(build(f, PAGES[f]))
    print("  구운 페이지 %d개: %s" % (len(made), " ".join(made)))
    # 메뉴와 실제 파일이 어긋나지 않는지 확인한다
    for f, _, _, _ in MENU:
        html = io.open(os.path.join(HERE, f), encoding="utf-8").read()
        n = len(re.findall(r'<li><a href="[^"]+\.html"', html))
        assert n == len(MENU), "%s 의 메뉴가 %d개 (%d개여야 함)" % (f, n, len(MENU))
        assert "<main>" in html, "%s 에 <main> 이 없습니다 — 여백이 통째로 사라집니다" % f
    print("  메뉴 %d개 · <main> 확인 완료" % len(MENU))


if __name__ == "__main__":
    main()
