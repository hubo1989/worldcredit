#!/usr/bin/env python3
"""
P0-1 最小自测：Current / Candidate / Approved 命名与字段·动作契约。

覆盖（对应 `screens/NAMING.md` 与 EXECUTION_PLAN.md P0-1 的验收要求）：
  1. Current 缺字段必失败，且残留同名字串不能放行
  2. Candidate 结构重排 + 同义文案仍通过
  3. Candidate 缺字段、缺动作必失败
  4. 两种 frame 不互相借字段（current 不能借 candidate，反之亦然）
  5. frame 按 head 精确匹配：相似名（`...dashboard-extra` / shell 外壳）不算覆盖
  6. action 必须有结构锚点；textNode 必须整节点相等
  7. 契约卫生：禁止个人数据与具体金额；重复身份、未声明 frame 必失败
  8. 真实设计源 + 真实契约通过（集成）

运行:
    python3 design/openpencil/tests/test_frame_contract.py
    python3 -m pytest design/openpencil/tests/test_frame_contract.py -q

退出码: 0 全通过 / 1 有失败（unittest 约定）
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
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


# ---------------------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------------------
def real_doc() -> dict:
    return json.loads(OP_PATH.read_text(encoding="utf-8"))


def real_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def iter_frames(doc):
    for page in doc.get("pages", []):
        for node in CHK.iter_nodes(page):
            if node.get("type") == "frame":
                yield node


def frame_by_head(doc, head: str):
    """按 head 精确取（第一个）frame 的**深拷贝**。"""
    for f in iter_frames(doc):
        parsed = CHK.parse_frame_name(str(f.get("name") or ""))
        if parsed and parsed[0] == head:
            return copy.deepcopy(f)
    raise AssertionError(f"测试夹具缺少 frame: {head}")


def doc_of(*frames: dict, extra_page_frames: dict | None = None) -> dict:
    page = {"type": "page", "name": "test page", "children": [copy.deepcopy(f) for f in frames]}
    if extra_page_frames:
        page["children"].extend(copy.deepcopy(v) for v in extra_page_frames.values())
    return {"version": 1, "pages": [page]}


def contract_for(keys, **defaults_overrides) -> dict:
    contract = real_contract()
    wanted = set(keys)
    contract["screens"] = [s for s in contract["screens"] if s["key"] in wanted]
    assert len(contract["screens"]) == len(wanted), "测试请求了不存在的契约 key"
    contract["uncovered"] = []
    contract["defaults"].update(defaults_overrides)
    return contract


def remove_node(frame: dict, name: str) -> None:
    """删除第一个 name 精确匹配的节点；找不到就断言失败。"""
    removed = _remove_node(frame, name)
    assert removed, f"测试夹具里没有节点: {name}"


def remove_all_nodes(frame: dict, name: str) -> int:
    """删除**全部** name 精确匹配的节点（列表行这类重复节点必须删干净）。"""
    removed = 0
    while _remove_node(frame, name):
        removed += 1
    assert removed, f"测试夹具里没有节点: {name}"
    return removed


def _remove_node(node, name: str) -> bool:
    if isinstance(node, dict):
        children = node.get("children") or []
        for i, child in enumerate(children):
            if isinstance(child, dict) and CHK.norm(child.get("name") or "") == CHK.norm(name):
                del children[i]
                return True
            if _remove_node(child, name):
                return True
    elif isinstance(node, list):
        for i, child in enumerate(list(node)):
            if isinstance(child, dict) and CHK.norm(child.get("name") or "") == CHK.norm(name):
                del node[i]
                return True
            if _remove_node(child, name):
                return True
    return False


def rename_head(frame: dict, new_head: str) -> None:
    parts = str(frame["name"]).split(CHK.SEP)
    parts[0] = new_head
    frame["name"] = CHK.SEP.join(parts)


def replace_text(frame: dict, old: str, new: str) -> None:
    for n in CHK.iter_nodes(frame):
        if n.get("type") == "text" and CHK.norm(n.get("content") or "") == CHK.norm(old):
            n["content"] = new
            return
    raise AssertionError(f"测试夹具里没有文本: {old}")


def reorder_children(frame: dict) -> None:
    """把子树里每个 children 列表倒序，模拟「结构重排」。"""
    for n in CHK.iter_nodes(frame):
        kids = n.get("children")
        if isinstance(kids, list):
            kids.reverse()


def missing_ids(summary: dict) -> set[str]:
    out: set[str] = set()
    for entry in summary["screens"]:
        out.update(entry.get("missing") or [])
    return out


def failure_text(summary: dict) -> str:
    return "\n".join(summary["failures"])


# ---------------------------------------------------------------------------
# 1. Current 缺字段必失败
# ---------------------------------------------------------------------------
class CurrentMissingField(unittest.TestCase):
    def setUp(self):
        self.contract = contract_for(["screen.mobile.dashboard"])

    def test_baseline_current_passes(self):
        doc = doc_of(frame_by_head(real_doc(), "screen.mobile.dashboard"))
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 0, failure_text(summary))

    def test_missing_field_fails(self):
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        remove_node(frame, "metric / 未出账单")
        doc = doc_of(frame)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("metric.unbilled", missing_ids(summary))

    def test_residual_copy_cannot_rescue_missing_node(self):
        """删掉结构节点但把同名字符串留在别处 —— 仍必须失败。"""
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        remove_node(frame, "metric / 未出账单")
        frame["children"].append({"type": "text", "name": "leftover", "content": "未出账单"})
        doc = doc_of(frame)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1, "残留文案不应让缺失字段通过")
        self.assertIn("metric.unbilled", missing_ids(summary))


# ---------------------------------------------------------------------------
# 2. Candidate：结构重排通过
# ---------------------------------------------------------------------------
class CandidateReorder(unittest.TestCase):
    def setUp(self):
        self.contract = contract_for(
            ["screen.mobile.dashboard"], applyTo=["current", "candidate"]
        )
        self.current = frame_by_head(real_doc(), "screen.mobile.dashboard")

    def _candidate(self) -> dict:
        cand = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(cand, "candidate.mobile.dashboard")
        return cand

    def test_reorder_and_synonym_copy_passes(self):
        cand = self._candidate()
        reorder_children(cand)
        replace_text(cand, "总待还款", "待还总额")  # 契约允许的同义词
        replace_text(cand, "全额结清", "全额还款")
        doc = doc_of(self.current, cand)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 0, failure_text(summary))

    def test_candidate_alone_without_current_skips(self):
        """current 未出现即 missing-frame（它是必需角色），证明角色不共享。"""
        doc = doc_of(self._candidate())
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("missing-frame", failure_text(summary))


# ---------------------------------------------------------------------------
# 3. Candidate 缺字段 / 缺动作必失败
# ---------------------------------------------------------------------------
class CandidateMissing(unittest.TestCase):
    def setUp(self):
        self.contract = contract_for(
            ["screen.mobile.dashboard"], applyTo=["current", "candidate"]
        )
        self.current = frame_by_head(real_doc(), "screen.mobile.dashboard")

    def _candidate(self) -> dict:
        cand = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(cand, "candidate.mobile.dashboard")
        return cand

    def test_candidate_missing_field_fails(self):
        cand = self._candidate()
        remove_node(cand, "overdue header")
        doc = doc_of(self.current, cand)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("overdue.section", missing_ids(summary))

    def test_candidate_missing_action_fails(self):
        cand = self._candidate()
        remove_node(cand, "btn / 一键全部还款")
        doc = doc_of(self.current, cand)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("action.repay_all", missing_ids(summary))

    def test_candidate_action_label_only_cannot_pass(self):
        """动作锚点是结构节点；删节点后仅剩文字不算动作存在。"""
        cand = self._candidate()
        remove_node(cand, "btn / 一键全部还款")
        cand["children"].append(
            {"type": "text", "name": "ghost", "content": "一键全部还款"}
        )
        doc = doc_of(self.current, cand)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("action.repay_all", missing_ids(summary))

    def test_textnode_requires_exact_node_text(self):
        """textNode 必须整节点相等：改成「包含原文案」的长文案应失败。"""
        cand = self._candidate()
        replace_text(cand, "查看全部", "查看全部逾期账单")
        doc = doc_of(self.current, cand)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1, "子串命中不得作为动作的唯一判据")
        self.assertIn("action.view_all_overdue", missing_ids(summary))


# ---------------------------------------------------------------------------
# 4. 两种 frame 不互相借字段
# ---------------------------------------------------------------------------
class NoFieldBorrowing(unittest.TestCase):
    def test_candidate_cannot_borrow_from_current(self):
        contract = contract_for(
            ["screen.mobile.dashboard"], applyTo=["current", "candidate"]
        )
        current = frame_by_head(real_doc(), "screen.mobile.dashboard")
        cand = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(cand, "candidate.mobile.dashboard")
        remove_node(cand, "tab / 我的")  # 只从 candidate 删
        doc = doc_of(current, cand)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1, "candidate 缺节点不能靠 current 补齐")
        self.assertIn("bottom_nav", missing_ids(summary))

    def test_current_cannot_borrow_from_candidate(self):
        contract = contract_for(
            ["screen.mobile.bills"], applyTo=["current", "candidate"]
        )
        current = frame_by_head(real_doc(), "screen.mobile.bills")
        cand = frame_by_head(real_doc(), "screen.mobile.bills")
        rename_head(cand, "candidate.mobile.bills")
        # 只从 current 删；每个账单卡都有一份 history toggle，必须全删
        removed = remove_all_nodes(current, "history toggle")
        self.assertGreater(removed, 1, "夹具应有多个 history toggle")
        doc = doc_of(current, cand)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1, "current 缺节点不能靠 candidate 补齐")
        self.assertIn("bill.history", missing_ids(summary))

    def test_same_page_sibling_master_cannot_lend(self):
        """dashboard 字段只在自己的子树里收集，不借同页 bills 的节点。"""
        contract = contract_for(
            ["screen.mobile.dashboard", "screen.mobile.bills"]
        )
        dash = frame_by_head(real_doc(), "screen.mobile.dashboard")
        remove_node(dash, "overdue header")
        bills = frame_by_head(real_doc(), "screen.mobile.bills")
        doc = doc_of(dash, bills)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1)
        self.assertIn("overdue.section", missing_ids(summary))

    def test_variants_of_same_head_share_contract(self):
        """同一 head 的多尺寸变体都按同一契约判定，任一缺字段即失败。"""
        contract = contract_for(["screen.mobile.dashboard"])
        small = frame_by_head(real_doc(), "screen.mobile.dashboard")
        # 选 430 宽那份做「缺字段」变体
        big = None
        for f in iter_frames(real_doc()):
            parsed = CHK.parse_frame_name(str(f.get("name") or ""))
            if parsed and parsed[0] == "screen.mobile.dashboard" and parsed[2][0] == 430:
                big = copy.deepcopy(f)
        self.assertIsNotNone(big, "夹具缺少 430 变体")
        remove_node(big, "metric / 总欠款")
        doc = doc_of(small, big)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1)
        self.assertIn("metric.total_debt", missing_ids(summary))


# ---------------------------------------------------------------------------
# 5. frame 名精确匹配
# ---------------------------------------------------------------------------
class FrameNameExactness(unittest.TestCase):
    def setUp(self):
        self.contract = contract_for(["screen.mobile.dashboard"])

    def test_similar_name_is_not_coverage(self):
        """`screen.mobile.dashboard2` 是另一个 head，不覆盖 `screen.mobile.dashboard`。"""
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(frame, "screen.mobile.dashboard2")
        doc = doc_of(frame)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("missing-frame", failure_text(summary))
        self.assertIn("undeclared-frame", failure_text(summary))

    def test_candidate_extra_suffix_is_not_coverage(self):
        """`candidate.mobile.dashboard-extra` 不能替代 `candidate.mobile.dashboard`。"""
        contract = contract_for(
            ["screen.mobile.dashboard"], applyTo=["current", "candidate"],
            requiredRoles=["current", "candidate"],
        )
        current = frame_by_head(real_doc(), "screen.mobile.dashboard")
        extra = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(extra, "candidate.mobile.dashboard-extra")
        doc = doc_of(current, extra)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1)
        text = failure_text(summary)
        self.assertIn("missing-frame candidate.mobile.dashboard", text)
        self.assertIn("undeclared-frame candidate.mobile.dashboard-extra", text)

    def test_comparison_shell_frame_is_ignored(self):
        """`90 · Comparisons · screen.mobile.dashboard` 外壳不是屏帧，也不提供覆盖。"""
        shell = {
            "type": "frame",
            "name": "90 · Comparisons · screen.mobile.dashboard",
            "width": 1440,
            "children": [
                {"type": "text", "name": "t", "content": "总待还款"},
                {"type": "text", "name": "u", "content": "逾期明细"},
            ],
        }
        doc = doc_of(shell)
        code, lines, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("missing-frame", failure_text(summary))
        self.assertNotIn("undeclared-frame", failure_text(summary))

    def test_duplicate_identity_fails(self):
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        doc = doc_of(frame, frame)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        self.assertEqual(code, 1)
        self.assertIn("duplicate-frame", failure_text(summary))

    def test_undeclared_role_prefix_frame_fails(self):
        """applyTo 之外的角色（approved）出现即未声明，避免第三个角色静默上线。"""
        contract = contract_for(
            ["screen.mobile.dashboard"], applyTo=["current", "candidate"]
        )
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(frame, "approved.mobile.dashboard")
        doc = doc_of(frame)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 1)
        text = failure_text(summary)
        self.assertIn("undeclared-frame approved.mobile.dashboard", text)
        self.assertIn("missing-frame screen.mobile.dashboard", text)

    def test_role_in_apply_to_is_declared(self):
        """默认 applyTo 含三个角色：approved.* 帧算已声明，只是按契约判定。"""
        frame = frame_by_head(real_doc(), "screen.mobile.dashboard")
        rename_head(frame, "approved.mobile.dashboard")
        doc = doc_of(frame)
        code, _, summary = CHK.check_doc(doc, self.contract, None)
        text = failure_text(summary)
        self.assertNotIn("undeclared-frame", text)
        self.assertIn("missing-frame screen.mobile.dashboard", text)

    def test_uncovered_declaration_suppresses_undeclared(self):
        contract = contract_for(["screen.mobile.dashboard"])
        contract["uncovered"] = [{"key": "screen.mobile.bills", "reason": "测试"}]
        dash = frame_by_head(real_doc(), "screen.mobile.dashboard")
        bills = frame_by_head(real_doc(), "screen.mobile.bills")
        doc = doc_of(dash, bills)
        code, _, summary = CHK.check_doc(doc, contract, None)
        self.assertEqual(code, 0, failure_text(summary))
        self.assertEqual(summary["staleUncovered"], [])


# ---------------------------------------------------------------------------
# 6. 契约卫生与结构合法性（退出码 2）
# ---------------------------------------------------------------------------
class ContractHygiene(unittest.TestCase):
    def _with_marker(self, screen_key: str, req_id: str, **marker) -> dict:
        contract = real_contract()
        for screen in contract["screens"]:
            if screen["key"] != screen_key:
                continue
            for group in ("fields", "actions"):
                for req in screen[group]:
                    if req["id"] == req_id:
                        req["markers"] = [marker]
                        req.pop("allMarkers", None)
                        return contract
        raise AssertionError(f"契约里没有 {screen_key}:{req_id}")

    def test_email_is_rejected(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", label=["hubo1989@gmail.com"]
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("邮箱" in e for e in errors), errors)

    def test_card_tail_is_rejected(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", label=["尾号 9004"]
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(errors)

    def test_digit_run_is_rejected(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", label=["历史账单 2026"]
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("连续数字" in e for e in errors), errors)

    def test_concrete_amount_is_rejected(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", label=["待还金额 ¥8,000"]
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("具体金额" in e for e in errors), errors)

    def test_pattern_may_express_amount_without_literal(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", pattern="[¥￥]\\d"
        )
        errors = CHK.validate_contract(contract)
        self.assertEqual(errors, [], errors)

    def test_action_without_structural_anchor_is_rejected(self):
        contract = self._with_marker(
            "screen.mobile.bills", "action.repay_all", label=["一键还清"]
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("结构锚点" in e for e in errors), errors)

    def test_review_status_must_stay_proposed(self):
        contract = real_contract()
        contract["reviewStatus"] = "approved"
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("reviewStatus" in e for e in errors), errors)

    def test_real_contract_is_valid(self):
        self.assertEqual(CHK.validate_contract(real_contract()), [])

    def test_label_must_be_array(self):
        contract = self._with_marker(
            "screen.mobile.bills", "header.title", label="卡片与账单"
        )
        errors = CHK.validate_contract(contract)
        self.assertTrue(any("必须是数组" in e for e in errors), errors)

    def test_registry_mismatch_is_reported(self):
        contract = contract_for(["screen.mobile.dashboard"])
        contract["screens"][0]["registryKey"] = "screen.mobile.not-a-route"
        dash = frame_by_head(real_doc(), "screen.mobile.dashboard")
        doc = doc_of(dash)
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        code, _, summary = CHK.check_doc(doc, contract, registry)
        self.assertEqual(code, 1)
        self.assertIn("registry-mismatch", failure_text(summary))


# ---------------------------------------------------------------------------
# 7. 真实设计源集成
# ---------------------------------------------------------------------------
class RealSourceIntegration(unittest.TestCase):
    def test_real_op_and_contract_pass(self):
        code, lines, summary = CHK.check_doc(real_doc(), real_contract(), None)
        self.assertEqual(code, 0, failure_text(summary))
        self.assertGreater(summary["frameCount"], 0)
        ok_entries = [e for e in summary["screens"] if e["status"] == "OK"]
        self.assertEqual(len(ok_entries), 2, lines)

    def test_candidate_not_required_by_default(self):
        """Candidate 尚未开画时，契约不得因为缺 candidate 而失败。"""
        code, _, summary = CHK.check_doc(real_doc(), real_contract(), None)
        self.assertEqual(code, 0)
        skipped = [e for e in summary["screens"] if e["status"] == "SKIP"]
        self.assertEqual(len(skipped), 4, summary["screens"])

    def test_main_cli_exit_zero_on_repo(self):
        self.assertEqual(
            CHK.main(["--op", str(OP_PATH), "--contract", str(CONTRACT_PATH),
                      "--registry", str(REGISTRY_PATH)]),
            0,
        )

    def test_contract_covers_exactly_the_declared_registry_keys(self):
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        registry_keys = {s["key"] for s in registry["screens"]}
        for screen in real_contract()["screens"]:
            self.assertIn(screen["registryKey"], registry_keys)


if __name__ == "__main__":
    unittest.main(verbosity=2)
