import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import jobs


class ScheduledJobsTest(unittest.TestCase):
    def test_due_items_are_queued_once(self):
        data = {"equipments": [{"id": "e1", "name": "보일러", "lastInspect": "2025-09-20",
                                 "cycleMonths": 12, "mgr": "담당자", "mgrEmail": "a@example.com"}],
                "consumables": [{"id": "c1", "equipmentId": "e1", "name": "필터",
                                  "lastDate": "2026-03-01", "cycleMonths": 6}], "notificationQueue": []}
        first = jobs.queue_due_notifications(data, "2026-08-31", 30, 30)
        second = jobs.queue_due_notifications(data, "2026-08-31", 30, 30)
        self.assertEqual(first["added"], 2)
        self.assertEqual(second["added"], 0)
        self.assertEqual(len(data["notificationQueue"]), 2)

    def test_missing_schedule_is_not_invented(self):
        data = {"equipments": [{"id": "e1", "name": "보일러", "cycleMonths": 12}],
                "consumables": [], "notificationQueue": []}
        result = jobs.queue_due_notifications(data, "2026-08-31")
        self.assertEqual(result["missingSchedule"], 1)
        self.assertEqual(data["notificationQueue"], [])

    def test_multiple_inspections_are_queued_separately(self):
        data = {"equipments": [{"id": "e1", "name": "보일러", "inspections": [
                    {"id": "i1", "name": "계속사용검사", "lastDate": "2025-09-10", "cycleMonths": 12},
                    {"id": "i2", "name": "성능검사", "lastDate": "2026-03-10", "cycleMonths": 6}
                ]}], "consumables": [], "notificationQueue": []}
        result = jobs.queue_due_notifications(data, "2026-08-31", 30, 30)
        self.assertEqual(result["added"], 2)
        self.assertEqual({x["item"] for x in data["notificationQueue"]}, {"계속사용검사", "성능검사"})

    def test_law_change_keeps_versions_and_requests_missing_specs(self):
        data = {"equipments": [{"id": "e1", "name": "보일러", "capacity": "1.5 t/h", "legalMgr": ""}],
                "lawVersions": [], "lawChanges": [], "notificationQueue": []}
        old = {"id": "l1", "equipmentId": "e1", "law": "에너지법",
               "content": "제1조 용량 1.0 t/h 이상 기준이다."}
        new = {**old, "content": "제1조 용량 0.8 t/h 이상이면 관리자를 선임한다."}
        change = jobs.record_law_update(data, old, new, "API")
        self.assertTrue(change["diff"]["changed"])
        self.assertEqual(change["missingFields"], ["법정선임관리자"])
        self.assertEqual(len(data["lawVersions"]), 2)
        self.assertEqual(len(data["notificationQueue"]), 1)


if __name__ == "__main__":
    unittest.main()
