"""브라우저 없이 실행하는 정기 점검의 순수 데이터 처리 함수."""
from __future__ import annotations

import calendar
import re
import uuid
from datetime import date, datetime


def new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex


def parse_date(value) -> date | None:
    try:
        return datetime.strptime(str(value or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year, month = value.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def next_due(last_value, months_value, today_value) -> tuple[date | None, int | None]:
    last, today = parse_date(last_value), parse_date(today_value)
    try:
        months = int(months_value)
    except (TypeError, ValueError):
        months = 0
    if not last or not today or months <= 0:
        return None, None
    due = add_months(last, months)
    return due, (due - today).days


def queue_due_notifications(data: dict, today_value: str, inspection_lead: int = 30,
                            replacement_lead: int = 30) -> dict:
    queue = data.setdefault("notificationQueue", [])
    equipments = {str(e.get("id")): e for e in data.get("equipments", [])}
    active_keys = {n.get("key") for n in queue if n.get("status") != "취소"}
    added, missing = 0, 0

    def enqueue(kind: str, source_id: str, equipment: dict, item: str,
                due: date | None, dday: int | None) -> None:
        nonlocal added, missing
        if due is None or dday is None:
            missing += 1
            return
        lead = inspection_lead if kind == "법정검사" else replacement_lead
        if dday > lead:
            return
        due_text = due.isoformat()
        key = f"{kind}|{source_id}|{due_text}"
        if key in active_keys:
            return
        name = equipment.get("name") or "설비"
        queue.append({
            "id": new_id("n"), "key": key, "type": kind, "sourceId": source_id,
            "equipmentId": equipment.get("id", ""), "item": item, "dueDate": due_text,
            "recipientName": equipment.get("mgr", ""), "recipientEmail": equipment.get("mgrEmail", ""),
            "subject": f"[설비] {name} {item} 예정 안내",
            "body": f"{name}의 {item} 예정일은 {due_text}입니다. 설비 상태와 작업 일정을 확인해 주세요.",
            "status": "대기", "createdAt": datetime.now().astimezone().isoformat(),
            "createdBy": "자동 점검"
        })
        active_keys.add(key)
        added += 1

    for equipment in data.get("equipments", []):
        due, dday = next_due(equipment.get("lastInspect"), equipment.get("cycleMonths"), today_value)
        enqueue("법정검사", str(equipment.get("id", "")), equipment, "정기검사", due, dday)

    for consumable in data.get("consumables", []):
        equipment = equipments.get(str(consumable.get("equipmentId")))
        if not equipment:
            continue
        due, dday = next_due(consumable.get("lastDate"), consumable.get("cycleMonths"), today_value)
        enqueue("소모품", str(consumable.get("id", "")), equipment,
                str(consumable.get("name") or "소모품 교체"), due, dday)
    return {"added": added, "missingSchedule": missing}


def sentences(value: str) -> list[str]:
    return [re.sub(r"\s+", " ", x).strip() for x in
            re.split(r"(?:\r?\n|(?<=[.!?。]))\s+", str(value or ""))
            if len(re.sub(r"\s+", " ", x).strip()) >= 8]


def law_diff(before: str, after: str) -> dict:
    old, new = sentences(before), sentences(after)
    old_set, new_set = set(old), set(new)
    added = [x for x in new if x not in old_set]
    removed = [x for x in old if x not in new_set]
    changed = bool(added or removed)
    return {"changed": changed, "added": added[:100], "removed": removed[:100],
            "summary": (f"추가 {len(added)}개 · 삭제/변경 전 {len(removed)}개 문장을 확인했습니다."
                        if changed else "문장 단위 변경이 없습니다.")}


def missing_law_specs(equipment: dict, content: str) -> list[str]:
    checks = [
        ("용량", ("capacity",), r"용량|출력|톤|kW|MW|RT"),
        ("유량", ("flow",), r"유량|m³/h|m3/h|Nm³/h|Nm3/h"),
        ("압력", ("pressure",), r"압력|MPa|kPa"),
        ("소모전력", ("power",), r"소모전력|소비전력|정격전력"),
        ("냉난방능력", ("hvac",), r"냉방능력|난방능력|냉난방능력|냉동능력"),
        ("법정선임관리자", ("legalManagerId", "legalMgr"), r"법정선임|선임.*관리자|관리자.*선임"),
        ("검사주기", ("cycleMonths",), r"검사주기|정기검사|매\s*\d+\s*(?:개월|년)"),
    ]
    return [label for label, keys, pattern in checks
            if re.search(pattern, content, re.I)
            and not any(str(equipment.get(key) or "").strip() for key in keys)]


def record_law_update(data: dict, previous: dict, current: dict, source: str) -> dict | None:
    before, after = str(previous.get("content") or "").strip(), str(current.get("content") or "").strip()
    if not before or not after or before == after:
        return None
    diff = law_diff(before, after)
    if not diff["changed"]:
        return None
    versions = data.setdefault("lawVersions", [])

    def version(doc: dict, label: str) -> dict:
        found = next((v for v in versions if v.get("lawDocumentId") == doc.get("id")
                      and v.get("content") == str(doc.get("content") or "").strip()
                      and (v.get("effectiveDate") or "") == (doc.get("effectiveDate") or "")), None)
        if found:
            return found
        value = {"id": new_id("lv"), "lawDocumentId": doc.get("id"),
                 "equipmentId": doc.get("equipmentId"), "law": doc.get("law", ""),
                 "effectiveDate": doc.get("effectiveDate", ""), "content": str(doc.get("content") or "").strip(),
                 "source": label, "capturedAt": datetime.now().astimezone().isoformat(),
                 "sourceUrl": doc.get("sourceUrl", ""), "fileName": doc.get("fileName", "")}
        versions.append(value)
        return value

    old_version, new_version = version(previous, source + " 변경 전"), version(current, source)
    changes = data.setdefault("lawChanges", [])
    duplicate = next((c for c in changes if c.get("previousVersionId") == old_version["id"]
                      and c.get("currentVersionId") == new_version["id"]), None)
    if duplicate:
        return duplicate
    equipment = next((e for e in data.get("equipments", []) if e.get("id") == current.get("equipmentId")), {})
    change = {"id": new_id("lc"), "lawDocumentId": current.get("id"),
              "equipmentId": current.get("equipmentId"), "law": current.get("law", ""),
              "previousVersionId": old_version["id"], "currentVersionId": new_version["id"],
              "previousEffectiveDate": previous.get("effectiveDate", ""),
              "currentEffectiveDate": current.get("effectiveDate", ""),
              "detectedAt": datetime.now().astimezone().isoformat(), "source": source,
              "status": "검토 대기", "diff": diff,
              "missingFields": missing_law_specs(equipment, after)}
    changes.append(change)
    key = "법령개정|" + change["id"]
    if not any(n.get("key") == key and n.get("status") != "취소"
               for n in data.setdefault("notificationQueue", [])):
        missing = ", ".join(change["missingFields"])
        data["notificationQueue"].append({
            "id": new_id("n"), "key": key, "type": "법령 개정", "sourceId": change["id"],
            "equipmentId": equipment.get("id", ""), "item": current.get("law", "") + " 변경 검토",
            "dueDate": date.today().isoformat(), "recipientName": equipment.get("mgr", ""),
            "recipientEmail": equipment.get("mgrEmail", ""),
            "subject": f"[법령 개정] {equipment.get('name', '설비')} · {current.get('law', '')} 검토 요청",
            "body": diff["summary"] + (("\n추가 입력 요청 사양: " + missing) if missing else ""),
            "status": "대기", "createdAt": datetime.now().astimezone().isoformat(), "createdBy": "자동 법령 점검"
        })
    return change
