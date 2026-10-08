#!/usr/bin/env python3
"""GitHub ZIP에서 앱 파일만 반영하고 변경 전 파일을 백업한다."""
import argparse
from datetime import datetime
from pathlib import Path, PurePosixPath
import shutil
import zipfile


def update(archive, target):
    target = Path(target).resolve()
    if not (target / "server" / "facility_server.py").is_file():
        raise ValueError("기존 facility-ai 프로젝트 폴더를 --target으로 지정하세요.")
    allowed_dirs = {"js", "css", "lib"}
    allowed_server = {"facility_server.py", "jobs.py", "run_jobs.py", "update_from_zip.py"}
    root_files = {"README.md", "build.py"}
    files = []
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            if item.is_dir(): continue
            parts = PurePosixPath(item.filename).parts
            if len(parts) < 2 or ".." in parts or item.filename.startswith("/"):
                continue
            rel = Path(*parts[1:])
            permitted = rel.parts[0] in allowed_dirs or len(rel.parts) == 1 and (rel.suffix in {".html", ".png", ".svg"} or rel.name in root_files)
            permitted = permitted or len(rel.parts) == 2 and rel.parts[0] == "server" and rel.name in allowed_server
            if not permitted: continue
            dest = target / rel
            if any(p.is_symlink() for p in [dest, *dest.parents] if p == target or target in p.parents) or not dest.resolve().is_relative_to(target):
                raise ValueError("프로젝트 밖으로 이어지는 경로가 있어 업데이트를 중단했습니다.")
            files.append((rel, z.read(item)))
        if not any(str(rel) == "server/facility_server.py" for rel, _ in files):
            raise ValueError("설비관리 저장소 ZIP이 아닙니다.")
    backup = target.parent / "app-backups" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    for rel, _ in files:
        src = target / rel
        if src.is_file():
            dest = backup / rel; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dest)
    for rel, data in files:
        dest = target / rel; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    print(f"앱 파일 {len(files)}개 반영 완료. 이전 파일 백업: {backup}")
    print("기존 config.local.json과 데이터는 유지했습니다. 실행 중인 서버를 재시작하세요.")
    return backup


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="최신 main ZIP을 적용합니다. 서버 설정·DB·데이터는 복사하지 않습니다.")
    parser.add_argument("archive", help="전송한 utility_final_2-main.zip 경로")
    parser.add_argument("--target", required=True, help="기존 /projects/aistu-facility-maintenance/facility-ai 경로")
    args = parser.parse_args()
    update(args.archive, args.target)
