import json
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
                self.assertTrue(json.load(response)["ok"])

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
