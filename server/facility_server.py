#!/usr/bin/env python3
"""Facility AI 사내 보조 서버 — 표준 라이브러리만 사용한다.

공유폴더 파일 저장, SQLite 메타데이터, 로컬 Ollama와 외부 OpenAI 호환 API를
브라우저 대신 호출한다. API 키는 GitHub나 브라우저에 보내지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
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
}


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
        elif key in data and key != "externalApiKey":
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
    """)
    return conn


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

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
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
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            cfg = load_config()
            self.send_json(200, {"ok": True, "service": "Facility AI 사내 서버",
                                 "sharedPath": str(shared_root(cfg)), "time": now()})
            return
        if parsed.path == "/api/settings":
            cfg = load_config(); cfg.pop("externalApiKey", None)
            self.send_json(200, {"ok": True, "settings": cfg, "hasExternalApiKey": bool(load_config().get("externalApiKey"))})
            return
        if parsed.path == "/api/laws":
            equipment_id = parse_qs(parsed.query).get("equipmentId", [""])[0]
            with database() as conn:
                rows = [dict(r) for r in conn.execute("SELECT payload FROM law_documents WHERE equipment_id=?", (equipment_id,))]
            self.send_json(200, {"ok": True, "documents": [json.loads(r["payload"]) for r in rows]})
            return
        self.send_json(404, {"error": "지원하지 않는 주소입니다."})

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/settings":
                payload = self.read_json(); save_config(payload)
                self.send_json(200, {"ok": True, "saved": True, "hasExternalApiKey": bool(load_config().get("externalApiKey"))})
                return
            if parsed.path == "/api/settings/test":
                payload = self.read_json(); path = Path(str(payload.get("sharedPath") or "").strip())
                if not str(path): raise ValueError("공유폴더 경로를 입력하세요.")
                path.mkdir(parents=True, exist_ok=True)
                fd, name = tempfile.mkstemp(prefix="facility-write-test-", suffix=".tmp", dir=path)
                os.write(fd, b"Facility AI write test"); os.close(fd); os.unlink(name)
                self.send_json(200, {"ok": True, "path": str(path)})
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
    host = os.environ.get("FACILITY_AI_HOST", "0.0.0.0")
    port = int(os.environ.get("FACILITY_AI_PORT", "8765"))
    database().close()
    print(f"Facility AI 사내 서버: http://{host}:{port}")
    print(f"설정 파일: {CONFIG_PATH}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
