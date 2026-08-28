import json
import tempfile
import unittest
from pathlib import Path
import sys

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
        server.save_config({"sharedPath": str(share), "externalApiKey": "secret-key"})
        data = server.load_config()
        self.assertEqual(data["externalApiKey"], "secret-key")
        self.assertEqual(data["sharedPath"], str(share))

    def test_database_is_created_in_shared_root(self):
        share = self.root / "share"
        server.save_config({"sharedPath": str(share)})
        conn = server.database()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        self.assertTrue({"files", "law_documents", "analyses"}.issubset(tables))
        self.assertTrue((share / "facility-ai.db").exists())

    def test_filename_removes_path_traversal(self):
        value = server.safe_segment("../../비밀/매뉴얼?.pdf")
        self.assertNotIn("..", value)
        self.assertNotIn("/", value)
        self.assertNotIn("?", value)


if __name__ == "__main__":
    unittest.main()
