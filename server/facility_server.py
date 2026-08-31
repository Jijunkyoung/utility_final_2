#!/usr/bin/env python3
"""Facility AI 사내 보조 서버 — 표준 라이브러리만 사용한다.

공유폴더 파일 저장, SQLite 메타데이터, 로컬 Ollama와 외부 OpenAI 호환 API를
브라우저 대신 호출한다. API 키는 GitHub나 브라우저에 보내지 않는다.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import smtplib
import ssl
import sqlite3
import tempfile
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
CONFIG_PATH = Path(os.environ.get("FACILITY_AI_CONFIG", HERE / "config.local.json"))
DEFAULTS = {
    "sharedPath": "",
    "aiMode": "rules",
    "localAiUrl": "http://127.0.0.1:11434",
    "localAiModel": "",
    "externalAiUrl": "",
    "externalAiModel": "",
    "externalApiKey": "",
    "allowExternalFallback": False,
    "lawApiUrl": "https://www.law.go.kr/DRF",
    "lawApiOc": "",
    "allowedOrigins": [],
    "apiToken": "",
    "smtpHost": "",
    "smtpPort": 587,
    "smtpUser": "",
    "smtpPassword": "",
    "smtpFrom": "",
    "smtpStartTls": True,
}

SHARED_KEYS = (
    "equipments", "history", "consumables", "manuals", "lawReviews",
    "lawDocuments", "lawVersions", "lawChanges", "analysisResults", "energy", "buildings",
    "managers", "notificationQueue",
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config() -> dict:
    data = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            data.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return data


def save_config(data: dict) -> None:
    old = load_config()
    for key in DEFAULTS:
        if key in data and data[key] not in (None, ""):
            old[key] = data[key]
        elif key in data and key not in ("externalApiKey", "smtpPassword"):
            old[key] = data[key]
    CONFIG_PATH.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        pass


def shared_root(config: dict | None = None) -> Path:
    cfg = config or load_config()
    raw = str(cfg.get("sharedPath") or "").strip()
    return Path(raw) if raw else HERE / "data"


def safe_segment(value: str, fallback: str = "file") -> str:
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", str(value or "").strip())
    value = value.replace("..", "_").strip(" .")
    return (value or fallback)[:160]


def database(config: dict | None = None) -> sqlite3.Connection:
    root = shared_root(config)
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(root / "facility-ai.db")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id TEXT NOT NULL,
        category TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
        content_type TEXT, size INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS law_documents (
        id TEXT PRIMARY KEY, equipment_id TEXT NOT NULL, law TEXT NOT NULL,
        about TEXT, source_url TEXT, effective_date TEXT, content TEXT,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id TEXT, kind TEXT NOT NULL,
        provider TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT,
        device_name TEXT
      );
      CREATE TABLE IF NOT EXISTS state_versions (
        revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_by TEXT, device_name TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL,
        action TEXT NOT NULL, actor TEXT, device_name TEXT, summary TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_mail_log (
        notification_id TEXT PRIMARY KEY, recipient TEXT NOT NULL,
        subject TEXT NOT NULL, approved_by TEXT, sent_at TEXT NOT NULL
      );
    """)
    return conn


def shared_state(value: dict | None) -> dict:
    source = value if isinstance(value, dict) else {}
    return {key: source.get(key) if isinstance(source.get(key), list) else [] for key in SHARED_KEYS}


