#!/usr/bin/env python3
"""
母版溢出检查（便携版）— 只读 .op 文件，不依赖 OpenPencil 运行时。

为什么需要便携版：
  `scripts/check-overflow.py` 依赖 `op` CLI 计算布局，而 `op` 是 macOS 专属的
  nanobrew formula，GitHub Actions 的 Linux runner 装不了。
  本脚本直接从 `.op` JSON 读取几何信息，可在任意平台运行，因此能进 CI。

能查什么：
  - 屏母版 frame 尺寸是否与声明的名称一致（`name` 里的 WxH）
  - `layout: none` 容器内的绝对定位子节点是否越出父容器（x + width > 父宽）
  - 绝对定位子节点是否越出视口高度（y + height > 父高）
  - 同层绝对定位子节点是否互相重叠

不能查什么（需要 OpenPencil 引擎计算，留在 check-overflow.py）：
  - `layout: horizontal|vertical` 容器内的子节点越界（.op 里不存这些节点的坐标）

用法:
    python3 design/openpencil/scripts/check-overflow-portable.py
退出码: 0 通过 / 1 发现溢出 / 2 设计源缺失或解析失败
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OP_FILE = REPO / "design" / "openpencil" / "worldcredit-redesign.op"

# 受管屏 frame 名称形如 `screen.mobile.dashboard · 390×844`；
# P0-2 起 candidate.* 候选帧同样纳入几何检查（Current 与 Candidate 双轨同规则）。
SCREEN_NAME = re.compile(r"^(?:screen|candidate)\.(?P<role>[\w]+)\.(?P<key>[\w-]+)(?P<suffix>.*)$")
SIZE_IN_NAME = re.compile(r"(?P<w>\d{3,4})[×x](?P<h>\d{3,4})")

TOLERANCE = 2.0


def collect(node, out: list[dict]) -> None:
    if isinstance(node, dict):
        out.append(node)
        for c in node.get("children") or []:
            collect(c, out)
    elif isinstance(node, list):
        for c in node:
            collect(c, out)


def numeric(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def check_frame(frame: dict) -> list[dict]:
    issues: list[dict] = []
    name = str(frame.get("name") or "")
    fw, fh = numeric(frame.get("width")), numeric(frame.get("height"))
    if fw is None or fh is None:
        return issues

    # 1) 名称声明的尺寸必须与实际一致
    m = SIZE_IN_NAME.search(name)
    if m:
        declared_w, declared_h = float(m.group("w")), float(m.group("h"))
        if abs(declared_w - fw) > TOLERANCE or abs(declared_h - fh) > TOLERANCE:
            issues.append({
                "frame": name, "kind": "size-mismatch",
                "detail": f"名称声明 {declared_w:g}×{declared_h:g}，实际 {fw:g}×{fh:g}",
            })

    children = [c for c in (frame.get("children") or []) if isinstance(c, dict)]
    # 只在 layout:none 的容器上做绝对定位校验（layout 容器由引擎排版，坐标不落盘）
    absolute = [c for c in children if numeric(c.get("x")) is not None and numeric(c.get("y")) is not None]

    # 2) 越出父容器边界
    for c in absolute:
        cx, cy = numeric(c.get("x")), numeric(c.get("y"))
        cw, ch = numeric(c.get("width")), numeric(c.get("height"))
        cn = str(c.get("name") or "?")
        if cw is not None and cx + cw > fw + TOLERANCE:
            issues.append({
                "frame": name, "node": cn, "kind": "horizontal-overflow",
                "detail": f"右边界 {cx + cw:g} > 容器宽 {fw:g}（超出 {cx + cw - fw:g}）",
            })
        if ch is not None and cy + ch > fh + TOLERANCE:
            issues.append({
                "frame": name, "node": cn, "kind": "vertical-overflow",
                "detail": f"下边界 {cy + ch:g} > 容器高 {fh:g}（超出 {cy + ch - fh:g}）",
            })
        if cx < -TOLERANCE or cy < -TOLERANCE:
            issues.append({
                "frame": name, "node": cn, "kind": "negative-offset",
                "detail": f"起点坐标 ({cx:g}, {cy:g}) 为负",
            })

    # 3) 同层绝对定位节点重叠（忽略装饰层与显式允许的覆盖）
    for i, a in enumerate(absolute):
        ax, ay = numeric(a.get("x")), numeric(a.get("y"))
        aw, ah = numeric(a.get("width")), numeric(a.get("height"))
        if None in (ax, ay, aw, ah):
            continue
        for b in absolute[i + 1:]:
            bx, by = numeric(b.get("x")), numeric(b.get("y"))
            bw, bh = numeric(b.get("width")), numeric(b.get("height"))
            if None in (bx, by, bw, bh):
                continue
            ox = min(ax + aw, bx + bw) - max(ax, bx)
            oy = min(ay + ah, by + bh) - max(ay, by)
            if ox > TOLERANCE and oy > TOLERANCE:
                issues.append({
                    "frame": name,
                    "node": f"{a.get('name')} ∩ {b.get('name')}",
                    "kind": "overlap",
                    "detail": f"重叠 {ox:g}×{oy:g}",
                })
    return issues


def main() -> int:
    if not OP_FILE.exists():
        print(f"找不到设计源: {OP_FILE}", file=sys.stderr)
        return 2
    try:
        doc = json.loads(OP_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"设计源解析失败: {exc}", file=sys.stderr)
        return 2

    all_issues: list[dict] = []
    screen_count = 0
    for page in doc.get("pages", []):
        nodes: list[dict] = []
        collect(page, nodes)
        for n in nodes:
            if n.get("type") != "frame":
                continue
            nm = str(n.get("name") or "")
            if not SCREEN_NAME.match(nm):
                continue
            screen_count += 1
            all_issues.extend(check_frame(n))

    if not screen_count:
        print("未找到任何 screen.*/candidate.* 屏 frame，检查设计源是否损坏", file=sys.stderr)
        return 2

    print(f"检查 {screen_count} 个屏母版（便携版，不依赖 OpenPencil 运行时）")
    if all_issues:
        for i in all_issues:
            loc = f"{i['frame']} → {i.get('node', '-')}"
            print(f"  FAIL {i['kind']:<20} {loc}: {i['detail']}")
        print(f"\n发现 {len(all_issues)} 项几何问题", file=sys.stderr)
        return 1
    print("无溢出、无尺寸不一致、无同层重叠")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
