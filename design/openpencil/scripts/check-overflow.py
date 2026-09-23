#!/usr/bin/env python3
"""
母版溢出检查 — 找出超出视口边界或在页头横向溢出的元素。

背景: `screen.mobile.benefits` 曾在 390 宽下把两个按钮塞进页头，
      右侧按钮被裁掉。肉眼在图上看得到，但回归脚本不会报。
      本脚本用 OpenPencil 的 layout 快照做几何校验。

用法:
    python3 design/openpencil/scripts/check-overflow.py
退出码: 0 无溢出 / 1 发现溢出 / 2 无法读取 layout
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

# 每个设计页 id → 视口宽度（与 capture.py 的 viewport 对齐）
PAGES = {
    "n14": ("10 · Mobile Core", 390, 430),
    "n16": ("11 · Mobile Details", 390),
    "n18": ("12 · Mobile Extended", 390),
    "n20": ("20 · Auth & Public", 390),
    "n22": ("30 · Admin", 1440),
}

TOLERANCE = 2  # 浮点与描边造成的亚像素误差


def op(*args: str) -> str:
    return subprocess.run(["op", *args], cwd=str(REPO), capture_output=True, text=True).stdout


def page_index(page_id: str) -> int | None:
    try:
        d = json.loads(op("page", "list"))
        return next(i for i, p in enumerate(d["pages"]) if p["id"] == page_id)
    except Exception:
        return None


def check_page(page_id: str, label: str, widths: tuple[int, ...]) -> list[dict]:
    idx = page_index(page_id)
    if idx is None:
        return [{"page": label, "error": "page not found"}]
    op("set_active_page", f"index={idx}")
    raw = op("layout", "--depth", "3")
    try:
        data = json.loads(raw)
    except Exception:
        return [{"page": label, "error": "layout parse failed"}]

    issues: list[dict] = []

    def walk(node: dict, path: str, frame_width: int | None, frame_name: str):
        w = node.get("width")
        x = node.get("x")
        name = node.get("name", "?")

        # 记录顶层 frame 作为视口基准
        if frame_width is None and isinstance(w, (int, float)) and w >= 300:
            frame_width = int(w)
            frame_name = name

        # 横向越界：x + width 超过视口
        if frame_width and isinstance(x, (int, float)) and isinstance(w, (int, float)):
            if x + w > frame_width + TOLERANCE:
                issues.append({
                    "page": label, "frame": frame_name, "node": name,
                    "kind": "horizontal-overflow",
                    "right": round(x + w, 1), "frameWidth": frame_width,
                    "overBy": round(x + w - frame_width, 1),
                })
        for child in node.get("children") or []:
            walk(child, f"{path}/{name}", frame_width, frame_name)

    for n in data.get("layout") or []:
        walk(n, "", None, "")

    # 视口宽度校验：确认导出尺寸符合预期
    for n in data.get("layout") or []:
        w = n.get("width")
        if isinstance(w, (int, float)) and w >= 300 and int(w) not in widths:
            issues.append({
                "page": label, "frame": n.get("name"), "kind": "unexpected-frame-width",
                "width": int(w), "expected": list(widths),
            })
    return issues


def main() -> int:
    all_issues: list[dict] = []
    for page_id, (label, *widths) in PAGES.items():
        found = check_page(page_id, label, tuple(widths))
        errs = [f for f in found if "error" in f]
        over = [f for f in found if f.get("kind")]
        status = "FAIL" if (errs or over) else "OK  "
        print(f"{status}{label}")
        for e in errs:
            print(f"       {e['error']}")
        for o in over:
            if o["kind"] == "horizontal-overflow":
                print(f"       溢出: {o['frame']} → {o['node']} 超出 {o['overBy']}px (右边界 {o['right']} > {o['frameWidth']})")
            else:
                print(f"       尺寸异常: {o['frame']} 宽 {o['width']}，期望 {o['expected']}")
        all_issues.extend(found)

    if all_issues:
        print(f"\n发现 {len(all_issues)} 项问题", file=sys.stderr)
        return 1
    print("\n无溢出，全部母版在视口内")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
