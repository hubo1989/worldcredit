#!/usr/bin/env python3
"""
P0-2 双轨自测：候选页样例帧的接入与隔离（真实设计源集成变异）。

对应 EXECUTION_PLAN.md P0-2 的验收（"升级检查前先加最小自测"）：
  1. 真实设计源里 candidate.mobile.dashboard 样例帧与 Current 同过契约
  2. 修改 Candidate 布局（节点改名）→ 只 Candidate 失败，Current 不误报
  3. Candidate 缺动作 → 只 Candidate 失败
  4. Candidate 帧整帧删除 → SKIP（非必需），Current 不受影响

运行:
    python3 design/openpencil/tests/test_p02_candidate_track.py

退出码: 0 全通过 / 1 有失败（unittest 约定）
"""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OP_PATH = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
CONTRACT_PATH = REPO / "design" / "openpencil" / "screens" / "_contract.json"
CHECKER_PATH = REPO / "design" / "openpencil" / "scripts" / "check-frame-contract.py"
CANDIDATE_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "13-candidates.js"
COMPONENT_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "02-components.js"
COMPARISON_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "90-comparisons.js"
BUILD_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "build-all.sh"
ATTACH_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "attach-candidate-preview.sh"

CANDIDATE_HEAD = "candidate.mobile.dashboard"
CURRENT_HEAD = "screen.mobile.dashboard"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_frame_contract", CHECKER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CHK = _load_checker()
DOC = json.loads(OP_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def run(doc):
    return CHK.check_doc(doc, copy.deepcopy(CONTRACT), None)


def entry_for(summary, head):
    return next(e for e in summary["screens"] if e["head"] == head)


def candidate_frame(doc):
    for page in doc["pages"]:
        for n in page.get("children") or []:
            if str(n.get("name") or "").startswith(CANDIDATE_HEAD):
                return n
    return None


def walk(node):
    yield node
    for c in node.get("children") or []:
        yield from walk(c)


class CandidateTrack(unittest.TestCase):
    def test_sample_passes_alongside_current(self):
        code, _, summary = run(copy.deepcopy(DOC))
        self.assertEqual(code, 0, summary["failures"])
        self.assertEqual(entry_for(summary, CANDIDATE_HEAD)["status"], "OK")
        self.assertEqual(entry_for(summary, CURRENT_HEAD)["status"], "OK")

    def test_candidate_rename_fails_only_candidate(self):
        doc = copy.deepcopy(DOC)
        frame = candidate_frame(doc)
        self.assertIsNotNone(frame)
        renamed = False
        for n in walk(frame):
            if n.get("name") == "hero / total pending":
                n["name"] = "hero block"
                renamed = True
        self.assertTrue(renamed)
        code, _, summary = run(doc)
        self.assertEqual(code, 1)
        cand = entry_for(summary, CANDIDATE_HEAD)
        self.assertEqual(cand["status"], "FAIL")
        self.assertIn("hero.pending", cand["missing"])
        self.assertEqual(entry_for(summary, CURRENT_HEAD)["status"], "OK")

    def test_candidate_missing_action_fails_only_candidate(self):
        doc = copy.deepcopy(DOC)
        frame = candidate_frame(doc)
        removed = False
        for n in walk(frame):
            kids = n.get("children") or []
            if any(k.get("name") == "btn / 全额结清" for k in kids):
                n["children"] = [k for k in kids if k.get("name") != "btn / 全额结清"]
                removed = True
                break
        self.assertTrue(removed)
        code, _, summary = run(doc)
        self.assertEqual(code, 1)
        cand = entry_for(summary, CANDIDATE_HEAD)
        self.assertEqual(cand["status"], "FAIL")
        self.assertIn("action.repay_single", cand["missing"])
        self.assertEqual(entry_for(summary, CURRENT_HEAD)["status"], "OK")

    def test_candidate_absence_is_skip(self):
        doc = copy.deepcopy(DOC)
        for page in doc["pages"]:
            page["children"] = [
                n for n in page.get("children") or []
                if not str(n.get("name") or "").startswith(CANDIDATE_HEAD)
            ]
        code, _, summary = run(doc)
        self.assertEqual(code, 0, summary["failures"])
        self.assertEqual(entry_for(summary, CANDIDATE_HEAD)["status"], "SKIP")
        self.assertEqual(entry_for(summary, CURRENT_HEAD)["status"], "OK")

    def test_candidate_keeps_privacy_control_and_44px_repayment_actions(self):
        source = CANDIDATE_SCRIPT.read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r"name: 'btn / toggle amount visibility', width: 44, height: 44",
        )
        self.assertIn("iconFontName: 'eye-off'", source)
        for action in ("一键全部还款", "全额结清"):
            with self.subTest(action=action):
                self.assertRegex(
                    source,
                    rf"name: 'btn / {action}', width: 'fit_content', height: 44",
                )

    def test_focus_button_uses_normal_control_with_visible_outer_ring(self):
        source = COMPONENT_SCRIPT.read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r"name: 'Button / ' \+ label \+ ' ring', width: 136, height: 48",
        )
        self.assertIn("secondary: '$color.runtime.secondary'", source)
        self.assertRegex(source, r"stroke: \{ thickness: 2, fill: s\(C\.secondary\) \}")
        self.assertRegex(
            source,
            r"name: 'Button / ' \+ label, width: 128, height: 40",
        )

    def test_candidate_preview_is_attached_after_comparison_page_rebuild(self):
        build = BUILD_SCRIPT.read_text(encoding="utf-8")
        attach = ATTACH_SCRIPT.read_text(encoding="utf-8")
        comparison = COMPARISON_SCRIPT.read_text(encoding="utf-8")
        comparison_build = build.index('build "90 · Comparisons"')
        attachment = build.index('bash "$S/attach-candidate-preview.sh"')
        self.assertLess(comparison_build, attachment)
        self.assertIn("candidate.mobile.dashboard · 390×844", attach)
        self.assertIn("slot / Candidate", attach)
        # attach 脚本已从跨页 op copy 演进为：读回完整子树 -> 剥离 editor id ->
        # op insert 序列化重建 -> 回读目标槽逐节点比对。断言插入与验证两个锚点。
        self.assertIn('op insert', attach)
        self.assertIn('expected exactly one inserted Candidate preview', attach)
        self.assertIn("comparison.preview · candidate.mobile.dashboard · 390×844", attach)
        self.assertIn("if (title !== 'Candidate')", comparison)


if __name__ == "__main__":
    unittest.main(verbosity=2)
