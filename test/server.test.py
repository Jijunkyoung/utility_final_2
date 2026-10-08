import json
import zipfile
import tempfile
import threading
import unittest
from unittest import mock
from pathlib import Path
import sys
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import facility_server as server
import update_from_zip as updater


class FacilityServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        server.CONFIG_PATH = self.root / "config.local.json"

    def tearDown(self):
        self.temp.cleanup()

    def test_config_keeps_api_key_server_side(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share), "externalApiKey": "secret-key", "smtpPassword": "mail-secret"})
        data = server.load_config()
        self.assertEqual(data["externalApiKey"], "secret-key")
        self.assertEqual(data["smtpPassword"], "mail-secret")
        self.assertEqual(data["sharedPath"], str(share))
        self.assertEqual(server.DEFAULTS["apiToken"], "")

    def test_vm_update_preserves_config_database_and_backs_up_app(self):
        target = self.root / "facility-ai"
        (target / "server" / "data").mkdir(parents=True)
        (target / "server" / "facility_server.py").write_text("old-app")
        config = target / "server" / "config.local.json"; config.write_text("private-config")
        data = target / "server" / "data" / "facility-ai.db"; data.write_text("private-data")
        archive = self.root / "main.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("utility_final_2-main/server/facility_server.py", "new-app")
            z.writestr("utility_final_2-main/server/config.local.json", "should-not-copy")
            z.writestr("utility_final_2-main/server/data/facility-ai.db", "should-not-copy")
            z.writestr("utility_final_2-main/../outside.html", "should-not-copy")
        backup = updater.update(archive, target)
        self.assertEqual(config.read_text(), "private-config")
        self.assertEqual(data.read_text(), "private-data")
        self.assertEqual((backup / "server" / "facility_server.py").read_text(), "old-app")
        self.assertEqual((target / "server" / "facility_server.py").read_text(), "new-app")
        self.assertFalse((self.root / "outside.html").exists())

    def test_internal_bearer_and_configured_secret_headers(self):
        cfg = {"internalApiKey": "test-key", "internalSecretKey": "test-secret", "internalAuthMode": "headers",
               "internalKeyHeader": "X-Company-Key", "internalSecretHeader": "X-Company-Secret"}
        self.assertEqual(server.internal_headers(cfg), {"X-Company-Key": "test-key", "X-Company-Secret": "test-secret"})
        with self.assertRaisesRegex(ValueError, "SECRET KEY"):
            server.internal_headers({"internalApiKey": "test-key", "internalSecretKey": "test-secret"})
        with self.assertRaises(ValueError):
            server.internal_headers({**cfg, "internalKeyHeader": "Host"})
        self.assertEqual(server.internal_headers({"internalApiKey": "test-key"}), {"Authorization": "Bearer test-key"})

    def test_internal_analysis_normalizes_endpoint_and_parses_fenced_json(self):
        cfg = {"aiMode": "internal", "internalAiUrl": "https://company.invalid/v1/", "internalAiModel": "qwen3-8-27b", "internalApiKey": "test-key"}
        response = {"choices": [{"message": {"content": '```json\n{"answer":"100 kWh"}\n```'}}]}
        with mock.patch.object(server, "json_request", return_value=response) as call:
            result, provider = server.analyze(cfg, {"kind": "facility_question", "equipment": {"question": "7월 사용량?"}, "text": "100 kWh"})
        self.assertEqual(result["answer"], "100 kWh")
        self.assertEqual(provider, "internal:qwen3-8-27b")
        self.assertEqual(call.call_args.args[0], "https://company.invalid/v1/chat/completions")
        self.assertEqual(call.call_args.args[1]["model"], "qwen3-8-27b")

    def test_internal_keys_stay_server_only_and_blank_apply_preserves_keys(self):
        server.save_config({"internalApiKey": "test-key", "internalSecretKey": "test-secret"})
        server.save_config({"internalApiKey": "", "internalSecretKey": ""})
        self.assertEqual(server.load_config()["internalSecretKey"], "test-secret")
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            with urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/api/settings", timeout=2) as response:
                value = json.load(response)
            self.assertTrue(value["hasInternalApiKey"])
            self.assertTrue(value["hasInternalSecretKey"])
            self.assertNotIn("internalApiKey", value["settings"])
            self.assertNotIn("test-secret", json.dumps(value))
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join(timeout=2)

    def test_vision_sends_images_to_vision_model_without_automatic_save(self):
        cfg = {"internalAiUrl": "https://company.invalid/v1", "internalVisionModel": "qwen3-vl-8b-instruct", "internalApiKey": "test-key"}
        payload = {"pages": [{"image": "data:image/jpeg;base64,/9j/"}]}
        response = {"choices": [{"message": {"content": '{"rows":[{"ym":"2026-07","usage":100}]}'}}]}
        with mock.patch.object(server, "json_request", return_value=response) as call:
            result = server.extract_energy(cfg, payload)
        self.assertTrue(result["reviewRequired"])
        self.assertEqual(call.call_args.args[1]["model"], "qwen3-vl-8b-instruct")
        self.assertEqual(call.call_args.args[1]["messages"][0]["content"][2]["type"], "image_url")
        with self.assertRaises(ValueError):
            server.extract_energy(cfg, {"pages": payload["pages"] * 11})

    def test_lan_requires_real_32_character_token(self):
        self.assertIn("32자", server.lan_token_error({"apiToken": "short"}))
        self.assertIn("예제", server.lan_token_error({"apiToken": "회사에서 정한 충분히 긴 임의 문자열입니다1234567890"}))
        self.assertEqual(server.lan_token_error({"apiToken": "3N9vQ7mZ2xK8pL5sR4tW6yB1dF0hJcUa"}), "")

    def test_intranet_readiness_returns_only_private_access_urls(self):
        token = "3N9vQ7mZ2xK8pL5sR4tW6yB1dF0hJcUa"
        with mock.patch.object(server, "intranet_ipv4_addresses", return_value=["10.20.30.40"]):
            result = server.intranet_readiness({"apiToken": token, "sharedPath": "share"}, 8765)
        self.assertTrue(result["ok"])
        self.assertEqual(result["urls"], ["http://10.20.30.40:8765"])
        self.assertEqual(result["errors"], [])

    def test_law_question_prompt_requires_evidence_and_missing_information(self):
        value = server.prompt("law_question", {"question": "전기 안전관리자 선임기준?"}, "전기안전관리법 원문")
        self.assertIn('"laws"', value)
        self.assertIn('"missingInformation"', value)
        self.assertIn("추측하지 말고", value)

    def test_database_is_created_in_shared_root(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share)})
        conn = server.database()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        self.assertTrue({"files", "law_documents", "analyses", "app_state", "state_versions", "audit_log"}.issubset(tables))
        self.assertTrue((share / "facility-ai.db").exists())

    def test_shared_state_has_revision_conflict_and_force_save(self):
        server.save_config({"sharedPath": str(self.root / "share")})
        first_ok, first = server.save_shared_state({
            "baseRevision": 0, "actor": "시설팀", "deviceName": "PC-01",
            "data": {"equipments": [{"id": "eq1"}], "settings": {"apiToken": "never-store"}},
        })
        self.assertTrue(first_ok)
        self.assertEqual(first["revision"], 1)
        self.assertEqual(first["data"]["equipments"][0]["id"], "eq1")
        self.assertNotIn("settings", first["data"])

        stale_ok, stale = server.save_shared_state({
            "baseRevision": 0, "actor": "다른PC", "deviceName": "PC-02",
            "data": {"equipments": [{"id": "stale"}]},
        })
        self.assertFalse(stale_ok)
        self.assertEqual(stale["revision"], 1)

        force_ok, forced = server.save_shared_state({
            "baseRevision": 0, "force": True, "actor": "관리자", "deviceName": "PC-03",
            "data": {"equipments": [{"id": "chosen"}]},
        })
        self.assertTrue(force_ok)
        self.assertEqual(forced["revision"], 2)
        with server.database() as conn:
            audit = conn.execute("SELECT action,actor FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual((audit["action"], audit["actor"]), ("force-save", "관리자"))

    def test_backup_copies_database_to_shared_folder(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share)})
        server.save_shared_state({"baseRevision": 0, "data": {"equipments": []}})
        backup = server.create_backup()
        self.assertTrue(backup.is_file())
        self.assertEqual(backup.parent, share / "backups")

    def test_backup_restore_keeps_safety_copy(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share)})
        server.save_shared_state({"baseRevision": 0, "data": {"equipments": [{"id": "old"}]}})
        backup = server.create_backup()
        server.save_shared_state({"baseRevision": 1, "data": {"equipments": [{"id": "new"}]}})
        result = server.restore_backup(backup.name)
        self.assertTrue(result["ok"])
        with server.database() as conn:
            state = server.state_snapshot(conn)
        self.assertEqual(state["data"]["equipments"][0]["id"], "old")
        self.assertGreaterEqual(len(server.list_backups()), 2)

    def test_scheduled_job_queues_due_item_and_logs_run(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share)})
        server.save_shared_state({"baseRevision": 0, "data": {"equipments": [{
            "id": "eq1", "name": "보일러", "lastInspect": "2025-09-20", "cycleMonths": 12,
            "mgr": "담당자", "mgrEmail": "manager@example.com"}]}})
        result = server.run_scheduled_jobs()
        self.assertTrue(result["ok"])
        self.assertEqual(result["queued"], 1)
        with server.database() as conn:
            state = server.state_snapshot(conn)
            runs = conn.execute("SELECT COUNT(*) FROM job_runs").fetchone()[0]
        self.assertEqual(len(state["data"]["notificationQueue"]), 1)
        self.assertEqual(runs, 1)

    def test_api_token_and_origin_are_enforced(self):
        server.save_config({"sharedPath": str(self.root / "share"), "apiToken": "test-token"})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            with self.assertRaises(HTTPError) as missing:
                urlopen(base + "/api/health", timeout=2)
            self.assertEqual(missing.exception.code, 401)

            good = Request(base + "/api/health", headers={"Authorization": "Bearer test-token"})
            with urlopen(good, timeout=2) as response:
                health = json.load(response)
                self.assertTrue(health["ok"])
                self.assertEqual(health["network"]["scope"], "this-device")

            bad_origin = Request(base + "/api/health", headers={
                "Authorization": "Bearer test-token", "Origin": "https://unapproved.example",
            })
            with self.assertRaises(HTTPError) as denied:
                urlopen(bad_origin, timeout=2)
            self.assertEqual(denied.exception.code, 403)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_viewer_token_can_read_but_cannot_write(self):
        server.save_config({"sharedPath": str(self.root / "share"), "apiToken": "admin-token",
                            "viewerTokens": ["viewer-token"]})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            read = Request(base + "/api/health", headers={"Authorization": "Bearer viewer-token"})
            with urlopen(read, timeout=2) as response:
                self.assertEqual(json.load(response)["role"], "viewer")
            write = Request(base + "/api/backup", data=b"{}", method="POST", headers={
                "Authorization": "Bearer viewer-token", "Content-Type": "application/json"})
            with self.assertRaises(HTTPError) as denied:
                urlopen(write, timeout=2)
            self.assertEqual(denied.exception.code, 403)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join(timeout=2)

    def test_same_origin_page_has_server_marker_and_security_headers(self):
        server.save_config({"sharedPath": str(self.root / "share")})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/", timeout=2) as response:
                html = response.read().decode("utf-8")
                self.assertIn('meta name="facility-server" content="same-origin"', html)
                self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_filename_removes_path_traversal(self):
        value = server.safe_segment("../../비밀/매뉴얼?.pdf")
        self.assertNotIn("..", value)
        self.assertNotIn("/", value)
        self.assertNotIn("?", value)

    def test_shared_file_read_is_limited_to_configured_root_and_allowed_types(self):
        share = self.root / "share"
        bills = share / "고지서"
        bills.mkdir(parents=True)
        bill = bills / "2026-07.pdf"
        bill.write_bytes(b"sample-pdf")
        server.save_config({"sharedPath": str(share)})
        self.assertEqual(server.resolve_shared_file("고지서/2026-07.pdf"), bill.resolve())
        outside = self.root / "outside.pdf"
        outside.write_bytes(b"secret")
        with self.assertRaisesRegex(ValueError, "공유폴더 밖"):
            server.resolve_shared_file(str(outside))
        blocked = share / "script.exe"
        blocked.write_bytes(b"no")
        with self.assertRaisesRegex(ValueError, "PDF"):
            server.resolve_shared_file("script.exe")

    def test_shared_file_api_returns_file_without_exposing_other_paths(self):
        share = self.root / "share"
        target = share / "조감도" / "campus.jpg"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"jpeg-sample")
        server.save_config({"sharedPath": str(share)})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            req = Request(base + "/api/files/read", data=json.dumps({"path": "조감도/campus.jpg"}).encode(),
                          method="POST", headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=2) as response:
                self.assertEqual(response.read(), b"jpeg-sample")
                self.assertEqual(response.headers["X-Facility-Filename"], "campus.jpg")
            denied = Request(base + "/api/files/read", data=json.dumps({"path": str(self.root / "outside.pdf")}).encode(),
                             method="POST", headers={"Content-Type": "application/json"})
            with self.assertRaises(HTTPError) as error:
                urlopen(denied, timeout=2)
            self.assertEqual(error.exception.code, 400)
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join(timeout=2)

    def test_smtp_send_uses_server_side_settings(self):
        config = {**server.DEFAULTS, "smtpHost": "smtp.company.local", "smtpPort": 587,
                  "smtpFrom": "facility@company.com", "smtpStartTls": True}
        with mock.patch.object(server.smtplib, "SMTP") as smtp:
            client = smtp.return_value.__enter__.return_value
            result = server.send_notification_email({
                "to": "manager@company.com", "subject": "검사 예정 안내", "body": "확인해 주세요."
            }, config)
        self.assertTrue(result["ok"])
        smtp.assert_called_once_with("smtp.company.local", 587, timeout=20)
        client.starttls.assert_called_once()
        client.send_message.assert_called_once()

    def test_smtp_rejects_invalid_recipient_and_header_injection(self):
        config = {**server.DEFAULTS, "smtpHost": "smtp.company.local", "smtpFrom": "facility@company.com"}
        with self.assertRaises(ValueError):
            server.send_notification_email({"to": "not-an-email", "subject": "안내", "body": "본문"}, config)
        with self.assertRaises(ValueError):
            server.send_notification_email({"to": "manager@company.com", "subject": "안내\nBcc: bad@example.com", "body": "본문"}, config)

    def test_only_approved_notification_is_sent_once(self):
        config = {**server.DEFAULTS, "sharedPath": str(self.root / "share"),
                  "smtpHost": "smtp.company.local", "smtpFrom": "facility@company.com"}
        payload = {"id": "notice-1", "to": "manager@company.com", "subject": "검사 안내", "body": "본문",
                   "status": "승인", "approvedAt": "2026-08-30T00:00:00Z", "approvedBy": "시설팀"}
        with mock.patch.object(server.smtplib, "SMTP") as smtp:
            client = smtp.return_value.__enter__.return_value
            first = server.send_approved_notification(payload, config)
            second = server.send_approved_notification(payload, config)
        self.assertTrue(first["ok"])
        self.assertTrue(second["duplicate"])
        client.send_message.assert_called_once()
        with self.assertRaises(ValueError):
            server.send_approved_notification({**payload, "id": "notice-2", "status": "대기"}, config)


if __name__ == "__main__":
    unittest.main()
