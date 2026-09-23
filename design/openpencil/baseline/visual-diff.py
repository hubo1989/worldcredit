#!/usr/bin/env python3
"""
视觉回归比对 — 把基线截图当 approval baseline。

用法:
    # 1. 更新基线（人工确认后）
    python3 design/openpencil/baseline/visual-diff.py --update

    # 2. 比对当前实现与基线（CI / 批次验收）
    python3 design/openpencil/baseline/visual-diff.py

    # 只比部分路由 / 状态
    python3 design/openpencil/baseline/visual-diff.py --only dashboard bills
    python3 design/openpencil/baseline/visual-diff.py --states default error

退出码:
    0  全部在阈值内
    1  存在超阈值差异（CI 应失败）
    2  缺少基线或输入不完整

工作方式:
    baseline/approved/   人工确认过的基线（真源）
    baseline/shots/      本次实拍结果（capture.py 产出）
    baseline/diff/       差异叠加图 + 逐像素统计

阈值:
    默认「差异像素占比 > 0.5% 或无差异图生成失败」判为失败。
    用 --threshold 调整；文案变化类改动调高，纯结构改动调低。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("缺少 Pillow。安装：python3 -m pip install pillow")

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "design" / "openpencil" / "baseline"
APPROVED = BASE / "approved"
SHOTS = BASE / "shots"
DIFF = BASE / "diff"
REPORT = BASE / "visual-report.json"

# 与 capture.py 的 ROUTES 保持一致；新增基线路由时两边都要加。
ROUTES = [
    "dashboard", "bills", "card-detail", "analytics", "login", "admin-banks",
    "bill-detail", "benefits", "gmail-ledger", "settings",
    "admin-dashboard", "admin-email-logs",
]
STATES = ["default", "loading", "empty", "error"]

DEFAULT_THRESHOLD = 0.005  # 0.5% 像素


def rel_pairs(routes, states):
    for r in routes:
        for s in states:
            yield r, s


def update_baseline(routes, states):
    """把当前 shots 提升为 approved。仅在人工确认视觉正确后调用。"""
    n = 0
    manifest = []
    for route, state in rel_pairs(routes, states):
        src = SHOTS / route / f"{state}.png"
        if not src.exists():
            continue
        dst_dir = APPROVED / route
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / f"{state}.png"
        dst.write_bytes(src.read_bytes())
        manifest.append({"route": route, "state": state, "bytes": dst.stat().st_size})
        n += 1
    (APPROVED / "manifest.json").write_text(
        json.dumps({"count": n, "entries": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"baseline updated: {n} image(s) -> {APPROVED.relative_to(REPO)}")
    return 0


def compare_one(route: str, state: str, threshold: float):
    exp_path = APPROVED / route / f"{state}.png"
    got_path = SHOTS / route / f"{state}.png"

    if not exp_path.exists() and not got_path.exists():
        return None
    if not exp_path.exists():
        return {"route": route, "state": state, "status": "new", "note": "无基线，新增页面"}
    if not got_path.exists():
        return {"route": route, "state": state, "status": "missing", "note": "本次未产出，可能路由或状态改名"}

    exp = Image.open(exp_path).convert("RGB")
    got = Image.open(got_path).convert("RGB")

    if exp.size != got.size:
        return {
            "route": route, "state": state, "status": "size-mismatch",
            "expected": list(exp.size), "actual": list(got.size),
            "note": "视口或 deviceScaleFactor 变了，需要重新批准基线",
        }

    diff = ImageChops.difference(exp, got)
    gray = diff.convert("L")
    # 容差 12：滤掉抗锯齿与亚像素渲染噪声，只保留真实视觉变化
    mask = gray.point(lambda p: 255 if p > 12 else 0)
    changed = sum(mask.histogram()[255:])
    total = exp.size[0] * exp.size[1]
    ratio = changed / total if total else 0.0

    DIFF.mkdir(parents=True, exist_ok=True)
    diff_dir = DIFF / route
    diff_dir.mkdir(parents=True, exist_ok=True)

    # 叠加图：差异处标红，便于人工定位
    overlay = got.copy()
    red = Image.new("RGB", exp.size, (255, 0, 0))
    overlay.paste(red, mask=mask)
    overlay.save(diff_dir / f"{state}.png")

    return {
        "route": route,
        "state": state,
        "status": "fail" if ratio > threshold else "pass",
        "changedPixels": changed,
        "totalPixels": total,
        "ratio": round(ratio, 5),
        "threshold": threshold,
        "diffImage": str((diff_dir / f"{state}.png").relative_to(REPO)),
    }


def main():
    ap = argparse.ArgumentParser(description="WorldCredit 视觉回归比对")
    ap.add_argument("--update", action="store_true", help="把当前 shots 提升为基线")
    ap.add_argument("--only", nargs="*", choices=[*ROUTES, "all"], default=["all"])
    ap.add_argument("--states", nargs="*", choices=[*STATES, "all"], default=["all"])
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help=f"差异像素占比阈值，默认 {DEFAULT_THRESHOLD}")
    args = ap.parse_args()

    routes = ROUTES if "all" in args.only else args.only
    states = STATES if "all" in args.states else args.states

    if args.update:
        return update_baseline(routes, states)

    if not APPROVED.exists() or not any(APPROVED.rglob("*.png")):
        print("没有基线。先跑 capture.py，人工确认后执行 --update", file=sys.stderr)
        return 2

    results = []
    for route, state in rel_pairs(routes, states):
        r = compare_one(route, state, args.threshold)
        if r:
            results.append(r)

    for r in results:
        st = r["status"]
        if st == "pass":
            print(f"pass  {r['route']:<18}{r['state']:<8} {r['ratio']*100:.3f}% ({r['changedPixels']} px)")
        elif st == "fail":
            print(f"FAIL  {r['route']:<18}{r['state']:<8} {r['ratio']*100:.3f}% > {r['threshold']*100:.3f}%  diff={r['diffImage']}")
        else:
            print(f"{st.upper():<6}{r['route']:<18}{r['state']:<8} {r.get('note','')}")

    fails = [r for r in results if r["status"] == "fail"]
    review = [r for r in results if r["status"] in ("missing", "size-mismatch", "new")]

    report = {
        "threshold": args.threshold,
        "routes": routes,
        "states": states,
        "summary": {
            "total": len(results),
            "pass": sum(1 for r in results if r["status"] == "pass"),
            "fail": len(fails),
            "needsReview": len(review),
        },
        "results": results,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    s = report["summary"]
    print(f"\n{s['pass']}/{s['total']} pass | {s['fail']} fail | {s['needsReview']} needs review")
    print(f"report: {REPORT.relative_to(REPO)}")
    if review:
        print("needs review 需要人工确认后再 --update", file=sys.stderr)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
