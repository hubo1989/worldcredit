#!/usr/bin/env python3
"""从唯一 .op 真源导出 iOS 账单页的可重建节点 JSON（只读）。

用法：python3 design/openpencil/scripts/15-ios-bills.py > /tmp/ios-bills.json
然后在空白 OpenPencil 页执行：op design @/tmp/ios-bills.json --page <目标页>
"""

import json
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "worldcredit-redesign.op"
PAGE_NAME = "15 · iOS Bills"


def without_editor_ids(node):
    return {
        key: [without_editor_ids(child) for child in value]
        if key == "children" else value
        for key, value in node.items()
        if key != "id"
    }


if __name__ == "__main__":
    document = json.loads(SOURCE.read_text(encoding="utf-8"))
    pages = [page for page in document["pages"] if page["name"] == PAGE_NAME]
    if len(pages) != 1:
        raise SystemExit(f"需要且只能有一个 {PAGE_NAME} 页，实际 {len(pages)} 个")
    print(json.dumps([without_editor_ids(node) for node in pages[0]["children"]],
                     ensure_ascii=False, indent=2))
