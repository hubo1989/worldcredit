"""Regression coverage for reviewed design-source fixes and the serialized .op source."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Iterator

REPO = Path(__file__).resolve().parents[3]
DESIGN = REPO / "design" / "openpencil"
OP_PATH = DESIGN / "worldcredit-redesign.op"
FOUNDATIONS_PATH = DESIGN / "vars" / "foundations.json"
TOKEN_MAP_PATH = DESIGN / "screens" / "_token-map.json"


def walk(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield node
    for child in node.get("children") or []:
        if isinstance(child, dict):
            yield from walk(child)


def page_by_name(doc: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [page for page in doc.get("pages", []) if page.get("name") == name]
    if len(matches) != 1:
        raise AssertionError(f"expected one page {name!r}, found {len(matches)}")
    return matches[0]


def all_nodes(page: dict[str, Any]) -> list[dict[str, Any]]:
    return [node for root in page.get("children", []) for node in walk(root)]


def one_node(nodes: list[dict[str, Any]], name: str) -> dict[str, Any]:
    matches = [node for node in nodes if node.get("name") == name]
    if len(matches) != 1:
        raise AssertionError(f"expected one node {name!r}, found {len(matches)}")
    return matches[0]


def color_value(node: dict[str, Any], field: str = "fill") -> str | None:
    value = node.get(field)
    if isinstance(value, list) and value:
        first = value[0]
        return first.get("color") if isinstance(first, dict) else None
    if isinstance(value, dict):
        fill = value.get("fill")
        if isinstance(fill, list) and fill:
            return fill[0].get("color")
    return None


class ReviewedSourcesSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = json.loads(OP_PATH.read_text(encoding="utf-8"))
        cls.foundations = json.loads(FOUNDATIONS_PATH.read_text(encoding="utf-8"))
        cls.token_map = json.loads(TOKEN_MAP_PATH.read_text(encoding="utf-8"))

    def test_detail_and_extended_bottom_navs_are_vertical_in_op(self) -> None:
        navs = []
        for page_name in ("11 · Mobile Details", "12 · Mobile Extended"):
            nodes = all_nodes(page_by_name(self.doc, page_name))
            page_navs = [node for node in nodes if node.get("name") == "bottom nav"]
            self.assertEqual(len(page_navs), 3, page_name)
            for nav in page_navs:
                self.assertEqual(nav.get("layout"), "vertical", nav.get("id"))
                children = nav.get("children") or []
                self.assertEqual([child.get("name") for child in children], ["nav tabs", "safe area"])
                self.assertEqual(children[0].get("height"), 56)
                self.assertEqual(children[1].get("height"), 34)
                navs.append(nav)
        self.assertEqual(len(navs), 6)

    def test_candidate_privacy_and_repayment_targets_are_serialized(self) -> None:
        """B0-2 起候选页含 390/430 两个变体：逐帧断言，而不是整页唯一。"""
        page = page_by_name(self.doc, "13 · Candidates")
        for head in (
            "candidate.mobile.dashboard · 390×844",
            "candidate.mobile.dashboard · 430×932",
        ):
            frame = one_node(page.get("children", []), head)
            nodes = all_nodes(frame)
            privacy = one_node(nodes, "btn / toggle amount visibility")
            self.assertEqual((privacy.get("width"), privacy.get("height")), (44, 44), head)
            eye = one_node(nodes, "hide visible amounts")
            self.assertEqual(eye.get("iconFontName"), "eye-off", head)
            for name in ("btn / 一键全部还款", "btn / 全额结清"):
                button = one_node(nodes, name)
                self.assertEqual(button.get("height"), 44, f"{head} / {name}")

    def test_comparison_candidate_slot_contains_one_serialized_preview(self) -> None:
        nodes = all_nodes(page_by_name(self.doc, "90 · Comparisons"))
        slot = one_node(nodes, "slot / Candidate")
        self.assertEqual(slot.get("height"), 844)
        previews = [
            child for child in slot.get("children") or []
            if str(child.get("name", "")).startswith("comparison.preview · candidate.mobile.dashboard")
        ]
        self.assertEqual(len(previews), 1)
        self.assertEqual((previews[0].get("width"), previews[0].get("height")), (390, 844))
        self.assertIn("概览", [node.get("content") for node in walk(previews[0])])

    def test_new_neutral_background_token_is_present_in_all_design_sources(self) -> None:
        token = "color.bg.neutral"
        self.assertIn(token, self.foundations)
        serialized = self.doc.get("variables", {}).get(token)
        self.assertIsNotNone(serialized, "neutral background token must be upserted into the .op source")
        self.assertEqual(serialized.get("value"), self.foundations[token].get("value"))
        mapped = any(item.get("design") == token for item in self.token_map.get("mappings", []))
        design_only = token in self.token_map.get("designOnly", [])
        self.assertTrue(mapped or design_only, "token must be represented in _token-map.json")

    def test_neutral_fallbacks_and_mobile_header_constant_are_used(self) -> None:
        script_paths = (
            DESIGN / "scripts" / "10-mobile-core.js",
            DESIGN / "scripts" / "11-mobile-details.js",
        )
        for path in script_paths:
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("#E5E7EB", source, str(path))
            self.assertIn("color.bg.neutral", source, str(path))
        core = script_paths[0].read_text(encoding="utf-8")
        self.assertRegex(core, r"\bHEADER_H\s*=\s*64\b")
        self.assertNotRegex(core, r"height\s*:\s*64\b")
        self.assertNotIn("SB_H + 64", core)
        self.assertNotIn("- 64 - NAV_H", core)

    def test_component_master_serializes_reviewed_disabled_and_focus_tokens(self) -> None:
        nodes = all_nodes(page_by_name(self.doc, "01 · Components"))
        focus_ring = one_node(nodes, "Button / 聚焦 focus ring")
        focus_button = one_node(nodes, "Button / 聚焦 focus")
        self.assertEqual((focus_ring.get("width"), focus_ring.get("height")), (136, 48))
        self.assertEqual(color_value(focus_ring, "stroke"), "$color.runtime.secondary")
        self.assertEqual((focus_button.get("width"), focus_button.get("height")), (128, 40))
        disabled_value = next(
            node for node in nodes
            if node.get("type") == "text" and node.get("content") == "不可编辑"
        )
        disabled_input = next(
            parent for parent in nodes
            if parent.get("name") == "input"
            and any(child.get("id") == disabled_value.get("id") for child in parent.get("children") or [])
        )
        self.assertEqual(color_value(disabled_value), "$color.text.disabled")
        self.assertEqual(color_value(disabled_input), "$color.bg.subtle")
        disabled_button = one_node(nodes, "Button / 禁用")
        disabled_label = next(
            child for child in walk(disabled_button)
            if child.get("type") == "text" and child.get("content") == "禁用"
        )
        self.assertEqual(color_value(disabled_label), "$color.text.disabled")

    def test_theme_registry_uses_the_shared_text_variable(self) -> None:
        """MUI→ObsidianUI 迁移（2026-10-09）后：ThemeRegistry 退化为字体注册 + 透传，
        主题职责由 globals.css 的 d-* token 接管，组件内不得再有硬编码色值。"""
        source = (REPO / "components" / "ThemeRegistry.tsx").read_text(encoding="utf-8")
        self.assertNotIn("createTheme", source)
        self.assertNotIn("#0A1F44", source)
        css = (REPO / "app" / "globals.css").read_text(encoding="utf-8")
        self.assertIn("--color-d-text:", css)  # 暗色正文 token 存在
        self.assertIn("--text-primary", css)   # 亮色旧 token 仍被设计基线引用
        self.assertIn("color.bg.neutral", " ".join(
            path.read_text(encoding="utf-8")
            for path in (
                DESIGN / "scripts" / "10-mobile-core.js",
                DESIGN / "scripts" / "11-mobile-details.js",
                DESIGN / "scripts" / "13-candidates.js",
            )
        ))

    def test_component_script_has_explicit_unknown_state_error_and_disabled_color(self) -> None:
        source = (DESIGN / "scripts" / "02-components.js").read_text(encoding="utf-8")
        self.assertIn("color.text.disabled", source)
        self.assertRegex(source, r"throw new (TypeError|Error)\(")
        self.assertIn("C.secondary", source)


if __name__ == "__main__":
    unittest.main()
