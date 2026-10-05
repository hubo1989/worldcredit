#!/usr/bin/env python3
"""
token 漂移门禁的自测。

覆盖：
  1. 三个源一致 -> 通过
  2. 未登记的漂移 -> 失败（new-drift）
  3. 已登记漂移的**值变了** -> 失败（drift-changed）——白名单不能掩盖回归
  4. 已登记但实测已对齐 -> 失败（stale-known-drift）——白名单不能腐化
  5. 对比度不足 -> 失败；对比度达标 -> 通过
  6. 文档化前提被推翻 -> 失败（提示可简化 ink 方案）
  7. 映射表结构问题（重复 id、designOnly 冗余/缺失、引用不存在的 token）-> 退出码 2
  8. 真实仓库三方一致（或漂移均已登记）
  9. CSS 只解析首个 :root（admin 暗色块不得污染亮色世界）

运行:
    python3 design/openpencil/tests/test_token_drift.py
    python3 -m pytest design/openpencil/tests/test_token_drift.py -q

退出码: 0 全通过 / 1 有失败（unittest 约定）
"""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CHECKER = REPO / "design" / "openpencil" / "scripts" / "check-token-drift.py"
MAP_PATH = REPO / "design" / "openpencil" / "screens" / "_token-map.json"
DESIGN_PATH = REPO / "design" / "openpencil" / "vars" / "foundations.json"
OP_PATH = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
CSS_PATH = REPO / "app" / "globals.css"
THEME_PATH = REPO / "lib" / "theme.ts"


