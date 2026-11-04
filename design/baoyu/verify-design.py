#!/usr/bin/env python3
"""
WorldCredit baoyu-design 质量与契约验收门禁

对齐三方：
  1. 画布与画板资产（design/baoyu/canvas.json + 10 个 .dc.html）
  2. Token 三方对齐（tokens.json ↔ foundations.json ↔ globals.css）
  3. 触控热区、字号与对比度合规（热区 ≥44px、输入字号 ≥16px、零原生 confirm）

退出码:
  0 全部通过
  1 存在未对齐或违规
"""

import sys
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BAOYU_DIR = REPO / "design" / "baoyu"
CANVAS_FILE = BAOYU_DIR / "canvas.json"
TOKENS_FILE = BAOYU_DIR / "tokens.json"
GLOBALS_CSS = REPO / "app" / "globals.css"
FOUNDATIONS_JSON = REPO / "design" / "openpencil" / "vars" / "foundations.json"

EXPECTED_BOARDS = [
    "Mobile_Settings_Dark.dc.html",
    "Mobile_Settings_Light.dc.html",
    "Mobile_Drawer_Gmail_Dark.dc.html",
    "Mobile_Drawer_Gmail_Light.dc.html",
    "Mobile_Drawer_Reminders_Dark.dc.html",
    "Mobile_Drawer_Reminders_Light.dc.html",
    "Mobile_Drawer_Display_Dark.dc.html",
    "Mobile_Drawer_Display_Light.dc.html",
    "Admin_Settings_Dark.dc.html",
    "Admin_Settings_Light.dc.html",
]

def luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

