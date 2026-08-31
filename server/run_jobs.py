#!/usr/bin/env python3
"""Windows 작업 스케줄러에서 호출하는 Facility AI 정기 점검."""
import json
from facility_server import run_scheduled_jobs

if __name__ == "__main__":
    print(json.dumps(run_scheduled_jobs(force_laws=False), ensure_ascii=False, indent=2))