def _load():
    spec = importlib.util.spec_from_file_location("check_token_drift", CHECKER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CHK = _load()


# ---------------------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------------------
MAPF = json.loads(MAP_PATH.read_text(encoding="utf-8"))
DESIGN = CHK.load_design_tokens(DESIGN_PATH)
OP = CHK.load_op_tokens(OP_PATH)
CSS = CHK.load_css_tokens(CSS_PATH)
THEME = CHK.load_theme_tokens(THEME_PATH)


def run(mapf: dict | None = None):
    return CHK.check(mapf if mapf is not None else copy.deepcopy(MAPF), DESIGN, OP, CSS, THEME)


def validate(mapf: dict):
    return CHK.validate_map(mapf, DESIGN, OP, CSS, THEME)


def with_injected_drift(design_mutation: dict | None = None) -> tuple[dict, dict, dict]:
    """造一个受控漂移：把 design 与 .op 一起改成另一个值，css 不动。

    真实仓库现在三源一致（knownDrift 为空），所以要验证「漂移检测」本身，
    必须人为制造漂移，否则用例会跟着真实数据一起失效。
    """
    design = dict(DESIGN)
    op = dict(OP)
    for token, value in (design_mutation or {"color.status.info": "#123456"}).items():
        design[token] = value
        op[token] = value
    mapf = copy.deepcopy(MAPF)
    mapf["knownDrift"] = []
    return mapf, design, op


def fails(summary: dict, prefix: str) -> list[str]:
    return [f for f in summary["failures"] if f.startswith(prefix)]


def minimal(css_color: str | None, theme_color: str | None) -> dict:
    """只保留一个映射的最小映射表，用于精确控制漂移。"""
    return {
        "reviewStatus": "proposed",
        "mappings": [{"id": "m", "design": "color.status.danger",
                      **({"css": "--danger"} if css_color else {}),
                      **({"theme": "light.error.main"} if theme_color else {})}],
        "designOnly": [t for t in DESIGN if t != "color.status.danger"],
        "knownDrift": [],
        "contrastChecks": [],
        "documentedFailures": [],
    }


# ---------------------------------------------------------------------------
# 1. 一致 / 2. 未登记漂移
# ---------------------------------------------------------------------------
class DriftDetection(unittest.TestCase):
    def test_two_sources_drift_is_detected(self):
        """design 与 css 取值不同即漂移；未登记就失败。"""
        mapf, design, op = with_injected_drift()
        mapf["mappings"] = [{"id": "m", "design": "color.status.info", "css": "--info"}]
        mapf["designOnly"] = [t for t in design if t != "color.status.info"]
        code, _, summary = CHK.check(mapf, design, op, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertIn("m", {d["id"] for d in summary["newDrift"]})

    def test_drift_without_registry_fails(self):
        """注入漂移但不登记 -> new-drift 失败。"""
        mapf, design, op = with_injected_drift({"color.status.danger": "#010203"})
        code, _, summary = CHK.check(mapf, design, op, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertIn("status.danger", {d["id"] for d in summary["newDrift"]})

    def test_case_insensitive_comparison(self):
        """大小写不同不算漂移：三个源都规范化为小写后比较。"""
        # foundations 里 navy800 原样是 #0A1F44（大写），css 是 #0A1F44
        self.assertEqual(DESIGN["color.brand.navy800"], "#0a1f44")
        self.assertEqual(CSS["--navy-800"], "#0a1f44")
        m = minimal(None, None)
        m["mappings"] = [{"id": "m", "design": "color.brand.navy800", "css": "--navy-800"}]
        m["designOnly"] = [t for t in DESIGN if t != "color.brand.navy800"]
        code, _, summary = run(m)
        self.assertEqual(code, 0, summary["failures"])
        self.assertEqual(summary["drift"], [])

    def test_fully_aligned_passes(self):
        m = minimal(None, None)
        m["mappings"] = [{"id": "m", "design": "color.status.info", "css": "--info"}]
        m["designOnly"] = [t for t in DESIGN if t != "color.status.info"]
        code, _, summary = run(m)
        self.assertEqual(code, 0, summary["failures"])

    def test_undeclared_drift_fails(self):
        """真实仓库三源一致：knownDrift 为空也不应报错（回归保护）。"""
        code, _, summary = run()
        self.assertEqual(code, 0, summary["failures"])
        self.assertEqual(summary["drift"], [])
        self.assertFalse(MAPF["knownDrift"], "三源已统一，knownDrift 应为空")

    def test_new_drift_fails(self):
        mapf, design, op = with_injected_drift({"color.status.success": "#abcdef"})
        code, _, summary = CHK.check(mapf, design, op, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertTrue(fails(summary, "new-drift"))
        ids = {d["id"] for d in summary["newDrift"]}
        self.assertIn("status.success", ids)


# ---------------------------------------------------------------------------
# 3. 漂移值变了 / 4. 白名单腐化
# ---------------------------------------------------------------------------
class WhitelistCannotHide(unittest.TestCase):
    def test_changed_drift_value_fails(self):
        """注入了漂移，但登记值与实测不符 -> drift-changed 失败。"""
        mapf, design, op = with_injected_drift({"color.status.info": "#123456"})
        mapf["knownDrift"] = [{
            "id": "status.info",
            "values": {"design": "#000000", "op": "#000000", "css": "#0277bd"},
            "reason": "伪造的过期登记值",
        }]
        code, _, summary = CHK.check(mapf, design, op, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertTrue(fails(summary, "drift-changed"))

    def test_stale_known_drift_fails(self):
        """登记了但三个源实际已一致 -> 白名单腐化，必须失败。"""
        m = minimal(None, None)
        m["mappings"] = [{"id": "m", "design": "color.status.info", "css": "--info"}]
        m["designOnly"] = [t for t in DESIGN if t != "color.status.info"]
        m["knownDrift"] = [{"id": "m", "values": {"x": "#000000"}, "reason": "过期登记"}]
        code, _, summary = run(m)
        self.assertEqual(code, 1)
        self.assertTrue(fails(summary, "stale-known-drift"))

    def test_resolved_drift_must_be_removed(self):
        """真实表里若某条漂移被修好却仍登记 -> 失败。"""
        m = copy.deepcopy(MAPF)
        # 模拟 status.info 也已漂移并登记，但它其实三方一致
        m["knownDrift"].append(
            {"id": "status.info", "values": {"design": "#000000"}, "reason": "伪造"}
        )
        code, _, summary = run(m)
        self.assertEqual(code, 1)
        self.assertIn("status.info", summary["staleDrift"])


# ---------------------------------------------------------------------------
# 5. 对比度
# ---------------------------------------------------------------------------
class ContrastGate(unittest.TestCase):
    def test_app_ink_contrast_passes(self):
        code, lines, summary = run()
        self.assertEqual(code, 0, summary["failures"])
        self.assertTrue(all(c["ok"] for c in summary["contrast"]))
        # 与 app 已有 color-contrast.test.ts 的结论一致
        danger = next(c for c in summary["contrast"] if c["id"].startswith("app.danger-ink"))
        self.assertGreaterEqual(danger["ratio"], 4.5)

    def test_insufficient_contrast_fails(self):
        m = copy.deepcopy(MAPF)
        m["contrastChecks"] = [{
            "id": "bad", "fg": {"css": "--success"}, "bg": {"css": "--success", "pct": 12},
            "min": 4.5,
        }]
        code, _, summary = run(m)
        self.assertEqual(code, 1)
        self.assertTrue(fails(summary, "contrast-fail"))

    def test_unresolvable_spec_fails(self):
        m = copy.deepcopy(MAPF)
        m["contrastChecks"] = [{
            "id": "missing", "fg": {"css": "--does-not-exist"},
            "bg": {"css": "--danger", "pct": 12}, "min": 4.5,
        }]
        code, _, summary = run(m)
        self.assertEqual(code, 1)
        self.assertTrue(fails(summary, "contrast-unresolved"))

    def test_literal_spec_supported(self):
        m = copy.deepcopy(MAPF)
        m["contrastChecks"] = [{
            "id": "lit", "fg": {"literal": "#000000"}, "bg": {"literal": "#ffffff"},
            "min": 21,
        }]
        code, _, summary = run(m)
        self.assertEqual(code, 0, summary["failures"])


# ---------------------------------------------------------------------------
# 6. 文档化前提
# ---------------------------------------------------------------------------
class DocumentedPremise(unittest.TestCase):
    def test_premise_holds_on_repo(self):
        _, _, summary = run()
        self.assertTrue(all(d["holds"] for d in summary["documented"]))

    def test_broken_premise_fails(self):
        """本色若已达标，前提失效，应失败并提示可简化 ink 方案。"""
        m = copy.deepcopy(MAPF)
        m["documentedFailures"] = [{
            "id": "f", "fg": {"css": "--danger"}, "bg": {"css": "--danger", "pct": 12},
            "max": 1.0,
        }]
        code, _, summary = run(m)
        self.assertEqual(code, 1)
        self.assertTrue(any("documented-premise-broken" in f for f in summary["failures"]))


# ---------------------------------------------------------------------------
# 7. 映射表结构（退出码 2 路径）
# ---------------------------------------------------------------------------
class MapStructure(unittest.TestCase):
    def test_duplicate_id_rejected(self):
        m = copy.deepcopy(MAPF)
        m["mappings"].append(copy.deepcopy(m["mappings"][0]))
        self.assertTrue(any("重复" in e for e in validate(m)))

    def test_unknown_design_token_rejected(self):
        m = copy.deepcopy(MAPF)
        m["mappings"][0]["design"] = "color.nope"
        self.assertTrue(any("不在 foundations.json" in e
                            for e in validate(m)))

    def test_unknown_css_var_rejected(self):
        m = copy.deepcopy(MAPF)
        m["mappings"][0]["css"] = "--nope"
        self.assertTrue(any("不在 globals.css" in e
                            for e in validate(m)))

    def test_unknown_theme_path_rejected(self):
        m = copy.deepcopy(MAPF)
        m["mappings"][0]["theme"] = "light.nope.main"
        self.assertTrue(any("不在 lib/theme.ts" in e
                            for e in validate(m)))

    def test_mapping_without_app_side_rejected(self):
        m = copy.deepcopy(MAPF)
        del m["mappings"][0]["css"]
        self.assertTrue(any("没有任何 app 侧来源" in e
                            for e in validate(m)))

    def test_uncovered_design_token_rejected(self):
        m = copy.deepcopy(MAPF)
        m["designOnly"] = [t for t in m["designOnly"] if t != "color.text.link"]
        self.assertTrue(any("既未映射也未登记" in e
                            for e in validate(m)))

    def test_redundant_designonly_rejected(self):
        m = copy.deepcopy(MAPF)
        m["designOnly"].append("color.status.danger")  # 已被 mappings 引用
        self.assertTrue(any("冗余登记" in e
                            for e in validate(m)))

    def test_known_drift_missing_fields_rejected(self):
        m = copy.deepcopy(MAPF)
        m["knownDrift"] = [{"id": "status.danger"}]
        self.assertTrue(any("必须含" in e for e in validate(m)))

    def test_known_drift_unknown_id_rejected(self):
        m = copy.deepcopy(MAPF)
        m["knownDrift"] = [{"id": "nope", "values": {"a": "#000000"}, "reason": "x"}]
        self.assertTrue(any("不存在的 mapping" in e
                            for e in validate(m)))

    def test_review_status_must_be_proposed(self):
        m = copy.deepcopy(MAPF)
        m["reviewStatus"] = "approved"
        self.assertTrue(any("reviewStatus" in e for e in validate(m)))

    def test_real_map_is_valid(self):
        self.assertEqual(validate(copy.deepcopy(MAPF)), [])


# ---------------------------------------------------------------------------
# 8/9. 解析器与真实仓库
# ---------------------------------------------------------------------------
class ParserAndRepo(unittest.TestCase):
    def test_op_source_drift_detected(self):
        """只改 foundations.json 而不同步 .op -> source-drift 失败。"""
        mutated_design = dict(DESIGN)
        mutated_design["color.status.danger"] = "#123456"
        code, _, summary = CHK.check(copy.deepcopy(MAPF), mutated_design, OP, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertTrue(any("source-drift color.status.danger" in f
                            for f in summary["failures"]), summary["failures"])

    def test_op_missing_token_detected(self):
        """设计源新增 token 但 .op 未同步 -> source-missing 失败。"""
        mutated_design = dict(DESIGN)
        mutated_design["color.status.brandNew"] = "#abcdef"
        code, _, summary = CHK.check(copy.deepcopy(MAPF), mutated_design, OP, CSS, THEME)
        self.assertEqual(code, 1)
        self.assertTrue(any("source-missing color.status.brandNew" in f
                            for f in summary["failures"]), summary["failures"])

    def test_design_and_op_are_in_sync_on_repo(self):
        """真实仓库：.op 的变量与 foundations.json 逐 token 相同。"""
        _, _, summary = run()
        self.assertEqual(summary["sourceOnly"], [])
        self.assertEqual(summary["sourceMissing"], [])

    def test_op_tokens_are_normalized(self):
        self.assertEqual(OP["color.status.danger"], "#d32f2f")
        self.assertEqual(OP["color.status.success"], "#2e7d32")

    def test_ink_mappings_resolve_across_sources(self):
        """新增的 ink 档在三个源里必须一致。"""
        by_id = {e["id"]: e for e in MAPF["mappings"]}
        for mid, design_tok, css_var in (
            ("status.dangerInk", "color.status.dangerInk", "--danger-ink"),
            ("status.successInk", "color.status.successInk", "--success-ink"),
            ("status.infoInk", "color.status.infoInk", "--info-ink"),
            ("status.warningInk", "color.status.warningInk", "--warning-ink"),
        ):
            self.assertIn(mid, by_id)
            entry = by_id[mid]
            self.assertEqual(entry["design"], design_tok)
            self.assertEqual(entry["css"], css_var)
            # design 与 .op 与 css 三方取值一致
            self.assertEqual(DESIGN[design_tok], CSS[css_var])
            self.assertEqual(OP[design_tok], CSS[css_var])

    def test_css_uses_first_root_only(self):
        """admin 暗色块覆盖同名变量，不得污染亮色世界。"""
        self.assertEqual(CSS["--danger"], "#d32f2f")
        # 暗色块里 --danger 是 #F87171；若被误读会不等于 #d32f2f
        self.assertNotEqual(CSS["--danger"], "#f87171")

    def test_theme_worlds_are_separate(self):
        self.assertIn("light.error.main", THEME)
        self.assertIn("admin.error.main", THEME)
        self.assertNotEqual(THEME["light.error.main"], THEME["admin.error.main"])

    def test_design_tokens_are_lowercased_hex(self):
        for name, value in DESIGN.items():
            self.assertRegex(value, r"^#[0-9a-f]{6}$", f"{name} 未规范化为小写 hex")

    def test_real_repo_passes(self):
        code, _, summary = run()
        self.assertEqual(code, 0, summary["failures"])

    def test_cli_exit_zero(self):
        self.assertEqual(CHK.main(["--map", str(MAP_PATH), "--design", str(DESIGN_PATH),
                                   "--op", str(OP_PATH),
                                   "--css", str(CSS_PATH), "--theme", str(THEME_PATH)]), 0)

    def test_json_summary_shape(self):
        code, _, summary = run()
        for key in ("drift", "newDrift", "staleDrift", "changedDrift",
                    "contrast", "documented", "failures", "mappingCount"):
            self.assertIn(key, summary)
        self.assertEqual(summary["mappingCount"], len(MAPF["mappings"]))

    def test_contrast_math_matches_wcag_reference(self):
        # WCAG 参考值：黑/白 = 21，同色 = 1
        self.assertAlmostEqual(CHK.contrast("#000000", "#ffffff"), 21.0, places=1)
        self.assertAlmostEqual(CHK.contrast("#123456", "#123456"), 1.0, places=5)
        # 与 app color-contrast.test.ts 的同一组断言一致
        self.assertAlmostEqual(CHK.contrast("#818cf8", "#ffffff"), 2.98, places=1)


_ABI = CHK.load_css_scalars(CSS_PATH)
SCALARS = {
    "designNum": CHK.load_design_scalars(DESIGN_PATH)[0],
    "designStr": CHK.load_design_scalars(DESIGN_PATH)[1],
    "opNum": CHK.load_op_scalars(OP_PATH)[0],
    "opStr": CHK.load_op_scalars(OP_PATH)[1],
    "cssNum": _ABI[0],
    "cssStr": _ABI[1],
}


class ScalarGate(unittest.TestCase):
    """决策 4：漂移检查从颜色扩展到间距 / 字号 / 字体族。"""

    def run_s(self, mapf=None):
        return CHK.check(
            mapf if mapf is not None else copy.deepcopy(MAPF),
            DESIGN, OP, CSS, THEME, SCALARS,
        )

    def validate_s(self, mapf):
        return CHK.validate_map(mapf, DESIGN, OP, CSS, THEME, SCALARS)

    def test_css_scalars_include_second_root(self):
        """排版 token 在第二个 :root 块，必须被解析到。"""
        self.assertEqual(SCALARS["cssNum"]["--type-title-size"], 22.0)
        self.assertEqual(SCALARS["cssNum"]["--type-section-size"], 19.0)
        self.assertEqual(SCALARS["cssNum"]["--type-body-size"], 14.5)
        self.assertIn("--font-sans", SCALARS["cssStr"])

    def test_numeric_alignment_passes_on_repo(self):
        code, _, summary = self.run_s()
        self.assertEqual(code, 0, summary["failures"])

    def test_scalar_source_drift_detected(self):
        """只改 foundations 数值不同步 .op -> source-drift[数值] 失败。"""
        design_num = dict(SCALARS["designNum"])
        design_num["space.5"] = 99.0
        scalars = dict(SCALARS, designNum=design_num)
        code, _, summary = CHK.check(copy.deepcopy(MAPF), DESIGN, OP, CSS, THEME, scalars)
        self.assertEqual(code, 1)
        self.assertTrue(any("source-drift[数值] space.5" in f for f in summary["failures"]))

    def test_scalar_mapping_drift_detected(self):
        """design/op 与 css 数值不一致 -> new-drift[数值] 失败。"""
        design_num = dict(SCALARS["designNum"])
        design_num["font.size.body"] = 13.5
        op_num = dict(SCALARS["opNum"])
        op_num["font.size.body"] = 13.5
        scalars = dict(SCALARS, designNum=design_num, opNum=op_num)
        code, _, summary = CHK.check(copy.deepcopy(MAPF), DESIGN, OP, CSS, THEME, scalars)
        self.assertEqual(code, 1)
        self.assertTrue(any("new-drift[数值] num.font.size.body" in f for f in summary["failures"]))

    def test_string_family_alignment_passes(self):
        """三源字体族去引号去空白后一致。"""
        norm = CHK._norm_str
        self.assertEqual(
            norm(SCALARS["designStr"]["font.family.body"]),
            norm(SCALARS["cssStr"]["--font-sans"]),
        )
        code, _, summary = self.run_s()
        self.assertEqual(code, 0, summary["failures"])

    def test_uncovered_numeric_token_rejected(self):
        m = copy.deepcopy(MAPF)
        m["numericDesignOnly"] = [t for t in m["numericDesignOnly"] if t != "space.4"]
        errors = self.validate_s(m)
        self.assertTrue(any("space.4" in e for e in errors), errors)

    def test_redundant_numeric_designonly_rejected(self):
        m = copy.deepcopy(MAPF)
        m["numericDesignOnly"].append("space.5")  # 已被 numericMappings 引用
        errors = self.validate_s(m)
        self.assertTrue(any("冗余登记" in e for e in errors), errors)

    def test_real_map_is_valid_with_scalars(self):
        self.assertEqual(self.validate_s(copy.deepcopy(MAPF)), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