def state_snapshot(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT revision,payload,updated_at,updated_by,device_name FROM app_state WHERE id=1").fetchone()
    if not row:
        return {"revision": 0, "data": None, "updatedAt": None, "updatedBy": "", "deviceName": ""}
    return {"revision": row["revision"], "data": shared_state(json.loads(row["payload"])),
            "updatedAt": row["updated_at"], "updatedBy": row["updated_by"] or "",
            "deviceName": row["device_name"] or ""}


def change_summary(before: dict | None, after: dict) -> dict:
    old = shared_state(before)
    return {key: {"before": len(old[key]), "after": len(after[key])}
            for key in SHARED_KEYS if len(old[key]) != len(after[key])}


def save_shared_state(payload: dict) -> tuple[bool, dict]:
    data = shared_state(payload.get("data"))
    base_revision = int(payload.get("baseRevision") or 0)
    actor = safe_segment(payload.get("actor"), "미지정 사용자")
    device = safe_segment(payload.get("deviceName"), "미지정 PC")
    force = bool(payload.get("force"))
    with database() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = state_snapshot(conn)
        if current["revision"] != base_revision and not force:
            conn.rollback()
            return False, current
        revision = current["revision"] + 1
        created = now()
        encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        conn.execute("""INSERT INTO app_state(id,revision,payload,updated_at,updated_by,device_name)
          VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
          payload=excluded.payload,updated_at=excluded.updated_at,updated_by=excluded.updated_by,
          device_name=excluded.device_name""", (revision, encoded, created, actor, device))
        conn.execute("INSERT INTO state_versions(revision,payload,created_at,updated_by,device_name) VALUES(?,?,?,?,?)",
                     (revision, encoded, created, actor, device))
        summary = change_summary(current.get("data"), data)
        conn.execute("INSERT INTO audit_log(revision,action,actor,device_name,summary,created_at) VALUES(?,?,?,?,?,?)",
                     (revision, "force-save" if force else "save", actor, device,
                      json.dumps(summary, ensure_ascii=False), created))
        conn.execute("DELETE FROM state_versions WHERE revision NOT IN (SELECT revision FROM state_versions ORDER BY revision DESC LIMIT 200)")
        conn.commit()
    return True, {"revision": revision, "data": data, "updatedAt": created,
                  "updatedBy": actor, "deviceName": device}


def create_backup() -> Path:
    root = shared_root(); backup_dir = root / "backups"; backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / ("facility-ai-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".db")
    source = database(); destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close(); source.close()
    return target


def mail_configured(config: dict | None = None) -> bool:
    cfg = config or load_config()
    return bool(str(cfg.get("smtpHost") or "").strip() and str(cfg.get("smtpFrom") or "").strip())


def valid_email(value: str) -> str:
    value = str(value or "").strip()
    if len(value) > 254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}", value):
        raise ValueError("받는 사람 메일 주소를 확인하세요.")
    return value


def send_notification_email(payload: dict, config: dict | None = None) -> dict:
    cfg = config or load_config()
    if not mail_configured(cfg):
        raise RuntimeError("사내 메일 서버가 설정되지 않았습니다. server/config.local.json의 SMTP 항목을 확인하세요.")
    recipient = valid_email(payload.get("to"))
    sender = valid_email(cfg.get("smtpFrom"))
    subject = str(payload.get("subject") or "").strip()
    body = str(payload.get("body") or "").strip()
    if not subject or len(subject) > 200 or "\n" in subject or "\r" in subject:
        raise ValueError("메일 제목을 확인하세요.")
    if not body or len(body) > 20000:
        raise ValueError("메일 본문을 확인하세요.")
    host = str(cfg.get("smtpHost") or "").strip()
    port = int(cfg.get("smtpPort") or 587)
    if not (1 <= port <= 65535):
        raise ValueError("SMTP 포트 번호를 확인하세요.")
    message = EmailMessage()
    message["From"] = sender; message["To"] = recipient; message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(host, port, timeout=20) as client:
        client.ehlo()
        if bool(cfg.get("smtpStartTls", True)):
            client.starttls(context=ssl.create_default_context()); client.ehlo()
        user = str(cfg.get("smtpUser") or "").strip()
        password = str(cfg.get("smtpPassword") or "")
        if user:
            if not password: raise RuntimeError("SMTP 계정 비밀번호가 설정되지 않았습니다.")
            client.login(user, password)
        client.send_message(message)
    return {"ok": True, "to": recipient, "sentAt": now()}


def send_approved_notification(payload: dict, config: dict | None = None) -> dict:
    if payload.get("status") not in ("승인", "발송 실패") or not str(payload.get("approvedAt") or "").strip():
        raise ValueError("승인 대기함에서 승인된 알림만 발송할 수 있습니다.")
    notification_id = safe_segment(payload.get("id"), "")
    if not notification_id:
        raise ValueError("알림 ID를 확인하세요.")
    with database(config) as conn:
        old = conn.execute("SELECT sent_at FROM notification_mail_log WHERE notification_id=?", (notification_id,)).fetchone()
    if old:
        return {"ok": True, "duplicate": True, "sentAt": old["sent_at"]}
    result = send_notification_email(payload, config)
    with database(config) as conn:
        conn.execute("INSERT INTO notification_mail_log(notification_id,recipient,subject,approved_by,sent_at) VALUES(?,?,?,?,?)",
                     (notification_id, result["to"], str(payload.get("subject") or ""),
                      safe_segment(payload.get("approvedBy"), "미지정 사용자"), result["sentAt"]))
    return result


def json_request(url: str, payload: dict, headers: dict | None = None, timeout: int = 90) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    req_headers.update(headers or {})
    req = Request(url, data=body, headers=req_headers, method="POST")
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def get_json(url: str, timeout: int = 30) -> dict:
    req = Request(url, headers={"Accept": "application/json", "User-Agent": "FacilityAI/1.0"})
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def walk_dicts(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_dicts(child)


def import_law(config: dict, doc: dict) -> dict:
    oc = str(config.get("lawApiOc") or "").strip()
    base = str(config.get("lawApiUrl") or "https://www.law.go.kr/DRF").rstrip("/")
    if not oc:
        raise RuntimeError("국가법령정보센터 OC 인증값이 필요합니다.")
    query = urlencode({"OC": oc, "target": "law", "type": "JSON", "query": doc.get("law", ""),
                       "display": "20", "page": "1"})
    search = get_json(base + "/lawSearch.do?" + query)
    matches = [x for x in walk_dicts(search) if x.get("법령일련번호") or x.get("법령ID")]
    if not matches:
        raise RuntimeError("법령 API 검색 결과에서 법령 식별번호를 찾지 못했습니다.")
    wanted = str(doc.get("law") or "").replace(" ", "")
    item = next((x for x in matches if wanted in str(x.get("법령명한글") or x.get("법령명") or "").replace(" ", "")), matches[0])
    mst = item.get("법령일련번호") or item.get("MST") or item.get("법령ID")
    service_query = urlencode({"OC": oc, "target": "law", "type": "JSON", "MST": mst})
    law_data = get_json(base + "/lawService.do?" + service_query)
    effective = item.get("시행일자") or item.get("시행일") or ""
    if re.fullmatch(r"\d{8}", str(effective)):
        effective = f"{effective[:4]}-{effective[4:6]}-{effective[6:]}"
    result = dict(doc)
    result.update({"content": json.dumps(law_data, ensure_ascii=False, indent=2),
                   "effectiveDate": effective, "lawApiMst": str(mst), "apiImported": True,
                   "sourceUrl": "https://www.law.go.kr/법령/" + str(doc.get("law") or "")})
    return result


def prompt(kind: str, equipment: dict, text: str) -> str:
    if kind == "manual":
        schema = '{"summary":"","consumables":[{"name":"","cycleText":"","cycleMonths":null,"evidence":""}],"inspections":[{"name":"","cycleText":"","cycleMonths":null,"evidence":""}],"warnings":[]}'
    else:
        schema = '{"rows":[{"law":"","requirement":"","equipmentField":"","equipmentValue":"","status":"충족|미충족|확인 필요|정보 부족","evidence":"","action":""}],"warning":""}'
    return (
        "공장 유틸리티 설비 문서 검토 보조자 역할을 하세요. 문서에 없는 검사주기나 법적 판정을 "
        "추측하지 말고 모든 결과에 원문 근거를 넣으세요. JSON 외 문자는 반환하지 마세요.\n"
        f"설비정보: {json.dumps(equipment, ensure_ascii=False)}\n문서:\n{text[:60000]}\n반환형식:{schema}"
    )


def parse_ai(value) -> dict:
    if isinstance(value, dict):
        return value
    raw = str(value or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    return json.loads(raw)


def call_local(config: dict, kind: str, equipment: dict, text: str) -> tuple[dict, str]:
    base = str(config.get("localAiUrl") or "").rstrip("/")
    model = str(config.get("localAiModel") or "").strip()
    if not base or not model:
        raise RuntimeError("로컬 AI 주소와 모델명이 필요합니다.")
    data = json_request(base + "/api/generate", {
        "model": model, "prompt": prompt(kind, equipment, text), "stream": False, "format": "json"
    })
    return parse_ai(data.get("response")), "local:" + model


def call_external(config: dict, kind: str, equipment: dict, text: str) -> tuple[dict, str]:
    url = str(config.get("externalAiUrl") or "").strip()
    model = str(config.get("externalAiModel") or "").strip()
    key = str(config.get("externalApiKey") or "").strip()
    if not url or not model or not key:
        raise RuntimeError("외부 API 주소·모델·API 키가 필요합니다.")
    data = json_request(url, {
        "model": model,
        "messages": [{"role": "system", "content": "JSON만 반환하세요."},
                     {"role": "user", "content": prompt(kind, equipment, text)}],
        "temperature": 0,
    }, {"Authorization": "Bearer " + key})
    content = data["choices"][0]["message"]["content"]
    return parse_ai(content), "external:" + model


def analyze(config: dict, payload: dict) -> tuple[dict, str]:
    mode = payload.get("mode") or config.get("aiMode") or "rules"
    kind, equipment, text = payload.get("kind"), payload.get("equipment") or {}, payload.get("text") or ""
    if mode == "local":
        return call_local(config, kind, equipment, text)
    if mode == "external":
        return call_external(config, kind, equipment, text)
    if mode == "auto":
        try:
            return call_local(config, kind, equipment, text)
        except Exception:
            if payload.get("allowExternalFallback") and config.get("allowExternalFallback"):
                return call_external(config, kind, equipment, text)
            raise
    raise RuntimeError("규칙 기반 분석은 브라우저에서 실행됩니다.")


class Handler(BaseHTTPRequestHandler):
    server_version = "FacilityAI/1.0"

    def origin_allowed(self) -> bool:
        origin = str(self.headers.get("Origin") or "").rstrip("/")
        if not origin:
            return True
        host = str(self.headers.get("Host") or "")
        own = {"http://" + host, "https://" + host}
        allowed = {str(x).rstrip("/") for x in (load_config().get("allowedOrigins") or [])}
        return origin in own or origin in allowed

    def authorized(self) -> bool:
        token = str(load_config().get("apiToken") or "")
        if not token:
            return True
        return self.headers.get("Authorization") == "Bearer " + token

    def api_guard(self) -> bool:
        if not self.origin_allowed():
            self.send_json(403, {"error": "허용되지 않은 화면 출처입니다."})
            return False
        if self.path.startswith("/api/") and not self.authorized():
            self.send_json(401, {"error": "사내 서버 접근 토큰을 확인하세요."})
            return False
        return True

    def end_headers(self):
        origin = str(self.headers.get("Origin") or "")
        if origin and self.origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit: int = 60 * 1024 * 1024) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        if length > limit:
            raise ValueError("파일이 허용 크기 60MB를 넘었습니다.")
        return self.rfile.read(length)

    def read_json(self) -> dict:
        return json.loads(self.read_body().decode("utf-8") or "{}")

    def do_OPTIONS(self):
        if not self.origin_allowed():
            self.send_json(403, {"error": "허용되지 않은 화면 출처입니다."})
            return
        self.send_response(204)
        self.end_headers()

    def serve_static(self, path: str) -> bool:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        if rel.startswith((".", "server/", "test/")) or ".." in Path(rel).parts:
            return False
        target = (PROJECT_ROOT / rel).resolve()
        try:
            target.relative_to(PROJECT_ROOT.resolve())
        except ValueError:
            return False
        if not target.is_file():
            return False
        content = target.read_bytes()
        if target.suffix.lower() == ".html":
            marker = b'<meta name="facility-server" content="same-origin">'
            content = content.replace(b"<head>", b"<head>\n" + marker, 1)
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers(); self.wfile.write(content)
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self.api_guard():
            return
        if parsed.path == "/api/health":
            cfg = load_config()
            self.send_json(200, {"ok": True, "service": "Facility AI 사내 서버",
                                 "sharedPath": str(shared_root(cfg)), "mailConfigured": mail_configured(cfg), "time": now()})
            return
        if parsed.path == "/api/settings":
            full = load_config(); cfg = dict(full); cfg.pop("externalApiKey", None); cfg.pop("smtpPassword", None)
            self.send_json(200, {"ok": True, "settings": cfg, "hasExternalApiKey": bool(full.get("externalApiKey")),
                                 "hasSmtpPassword": bool(full.get("smtpPassword")), "mailConfigured": mail_configured(full)})
            return
        if parsed.path == "/api/state":
            with database() as conn:
                state = state_snapshot(conn)
            self.send_json(200, {"ok": True, **state})
            return
        if parsed.path == "/api/audit":
            limit = min(max(int(parse_qs(parsed.query).get("limit", ["30"])[0]), 1), 200)
            with database() as conn:
                rows = [dict(r) for r in conn.execute(
                    "SELECT revision,action,actor,device_name,summary,created_at FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))]
            for row in rows:
                row["summary"] = json.loads(row["summary"] or "{}")
            self.send_json(200, {"ok": True, "items": rows})
            return
        if parsed.path == "/api/laws":
            equipment_id = parse_qs(parsed.query).get("equipmentId", [""])[0]
            with database() as conn:
                rows = [dict(r) for r in conn.execute("SELECT payload FROM law_documents WHERE equipment_id=?", (equipment_id,))]
            self.send_json(200, {"ok": True, "documents": [json.loads(r["payload"]) for r in rows]})
            return
        if not self.serve_static(parsed.path):
            self.send_json(404, {"error": "지원하지 않는 주소입니다."})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self.api_guard():
            return
        try:
            if parsed.path == "/api/settings":
                payload = self.read_json(); save_config(payload)
                cfg = load_config()
                self.send_json(200, {"ok": True, "saved": True, "hasExternalApiKey": bool(cfg.get("externalApiKey")),
                                     "hasSmtpPassword": bool(cfg.get("smtpPassword")), "mailConfigured": mail_configured(cfg)})
                return
            if parsed.path == "/api/settings/test":
                payload = self.read_json(); path = Path(str(payload.get("sharedPath") or "").strip())
                if not str(path): raise ValueError("공유폴더 경로를 입력하세요.")
                path.mkdir(parents=True, exist_ok=True)
                fd, name = tempfile.mkstemp(prefix="facility-write-test-", suffix=".tmp", dir=path)
                os.write(fd, b"Facility AI write test"); os.close(fd); os.unlink(name)
                self.send_json(200, {"ok": True, "path": str(path)})
                return
            if parsed.path == "/api/state":
                saved, state = save_shared_state(self.read_json())
                if not saved:
                    self.send_json(409, {"error": "다른 PC에서 먼저 수정했습니다.", "conflict": True, **state})
                else:
                    self.send_json(200, {"ok": True, **state})
                return
            if parsed.path == "/api/backup":
                target = create_backup()
                self.send_json(200, {"ok": True, "path": str(target)})
                return
            if parsed.path == "/api/notifications/send":
                self.send_json(200, send_approved_notification(self.read_json()))
                return
            if parsed.path == "/api/files":
                q = parse_qs(parsed.query)
                equipment = safe_segment(q.get("equipmentId", [""])[0], "unknown-equipment")
                category = safe_segment(q.get("category", [""])[0], "files")
                filename = safe_segment(q.get("filename", [""])[0])
                root = shared_root(); target_dir = root / "설비" / equipment / category
                target_dir.mkdir(parents=True, exist_ok=True)
                target = target_dir / filename
                data = self.read_body(); target.write_bytes(data)
                with database() as conn:
                    conn.execute("INSERT INTO files(equipment_id,category,filename,path,content_type,size,created_at) VALUES(?,?,?,?,?,?,?)",
                                 (equipment, category, filename, str(target), self.headers.get("Content-Type"), len(data), now()))
                self.send_json(200, {"ok": True, "path": str(target), "size": len(data)})
                return
            if parsed.path == "/api/laws":
                doc = self.read_json(); doc_id = safe_segment(doc.get("id"), "law")
                with database() as conn:
                    conn.execute("""INSERT INTO law_documents(id,equipment_id,law,about,source_url,effective_date,content,payload,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET law=excluded.law,about=excluded.about,
                      source_url=excluded.source_url,effective_date=excluded.effective_date,content=excluded.content,
                      payload=excluded.payload,updated_at=excluded.updated_at""",
                      (doc_id, doc.get("equipmentId", ""), doc.get("law", ""), doc.get("about", ""),
                       doc.get("sourceUrl", ""), doc.get("effectiveDate", ""), doc.get("content", ""),
                       json.dumps(doc, ensure_ascii=False), now()))
                self.send_json(200, {"ok": True, "id": doc_id})
                return
            if parsed.path == "/api/laws/import":
                doc = import_law(load_config(), self.read_json())
                doc_id = safe_segment(doc.get("id"), "law")
                with database() as conn:
                    conn.execute("""INSERT INTO law_documents(id,equipment_id,law,about,source_url,effective_date,content,payload,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,
                      effective_date=excluded.effective_date,content=excluded.content,payload=excluded.payload,updated_at=excluded.updated_at""",
                      (doc_id, doc.get("equipmentId", ""), doc.get("law", ""), doc.get("about", ""),
                       doc.get("sourceUrl", ""), doc.get("effectiveDate", ""), doc.get("content", ""),
                       json.dumps(doc, ensure_ascii=False), now()))
                self.send_json(200, {"ok": True, "document": doc})
                return
            if parsed.path == "/api/analyze":
                payload = self.read_json(); cfg = load_config()
                result, provider = analyze(cfg, payload)
                self.send_json(200, {"ok": True, "result": result, "provider": provider})
                return
            if parsed.path == "/api/analyses":
                payload = self.read_json()
                result = payload.get("result") or {}
                provider = result.get("provider") or "rules"
                with database() as conn:
                    conn.execute("INSERT INTO analyses(equipment_id,kind,provider,result,created_at) VALUES(?,?,?,?,?)",
                                 (payload.get("equipmentId", ""), payload.get("kind", ""), provider,
                                  json.dumps(payload, ensure_ascii=False), payload.get("createdAt") or now()))
                self.send_json(200, {"ok": True, "saved": True})
                return
            self.send_json(404, {"error": "지원하지 않는 주소입니다."})
        except (ValueError, RuntimeError, KeyError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except (HTTPError, URLError) as exc:
            self.send_json(502, {"error": "외부/로컬 AI 연결 실패: " + str(exc)})
        except OSError as exc:
            self.send_json(500, {"error": "파일 또는 공유폴더 오류: " + str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": "서버 처리 오류: " + str(exc)})


def main():
    # 기본은 이 PC에서만 접속한다. 여러 PC 공개는 IT 승인 후 start_server_lan.bat로 연다.
    host = os.environ.get("FACILITY_AI_HOST", "127.0.0.1")
    port = int(os.environ.get("FACILITY_AI_PORT", "8765"))
    if host not in ("127.0.0.1", "localhost", "::1") and not str(load_config().get("apiToken") or "").strip():
        raise SystemExit("LAN 공개를 중단했습니다: config.local.json에 충분히 긴 apiToken을 먼저 설정하세요.")
    database().close()
    print(f"Facility AI 사내 서버: http://{host}:{port}")
    print("화면과 API를 같은 주소에서 제공합니다.")
    print(f"설정 파일: {CONFIG_PATH}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
