#!/usr/bin/env python3
"""
B5 权益台账与机会管理设计源契约（WC-BEN-12）。

覆盖：
  1. registry 登记了新屏（benefits-calendar / benefits-tasks）与扩展状态
  2. 契约里每个 B5 候选屏的 candidate frame 真实存在且字段/动作齐全
     （复用 check-frame-contract.py 的判定，不重复实现匹配器）
  3. 状态帧已按既有模式入 uncovered，且文档中无重复
  4. 语义红线：候选帧文本不得出现误导性文案
     （一键享用 / 已关注 / 我已持卡可享 / 已报名 / 立即到账 / 领取成功）
  5. 动作命名红线：领取类动作必须是「记录已领取」而非「领取」成功语

运行:
    python3 -m unittest discover -s design/openpencil/tests -p 'test_opportunities_contract.py'
"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OP_PATH = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
CONTRACT_PATH = REPO / "design" / "openpencil" / "screens" / "_contract.json"
REGISTRY_PATH = REPO / "design" / "openpencil" / "screens" / "_registry.json"
CHECKER_PATH = REPO / "design" / "openpencil" / "scripts" / "check-frame-contract.py"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_frame_contract", CHECKER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CHK = _load_checker()

B5_SCREEN_KEYS = [
    "screen.opportunities.ledger",
    "screen.opportunities.list",
    "screen.opportunities.calendar",
    "screen.opportunities.tasks",
    "screen.opportunities.sheet.shared-account",
    "screen.opportunities.sheet.usage-correction",
]

B5_STATE_HEADS = [
    "candidate.opportunities.state.loading",
    "candidate.opportunities.state.empty",
    "candidate.opportunities.state.error",
    "candidate.opportunities.state.needs-confirmation",
    "candidate.opportunities.state.usage-history",
    "candidate.opportunities.state.conflict",
    "candidate.opportunities.state.claim",
    "candidate.opportunities.state.booking",
    "candidate.opportunities.state.pending-settlement",
]

# 语义红线（DESIGN.md §10）：普通领取≠新增额度、预约≠已使用、关注≠已报名、
# 手动达标≠银行确认。以下文案曾在 P0 修复前误导用户，禁止再出现在候选帧。
FORBIDDEN_TEXTS = [
    "一键享用",
    "已为您记录关注",
    "我已持卡可享",
    "已报名",
    "立即到账",
    "领取成功",
]


def real_doc() -> dict:
    return json.loads(OP_PATH.read_text(encoding="utf-8"))


def iter_frames(doc):
    for page in doc.get("pages", []):
        for node in CHK.iter_nodes(page):
            if node.get("type") == "frame":
                yield node


def frame_by_head(doc, head: str):
    matches = []
    for f in iter_frames(doc):
        parsed = CHK.parse_frame_name(str(f.get("name") or ""))
        if parsed and parsed[0] == head:
            matches.append(f)
    return matches


class RegistryContract(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

    def by_key(self, key):
        for s in self.registry["screens"]:
            if s["key"] == key:
                return s
        return None

    def test_new_screens_registered(self):
        for key, route in [
            ("screen.mobile.benefits-calendar", "/benefits/calendar"),
            ("screen.mobile.benefits-tasks", "/benefits/tasks"),
        ]:
            entry = self.by_key(key)
            self.assertIsNotNone(entry, f"{key} 未登记到 _registry.json")
            self.assertEqual(entry["route"], route)

    def test_existing_screens_gained_states(self):
        benefits = self.by_key("screen.mobile.benefits")
        for state in ["needs-confirmation", "usage-history", "correction", "conflict"]:
            self.assertIn(state, benefits["states"], "benefits 缺少状态 " + state)
        promos = self.by_key("screen.mobile.promos")
        self.assertIn("needs-confirmation", promos["states"])
        card_detail = self.by_key("screen.mobile.card-detail")
        self.assertIn("opportunities", card_detail["states"])
        # P2 履约状态挂在任务屏
        tasks = self.by_key("screen.mobile.benefits-tasks")
        for state in ["claim", "booking", "pending-settlement"]:
            self.assertIn(state, tasks["states"])


class CandidateFrames(unittest.TestCase):
    def setUp(self):
        self.doc = real_doc()

    def test_all_b5_candidate_frames_present_exactly_once(self):
        for key in B5_SCREEN_KEYS:
            head = "candidate." + key[len("screen."):]
            frames = frame_by_head(self.doc, head)
            self.assertGreaterEqual(len(frames), 1, f"{head} 缺失")
            # 同一 head 允许不同尺寸变体（ledger 390/430），但同尺寸不得重复
            sizes = [CHK.parse_frame_name(str(f.get("name")))[2] for f in frames]
            self.assertEqual(
                len(sizes), len(set(sizes)), f"{head} 存在同尺寸重复: {sizes}"
            )

    def test_state_frames_declared_uncovered_and_present(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        uncovered = {e["key"] for e in contract.get("uncovered") or []}
        for head in B5_STATE_HEADS:
            self.assertIn(head, uncovered, f"{head} 未入 uncovered")
            frames = frame_by_head(self.doc, head)
            self.assertEqual(len(frames), 1, f"{head} 应恰好出现 1 次")

    def test_full_checker_passes(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        code, _lines, summary = CHK.check_doc(self.doc, contract, registry)
        self.assertEqual(code, 0, "check-frame-contract 失败: " + "; ".join(summary["failures"][:5]))
        # B5 候选屏全部 OK
        b5_ok = {
            e["key"]
            for e in summary["screens"]
            if e["key"] in B5_SCREEN_KEYS and e["role"] == "candidate" and e["status"] == "OK"
        }
        self.assertEqual(set(B5_SCREEN_KEYS), b5_ok)


class SemanticRedLines(unittest.TestCase):
    """语义红线：候选帧文案不得暗示未发生的业务事实。"""

    def setUp(self):
        self.doc = real_doc()

    def b5_frame_texts(self):
        texts = []
        for f in iter_frames(self.doc):
            name = str(f.get("name") or "")
            parsed = CHK.parse_frame_name(name)
            if not parsed or not parsed[0].startswith("candidate.opportunities"):
                continue
            texts.append(CHK.node_texts(f))
        return texts

    def test_forbidden_texts_absent(self):
        joined = "\n".join(self.b5_frame_texts())
        for bad in FORBIDDEN_TEXTS:
            self.assertNotIn(bad, joined, f"候选帧出现误导文案: {bad}")

    def test_claim_action_is_recording_not_granting(self):
        # 领取动作必须是「记录已领取」；文案里出现裸「领取」仅允许在
        # 「记录已领取」「领取截止」「领取窗口」「未记录领取」上下文。
        joined = "\n".join(self.b5_frame_texts())
        self.assertIn("记录已领取", joined)
        for line in joined.splitlines():
            if "领取" in line and not any(
                ctx in line for ctx in ("记录已领取", "领取截止", "领取窗口", "未记录领取", "已领取的")
            ):
                self.fail(f"领取相关文案缺少事实限定: {line!r}")

    def test_booking_copy_states_it_is_a_record(self):
        joined = "\n".join(self.b5_frame_texts())
        self.assertIn("已在银行或服务商完成预约后记录", joined)

    def test_unknown_balance_not_rendered_as_zero(self):
        joined = "\n".join(self.b5_frame_texts())
        self.assertIn("余额待核对", joined)
        self.assertNotIn("0 次已用", joined)

    def test_unlimited_quota_not_zero(self):
        joined = "\n".join(self.b5_frame_texts())
        self.assertIn("次数不限", joined)

    def test_manual_task_marked_manual(self):
        joined = "\n".join(self.b5_frame_texts())
        self.assertIn("手动确认", joined)
        self.assertIn("手动达标", joined)
        # 发放窗口是预计，不承诺到账
        self.assertIn("预计", joined)


if __name__ == "__main__":
    unittest.main()