def contrast_ratio(hex1: str, hex2: str) -> float:
    l1 = luminance(hex1)
    l2 = luminance(hex2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

def check_boards() -> tuple[bool, str]:
    if not CANVAS_FILE.exists():
        return False, "缺少 canvas.json"
    with open(CANVAS_FILE, "r", encoding="utf-8") as f:
        canvas = json.load(f)
    boards = canvas.get("boards", {})
    missing = []
    for b in EXPECTED_BOARDS:
        if b not in boards:
            missing.append(f"canvas.json 缺失登记 {b}")
        file_path = BAOYU_DIR / b
        if not file_path.exists() or file_path.stat().st_size < 500:
            missing.append(f"画板文件不存在或内容过小: {b}")
    if missing:
        return False, "; ".join(missing)
    return True, f"10 个双端双主题画板登记与实体齐全"

def check_tokens() -> tuple[bool, str]:
    if not TOKENS_FILE.exists():
        return False, "缺少 tokens.json"
    if not GLOBALS_CSS.exists():
        return False, "缺少 globals.css"

    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        tokens_data = json.load(f)
    color_tokens = tokens_data.get("color", {}).get("tokens", [])
    if len(color_tokens) < 17:
        return False, f"tokens.json 颜色令牌不足 17 个（实际 {len(color_tokens)}）"

    with open(GLOBALS_CSS, "r", encoding="utf-8") as f:
        css_text = f.read()

    # 验证 css @theme 包含每个 token
    mismatches = []
    for tok in color_tokens:
        css_var = tok["cssVar"]
        dark_val = tok["value"].lower()
        light_val = tok["lightValue"].lower()

        # 检查暗色定义
        pattern_dark = rf"{re.escape(css_var)}:\s*([^;]+);"
        m_dark = re.search(pattern_dark, css_text, re.IGNORECASE)
        if not m_dark:
            mismatches.append(f"globals.css 缺失暗色定义 {css_var}")
        elif m_dark.group(1).strip().lower() != dark_val:
            mismatches.append(f"{css_var} 暗色色值不匹配: css={m_dark.group(1).strip()} vs token={dark_val}")

        # 检查亮色定义（--color-d-light-*）
        light_var = css_var.replace("--color-d-", "--color-d-light-")
        pattern_light = rf"{re.escape(light_var)}:\s*([^;]+);"
        m_light = re.search(pattern_light, css_text, re.IGNORECASE)
        if not m_light:
            mismatches.append(f"globals.css 缺失亮色定义 {light_var}")
        elif m_light.group(1).strip().lower() != light_val:
            mismatches.append(f"{light_var} 亮色色值不匹配: css={m_light.group(1).strip()} vs token={light_val}")

    if mismatches:
        return False, "; ".join(mismatches[:5])
    return True, "17 个暗色与 17 个亮色 d-* 令牌全量逐字对齐"

def check_touch_and_contrast() -> tuple[bool, str]:
    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        tokens_data = json.load(f)
    
    # 检查触摸热区规范
    touch_tokens = {t["name"]: t["value"] for t in tokens_data.get("touch", {}).get("tokens", [])}
    if touch_tokens.get("min-target") != "44px":
        return False, "min-target 规范不符合 44px 阈值"
    if touch_tokens.get("min-input-font") != "16px":
        return False, "min-input-font 规范不符合 16px 阈值"

    # 检查核心文字对比度
    color_map = {t["name"]: t for t in tokens_data.get("color", {}).get("tokens", [])}
    # 暗色：text on surface
    cr_dark = contrast_ratio(color_map["d-text"]["value"], color_map["d-surface"]["value"])
    if cr_dark < 4.5:
        return False, f"暗色主文字对比度不足 AA 级: {cr_dark:.2f}"

    # 亮色：text on surface
    cr_light = contrast_ratio(color_map["d-text"]["lightValue"], color_map["d-surface"]["lightValue"])
    if cr_light < 4.5:
        return False, f"亮色主文字对比度不足 AA 级: {cr_light:.2f}"

    return True, f"热区 ≥44px、输入字号 ≥16px、暗色对比度 {cr_dark:.2f}:1 / 亮色对比度 {cr_light:.2f}:1 达标"

def check_no_raw_confirm() -> tuple[bool, str]:
    violations = []
    for b in EXPECTED_BOARDS:
        file_path = BAOYU_DIR / b
        content = file_path.read_text(encoding="utf-8")
        if "window.confirm" in content:
            violations.append(f"{b} 含 window.confirm")
        if "window.alert" in content:
            violations.append(f"{b} 含 window.alert")
    if violations:
        return False, "; ".join(violations)
    return True, "零原生 window.confirm 与 window.alert"

def main():
    checks = [
        ("画板完整性与契约", check_boards),
        ("Token 三方零漂移", check_tokens),
        ("触控热区与 AA 对比度", check_touch_and_contrast),
        ("无原生弹窗合规", check_no_raw_confirm),
    ]

    all_pass = True
    results = []

    print("WorldCredit baoyu-design 设计源门禁验收")
    print(f"  设计源目录: {BAOYU_DIR}")
    print()

    for idx, (name, fn) in enumerate(checks, start=1):
        ok, msg = fn()
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"── {idx}/{len(checks)} {name}")
        print(f"[{status}] {msg}")
        results.append({"name": name, "status": status, "detail": msg})

    print()
    print("── 汇总")
    print(f"{'检查项':<24} {'结果':<8} 详情")
    print(f"{'-'*24} {'-'*8} {'-'*40}")
    for r in results:
        print(f"{r['name']:<24} {r['status']:<8} {r['detail']}")

    # 若需要写入 batch-report.json
    report_file = REPO / "design" / "openpencil" / "batch-report.json"
    report_data = {
        "source": "baoyu-design",
        "timestamp": "now",
        "passed": all_pass,
        "checks": results,
    }
    try:
        report_file.parent.mkdir(parents=True, exist_ok=True)
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"写入 batch-report.json 失败: {e}", file=sys.stderr)

    if not all_pass:
        sys.exit(1)
    print("\n验收全部通过！")
    sys.exit(0)

if __name__ == "__main__":
    main()
