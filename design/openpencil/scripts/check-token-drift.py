#!/usr/bin/env python3
"""
设计源 ↔ 实现 token 漂移检查（便携版）— 只读 JSON / CSS / TS 文本。

为什么需要它：
  var/foundations.json 是设计源 token，app/globals.css 与 lib/theme.ts
  是运行时 token。三者历史上各存一套语义色（设计源 #CF2E2E / globals.css
  曾用 #16A34A / theme.ts 用 #d32f2f），导致同一句「逾期」在不同组件里
  渲染成两种红。现有门禁查不到这类问题：
    - check-master-fields.py 只比文案；
    - check-overflow-portable.py 只看几何；
    - lib/__tests__/color-contrast.test.ts 只在 app 内部自洽，不比对设计源。
  本脚本把「三个源必须一致」变成可计算的断言，并登记已知漂移。

判定模型：
  每个 token 在三个源里最多各有一个声明值。取值不全相同即「漂移」。
  漂移只有在 knownDrift 里逐条登记（且登记值与实测值完全一致）才放行，
  因此白名单一旦过期就会失败，不会掩盖回归。

用法:
    python3 design/openpencil/scripts/check-token-drift.py
    python3 design/openpencil/scripts/check-token-drift.py --report
    python3 design/openpencil/scripts/check-token-drift.py --json

退出码: 0 通过 / 1 存在未登记漂移或对比度不达标 / 2 输入缺失或映射表不合法

边界：本脚本**不**接入 verify-batch.sh，也**不**改变现有门禁语义。
是否接入由人决策（见 screens/NAMING.md 第 6 节）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_MAP = REPO / "design" / "openpencil" / "screens" / "_token-map.json"
DEFAULT_DESIGN = REPO / "design" / "openpencil" / "vars" / "foundations.json"
DEFAULT_OP = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
DEFAULT_CSS = REPO / "app" / "globals.css"
DEFAULT_THEME = REPO / "lib" / "theme.ts"

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
AA_NORMAL, AA_LARGE = 4.5, 3.0


# ---------------------------------------------------------------------------
# 三个源的解析
# ---------------------------------------------------------------------------
def load_design_tokens(path: Path) -> dict[str, str]:
    """foundations.json -> {design token 名: #hex}。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for name, spec in raw.items():
        value = spec.get("value") if isinstance(spec, dict) else None
        if isinstance(value, str) and HEX_RE.match(value.strip()):
            out[name] = value.strip().lower()
    return out


def load_op_tokens(path: Path) -> dict[str, str]:
    """worldcredit-redesign.op 内嵌的 variables -> {token 名: #hex}。

    .op 的变量是从 foundations.json 经 upsert_variables 注册进文档的
    （conversion ledger key=worldcredit-foundations-v1，带 sourcePath）。
    因此两者**本应完全相同**；只有一方被改过就会出现漂移。
    只改 foundations.json 而不同步 .op，等于把漂移挪到新的位置。
    """
    doc = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for name, spec in (doc.get("variables") or {}).items():
        value = spec.get("value") if isinstance(spec, dict) else spec
        if isinstance(value, str) and HEX_RE.match(value.strip()):
            out[name] = value.strip().lower()
    return out


def load_css_tokens(path: Path) -> dict[str, str]:
    """globals.css 的**首个** :root 块 -> {--var: #hex}（亮色世界）。

    只取第一块：后面的 admin 暗色块会覆盖同名变量，混进来会造成假漂移。
    """
    css = path.read_text(encoding="utf-8")
    if ":root {" not in css:
        raise ValueError("globals.css 缺少 :root 块")
    block = css.split(":root {", 1)[1].split("\n}", 1)[0]
    out: dict[str, str] = {}
    for name, value in re.findall(r"(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})", block):
        out.setdefault(name, value.lower())
    return out


def load_theme_tokens(path: Path, css: dict[str, str] | None = None) -> dict[str, str]:
    """lib/theme.ts 的 createTheme 块 -> {world.path: #hex}。

    世界标签由 createTheme 前的 export const 名推断：
      lightTheme     -> light
      adminDarkTheme -> admin
    """
    src = path.read_text(encoding="utf-8")
    blocks: list[tuple[str, str]] = []
    for m in re.finditer(r"export const (\w+)\s*=\s*createTheme\(\{", src):
        start = m.end()
        end = src.find("\n})", start)
        name = m.group(1).lower()
        world = "admin" if ("admin" in name or "dark" in name) else "light"
        blocks.append((world, src[start:end if end != -1 else len(src)]))

    out: dict[str, str] = {}
    for world, body in blocks:
        for key, value in re.findall(r"(\w+):\s*\{\s*main:\s*'(#[0-9A-Fa-f]{6})'", body):
            out.setdefault(f"{world}.{key}.main", value.lower())
        for shade in ("light", "dark"):
            for palette, value in re.findall(
                r"(\w+):\s*\{[^{}]*?" + shade + r":\s*'(#[0-9A-Fa-f]{6})'", body
            ):
                out.setdefault(f"{world}.{palette}.{shade}", value.lower())
        m = re.search(
            r"background:\s*\{\s*default:\s*'(#[0-9A-Fa-f]{6})',\s*paper:\s*'(#[0-9A-Fa-f]{6})'",
            body,
        )
        if m:
            out.setdefault(f"{world}.background.default", m.group(1).lower())
            out.setdefault(f"{world}.background.paper", m.group(2).lower())
        m = re.search(r"text:\s*\{([^{}]*)\}", body)
        if m:
            for key, raw_value in re.findall(r"(primary|secondary|disabled):\s*'([^']+)'", m.group(1)):
                value = raw_value.lower()
                variable = re.fullmatch(r"var\((--[\w-]+)\)", value)
                if variable:
                    value = (css or {}).get(variable.group(1), "").lower()
                if HEX_RE.fullmatch(value):
                    out.setdefault(f"{world}.text.{key}", value)
        m = re.search(r"divider:\s*'(#[0-9A-Fa-f]{6})'", body)
        if m:
            out.setdefault(f"{world}.divider", m.group(1).lower())
    return out


def load_design_scalars(path: Path) -> tuple[dict[str, float], dict[str, str]]:
    """foundations.json 的 number / string token（颜色除外）。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    nums: dict[str, float] = {}
    strs: dict[str, str] = {}
    for name, spec in raw.items():
        value = spec.get("value") if isinstance(spec, dict) else None
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            nums[name] = float(value)
        elif isinstance(value, str) and not HEX_RE.match(value.strip()):
            strs[name] = value.strip()
    return nums, strs


def load_op_scalars(path: Path) -> tuple[dict[str, float], dict[str, str]]:
    """.op variables 里的 number / string token，须与 foundations.json 同步。"""
    doc = json.loads(path.read_text(encoding="utf-8"))
    nums: dict[str, float] = {}
    strs: dict[str, str] = {}
    for name, spec in (doc.get("variables") or {}).items():
        value = spec.get("value") if isinstance(spec, dict) else spec
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            nums[name] = float(value)
        elif isinstance(value, str) and not HEX_RE.match(value.strip()):
            strs[name] = value.strip()
    return nums, strs


def load_css_scalars(path: Path) -> tuple[dict[str, float], dict[str, str]]:
    """globals.css 全部 :root 块里的数值（去 px）与字符串（忽略 var() 引用）。

    颜色仍由 load_css_tokens 只读首个 :root；排版 token 在第二个 :root 块，
    因此标量解析合并所有 :root。admin 暗色不是 :root 选择器，不会混入。
    """
    css = path.read_text(encoding="utf-8")
    if ":root {" not in css:
        raise ValueError("globals.css 缺少 :root 块")
    nums: dict[str, float] = {}
    strs: dict[str, str] = {}
    rest = css
    while ":root {" in rest:
        block = rest.split(":root {", 1)[1]
        body = block.split("\n}", 1)[0]
        for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body):
            value = value.strip()
            if "var(" in value:
                continue
            m = re.fullmatch(r"(-?[0-9.]+)px", value)
            if m:
                nums.setdefault(name, float(m.group(1)))
            elif not HEX_RE.match(value):
                strs.setdefault(name, value)
        rest = block
    return nums, strs


def _norm_str(value: str) -> str:
    """字符串 token 比较前的规范化：去引号与空白。"""
    return value.replace('"', "").replace(" ", "")


# ---------------------------------------------------------------------------
# 颜色工具（用于对比度断言）
# ---------------------------------------------------------------------------
def _rgb(value: str) -> tuple[int, int, int]:
    h = value.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _luminance(value: str) -> float:
    def channel(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = _rgb(value)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(fg: str, bg: str) -> float:
    a, b = _luminance(fg), _luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def tint(fg: str, pct: float, over: str = "#FFFFFF") -> str:
    """近似 color-mix(in srgb, fg pct%, over)：sRGB 线性插值。"""
    f, o = _rgb(fg), _rgb(over)
    mixed = [round(f[i] * pct + o[i] * (1 - pct)) for i in range(3)]
    return "#" + "".join(f"{v:02x}" for v in mixed)


# ---------------------------------------------------------------------------
# 映射表校验（结构性错误 -> 退出码 2）
# ---------------------------------------------------------------------------
def validate_map(
    mapf: dict, design: dict, op: dict, css: dict, theme: dict,
    scalars: dict | None = None,
) -> list[str]:
    errors: list[str] = []
    if mapf.get("reviewStatus") != "proposed":
        errors.append(f"reviewStatus 应为 'proposed'，收到 {mapf.get('reviewStatus')!r}")

    seen: set[str] = set()
    referenced_design: set[str] = set()
    for entry in mapf.get("mappings") or []:
        mid = entry.get("id")
        if not mid:
            errors.append("mappings 存在无 id 项")
            continue
        if mid in seen:
            errors.append(f"mappings id 重复: {mid}")
        seen.add(mid)
        dtok = entry.get("design")
        if not dtok:
            errors.append(f"{mid} 缺少 design 来源")
        else:
            referenced_design.add(dtok)
            if dtok not in design:
                errors.append(f"{mid} 的 design token {dtok!r} 不在 foundations.json")
        cssvar = entry.get("css")
        if cssvar and cssvar not in css:
            errors.append(f"{mid} 的 css 变量 {cssvar!r} 不在 globals.css :root")
        tpath = entry.get("theme")
        if tpath and tpath not in theme:
            errors.append(f"{mid} 的 theme 路径 {tpath!r} 不在已加载的 theme 源（theme.ts 退役后该键应已移除）")
        if dtok not in op:
            errors.append(f"{mid} 的 design token {dtok!r} 不在 .op 的 variables（两者必须同名同步）")
        if not cssvar and not tpath:
            errors.append(f"{mid} 没有任何 app 侧来源（css / theme 至少一个）")

    # 覆盖度：design 侧每个颜色 token 要么被映射，要么显式登记为 designOnly
    design_only = set(mapf.get("designOnly") or [])
    for tok in sorted(design):
        if tok not in referenced_design and tok not in design_only:
            errors.append(f"design token {tok!r} 既未映射也未登记在 designOnly")
    for tok in sorted(design_only):
        if tok in referenced_design:
            errors.append(f"designOnly 里的 {tok!r} 已被 mappings 引用，属冗余登记")
        if tok not in design:
            errors.append(f"designOnly 里的 {tok!r} 不在 foundations.json")

    for entry in mapf.get("knownDrift") or []:
        if not entry.get("id") or not entry.get("reason") or not entry.get("values"):
            errors.append(f"knownDrift 项必须含 id / reason / values，问题项: {entry.get('id')!r}")
        elif entry["id"] not in seen:
            errors.append(f"knownDrift 引用了不存在的 mapping: {entry['id']}")

    for check in (mapf.get("contrastChecks") or []) + (mapf.get("documentedFailures") or []):
        if not check.get("id"):
            errors.append("contrastChecks / documentedFailures 存在无 id 项")
    if scalars is not None:
        design_num, design_str = scalars["designNum"], scalars["designStr"]
        css_num, css_str = scalars["cssNum"], scalars["cssStr"]
        for section, table, css_table, only_key, kind in (
            ("numericMappings", design_num, css_num, "numericDesignOnly", "数值"),
            ("stringMappings", design_str, css_str, "stringDesignOnly", "字符串"),
        ):
            scalar_referenced: set[str] = set()
            for entry in mapf.get(section) or []:
                mid = entry.get("id")
                if not mid:
                    errors.append(f"{section} 存在无 id 项")
                    continue
                if mid in seen:
                    errors.append(f"{section} id 与其他 mapping 重复: {mid}")
                seen.add(mid)
                dtok = entry.get("design")
                if not dtok:
                    errors.append(f"{mid} 缺少 design 来源")
                elif dtok not in table:
                    errors.append(f"{mid} 的 design token {dtok!r} 不在 foundations.json 的 {kind} token 中")
                else:
                    scalar_referenced.add(dtok)
                cssvar = entry.get("css")
                if cssvar and cssvar not in css_table:
                    errors.append(f"{mid} 的 css 变量 {cssvar!r} 不在 globals.css :root")
                if not cssvar:
                    errors.append(f"{mid} 缺少 app 侧 css 来源")
            for tok in sorted(table):
                if tok not in scalar_referenced and tok not in set(mapf.get(only_key) or []):
                    errors.append(f"{kind} token {tok!r} 既未映射也未登记在 {only_key}")
            for tok in sorted(mapf.get(only_key) or []):
                if tok in scalar_referenced:
                    errors.append(f"{only_key} 里的 {tok!r} 已被 {section} 引用，属冗余登记")
                if tok not in table:
                    errors.append(f"{only_key} 里的 {tok!r} 不在 foundations.json 的 {kind} token 中")
    return errors



# ---------------------------------------------------------------------------
# 判定
# ---------------------------------------------------------------------------
def resolve(entry: dict, design: dict, op: dict, css: dict, theme: dict) -> dict[str, str]:
    got: dict[str, str] = {}
    if entry.get("design") in design:
        got["design"] = design[entry["design"]]
    if entry.get("design") in op:
        got["op"] = op[entry["design"]]
    if entry.get("css") in css:
        got["css"] = css[entry["css"]]
    if entry.get("theme") in theme:
        got["theme"] = theme[entry["theme"]]
    return got


def _pick(spec: dict, op: dict, css: dict, theme: dict) -> str | None:
    if "literal" in spec:
        return spec["literal"].lower()
    if spec.get("design") in op:
        return op[spec["design"]]
    if spec.get("css") in css:
        return css[spec["css"]]
    if spec.get("theme") in theme:
        return theme[spec["theme"]]
    return None


def check(
    mapf: dict, design: dict, op: dict, css: dict, theme: dict,
    scalars: dict | None = None,
) -> tuple[int, list[str], dict]:
    lines: list[str] = []
    failures: list[str] = []
    summary: dict = {
        "drift": [], "newDrift": [], "staleDrift": [], "changedDrift": [],
        "contrast": [], "documented": [], "failures": [],
        "sourceOnly": [], "sourceMissing": [],
    }

    # 0) 设计源内部一致性：.op 的 variables 由 foundations.json 注册而来，
    #    两者必须逐 token 相同。只改一侧就会漂移。
    for tok in sorted(set(design) | set(op)):
        if tok in design and tok in op:
            if design[tok] != op[tok]:
                summary["sourceOnly"].append({"token": tok, "design": design[tok], "op": op[tok]})
        elif tok in design:
            summary["sourceMissing"].append({"token": tok, "missing": "op"})
        else:
            summary["sourceMissing"].append({"token": tok, "missing": "design"})
    for item in summary["sourceOnly"]:
        failures.append(
            f"source-drift {item['token']}: foundations={item['design']} .op={item['op']}"
            "（.op 变量由 foundations.json 注册，两者必须同步）"
        )
    for item in summary["sourceMissing"]:
        failures.append(
            f"source-missing {item['token']}: 只存在于 design 或 op 一侧（missing={item['missing']}）"
        )

    # 0b) 数值 / 字符串 token：设计源内部一致性 + 映射漂移（无白名单，直接失败）。
    if scalars is not None:
        design_num, design_str = scalars["designNum"], scalars["designStr"]
        op_num, op_str = scalars["opNum"], scalars["opStr"]
        css_num, css_str = scalars["cssNum"], scalars["cssStr"]
        for kind, dsrc, osrc in (("数值", design_num, op_num), ("字符串", design_str, op_str)):
            for tok in sorted(set(dsrc) | set(osrc)):
                if tok in dsrc and tok in osrc:
                    if dsrc[tok] != osrc[tok]:
                        failures.append(
                            f"source-drift[{kind}] {tok}: foundations={dsrc[tok]} .op={osrc[tok]}"
                        )
                elif tok in dsrc:
                    failures.append(f"source-missing[{kind}] {tok}: 只在 foundations.json 一侧")
                else:
                    failures.append(f"source-missing[{kind}] {tok}: 只在 .op 一侧")
        for section, dsrc, osrc, ctab, kind, norm in (
            ("numericMappings", design_num, op_num, css_num, "数值", False),
            ("stringMappings", design_str, op_str, css_str, "字符串", True),
        ):
            for entry in mapf.get(section) or []:
                got: dict[str, float | str] = {}
                if entry.get("design") in dsrc:
                    got["design"] = dsrc[entry["design"]]
                if entry.get("design") in osrc:
                    got["op"] = osrc[entry["design"]]
                if entry.get("css") in ctab:
                    got["css"] = ctab[entry["css"]]
                values = {k: (_norm_str(v) if norm and isinstance(v, str) else v)
                          for k, v in got.items()}
                if len(set(values.values())) > 1:
                    pretty = " ".join(f"{k}={v}" for k, v in got.items())
                    failures.append(f"new-drift[{kind}] {entry.get('id')}: {pretty}")

    baseline = {e["id"]: e for e in mapf.get("knownDrift") or []}
    observed: dict[str, dict[str, str]] = {}
    for entry in mapf.get("mappings") or []:
        got = resolve(entry, design, op, css, theme)
        if len(set(got.values())) > 1:
            observed[entry["id"]] = got

    # 1) 未登记 / 值变了的漂移
    for mid, got in sorted(observed.items()):
        pretty = " ".join(f"{k}={v}" for k, v in got.items())
        want = baseline.get(mid)
        if want is None:
            failures.append(f"new-drift {mid}: {pretty}（需在 _token-map.json 登记或修齐三个源）")
            summary["newDrift"].append({"id": mid, "values": got})
        elif want["values"] != got:
            failures.append(
                f"drift-changed {mid}: 实测 {pretty}，登记 {want['values']}（漂移值变了，请复核理由）"
            )
            summary["changedDrift"].append({"id": mid, "observed": got, "recorded": want["values"]})
        else:
            summary["drift"].append({"id": mid, "values": got, "reason": want["reason"]})

    # 2) 白名单腐化：登记了但实测已对齐
    for mid in sorted(baseline):
        if mid not in observed:
            failures.append(f"stale-known-drift {mid}: 已对齐，但仍登记在 knownDrift，请移除")
            summary["staleDrift"].append(mid)

    # 3) 对比度：app 侧必须达标
    for item in mapf.get("contrastChecks") or []:
        fg, base = _pick(item["fg"], op, css, theme), _pick(item["bg"], op, css, theme)
        min_ = float(item.get("min", AA_NORMAL))
        if fg is None or base is None:
            failures.append(f"contrast-unresolved {item['id']}: 无法解析前景或底色")
            continue
        bg = base
        if "pct" in item["bg"]:
            bg = tint(base, float(item["bg"]["pct"]) / 100, item["bg"].get("over", "#FFFFFF"))
        r = contrast(fg, bg)
        ok = r >= min_
        summary["contrast"].append({"id": item["id"], "fg": fg, "bg": bg,
                                    "ratio": round(r, 2), "min": min_, "ok": ok})
        if not ok:
            failures.append(f"contrast-fail {item['id']}: {fg} on {bg} = {r:.2f} < {min_}")
        lines.append(f"{'OK  ' if ok else 'FAIL'} contrast {item['id']:<24} {fg} on {bg} = {r:.2f} (min {min_})")

    # 4) 文档化前提：设计源本色压淡底确实不达标（ink 档存在的理由）
    for item in mapf.get("documentedFailures") or []:
        fg, base = _pick(item["fg"], op, css, theme), _pick(item["bg"], op, css, theme)
        max_ = float(item.get("max", AA_NORMAL))
        if fg is None or base is None:
            failures.append(f"documented-unresolved {item['id']}: 无法解析前景或底色")
            continue
        bg = tint(base, float(item["bg"].get("pct", 0)) / 100, item["bg"].get("over", "#FFFFFF"))
        r = contrast(fg, bg)
        holds = r < max_
        summary["documented"].append({"id": item["id"], "fg": fg, "bg": bg,
                                      "ratio": round(r, 2), "max": max_, "holds": holds})
        if not holds:
            failures.append(
                f"documented-premise-broken {item['id']}: {fg} on {bg} = {r:.2f} >= {max_}，"
                "前提已不成立，可简化 ink 方案并更新本文件"
            )
        lines.append(f"{'OK  ' if holds else 'FAIL'} premise  {item['id']:<24} {fg} on {bg} = {r:.2f} (< {max_})")

    summary["failures"] = failures
    summary["mappingCount"] = len(mapf.get("mappings") or [])
    return (1 if failures else 0), lines, summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="设计源 ↔ 实现 token 漂移检查")
    ap.add_argument("--map", default=str(DEFAULT_MAP))
    ap.add_argument("--design", default=str(DEFAULT_DESIGN))
    ap.add_argument("--op", default=str(DEFAULT_OP))
    ap.add_argument("--css", default=str(DEFAULT_CSS))
    ap.add_argument("--theme", default=str(DEFAULT_THEME))
    ap.add_argument("--report", action="store_true", help="打印三个源的全量解析结果")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    for label, path in (("映射表", args.map), ("设计源", args.design), ("设计源 .op", args.op),
                        ("globals.css", args.css)):
        # theme.ts 已随 MUI→ObsidianUI 迁移退役：不再必查，缺失时该源加载为空。
        if not Path(path).exists():
            print(f"找不到{label}: {path}", file=sys.stderr)
            return 2

    try:
        mapf = json.loads(Path(args.map).read_text(encoding="utf-8"))
        design = load_design_tokens(Path(args.design))
        op = load_op_tokens(Path(args.op))
        css = load_css_tokens(Path(args.css))
        theme_path = Path(args.theme)
        theme = (load_theme_tokens(theme_path, css) if theme_path.exists()
                 else {})  # theme.ts 退役后 token 真源收敛到 globals.css
        design_num, design_str = load_design_scalars(Path(args.design))
        op_num, op_str = load_op_scalars(Path(args.op))
        css_num, css_str = load_css_scalars(Path(args.css))
        scalars = {
            "designNum": design_num, "designStr": design_str,
            "opNum": op_num, "opStr": op_str,
            "cssNum": css_num, "cssStr": css_str,
        }
    except Exception as exc:
        print(f"解析失败: {exc}", file=sys.stderr)
        return 2

    errors = validate_map(mapf, design, op, css, theme, scalars)
    if errors:
        print("映射表不合法（退出码 2）:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 2

    if args.report:
        print(f"design tokens: {len(design)} · op variables: {len(op)} · "
              f"css vars: {len(css)} · theme paths: {len(theme)}")
        for entry in mapf["mappings"]:
            got = resolve(entry, design, op, css, theme)
            mark = "DRIFT" if len(set(got.values())) > 1 else "ok   "
            print(f"  {mark} {entry['id']:<26} " + " ".join(f"{k}={v}" for k, v in got.items()))
        return 0

    code, lines, summary = check(mapf, design, op, css, theme, scalars)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return code

    print(f"检查 {summary['mappingCount']} 个 token 映射"
          "（foundations.json ↔ .op ↔ globals.css ↔ theme.ts）")
    for entry in summary["drift"]:
        vals = " ".join(f"{k}={v}" for k, v in entry["values"].items())
        print(f"OK   known-drift {entry['id']:<26} {vals}")
    for line in lines:
        print(line)
    for f in summary["failures"]:
        print(f"FAIL {f}")
    if code == 0:
        print("\n三方 token 一致（或漂移均已登记），对比度达标")
    else:
        print(f"\n发现 {len(summary['failures'])} 项问题", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
