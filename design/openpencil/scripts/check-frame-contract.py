#!/usr/bin/env python3
"""
屏帧字段/动作契约检查（便携版）— 只读 `.op` 与 `screens/_contract.json`。

为什么需要它：
  `baseline/check-master-fields.py` 守护的是「母版 == 线上现状」，用 `needle in name`
  的子串匹配找母版。一旦引入 Candidate/Approved 帧，子串匹配会串到错误 frame，
  而按文案子串判定也无法区分「结构还在」和「只剩一句残留文字」。
  本脚本用**完整 frame key 精确匹配**，把判定锚在结构节点上，文案只作辅助。

角色与命名（详见 `screens/NAMING.md`）：
  current   前缀 `screen.`     现状复刻母版
  candidate 前缀 `candidate.`  目标设计候选稿
  approved  前缀 `approved.`   人工批准、作为实现基线

判定规则：
  - frame 身份按 head 字符串**精确相等**匹配，不做子串 / 前缀 / 模糊匹配
    （`90 · Comparisons · screen.mobile.dashboard` 这类外壳 frame 不会被误认）。
  - 标记只在**该 frame 自身子树**内收集，同页相邻母版互不借字段。
  - action 类 requirement 必须至少有一个结构锚点（`node` / `nodePrefix`），
    纯文案不算「操作存在」。
  - 契约内禁止个人数据与具体金额，违规即退出码 2（把问题挡在人审之前）。

用法:
    python3 design/openpencil/scripts/check-frame-contract.py
    python3 design/openpencil/scripts/check-frame-contract.py --op <path> --contract <path>
    python3 design/openpencil/scripts/check-frame-contract.py --json

退出码: 0 通过 / 1 契约违规 / 2 设计源或契约缺失、解析失败、契约本身不合法

边界：本脚本**不**接入 `verify-batch.sh`，也**不**改变现有门禁语义。
是否接入由人决策（见 `screens/NAMING.md` 第 6 节）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_OP = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
DEFAULT_CONTRACT = REPO / "design" / "openpencil" / "screens" / "_contract.json"
DEFAULT_REGISTRY = REPO / "design" / "openpencil" / "screens" / "_registry.json"

SEP = " · "
SIZE_RE = re.compile(r"^(\d{3,4})[×x](\d{3,4})$")

# 契约卫生：判据里不得出现真实数据。这里只放与代码库无关的机械规则 +
# 一小份已知本地串，避免把个人数据抄进第二份真源。
FORBIDDEN_SUBSTRINGS = ("尾号", "呼博", "胡波", "hubo1989")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
DIGIT_RUN_RE = re.compile(r"\d{4,}")
AMOUNT_RE = re.compile(r"[¥￥$]\s?\d")

# 结构锚点：node / nodePrefix 指定名节点，textNode 指定**整节点文本精确相等**。
# textNode 比 label 更强：label 是拼接文本里的子串，textNode 必须有一个文本节点
# 的内容恰好等于候选项，因此不能靠残留文案蒙过。
ANCHOR_FIELDS = ("node", "nodePrefix", "textNode")
MARKER_TEXT_FIELDS = ("node", "nodePrefix", "within", "textNode")


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def norm(text: object) -> str:
    """去掉全部空白（含全角空格）：线上被样式拆成 `7` + `天`，母版是 `7天`。"""
    return re.sub(r"\s+", "", str(text))


def iter_nodes(node):
    if isinstance(node, dict):
        yield node
        for child in node.get("children") or []:
            yield from iter_nodes(child)
    elif isinstance(node, list):
        for child in node:
            yield from iter_nodes(child)


def node_names(root) -> list[str]:
    out = []
    for n in iter_nodes(root):
        nm = n.get("name")
        if isinstance(nm, str) and nm:
            out.append(norm(nm))
    return out


def node_texts(root) -> str:
    out = []
    for n in iter_nodes(root):
        if n.get("type") == "text" and n.get("content"):
            out.append(norm(n["content"]))
    return "".join(out)


def exact_text_nodes(root) -> set[str]:
    """每个文本节点的归一化内容（整节点，非子串）。"""
    out = set()
    for n in iter_nodes(root):
        if n.get("type") == "text" and n.get("content"):
            out.add(norm(n["content"]))
    return out


def parse_frame_name(name: str):
    """`<head>[ · <variant>] · <W>×<H>` -> (head, variant, (w, h))；尺寸缺失返回 None。"""
    parts = str(name).split(SEP)
    head = parts[0]
    size = None
    variants: list[str] = []
    for part in parts[1:]:
        m = SIZE_RE.match(part.strip())
        if m:
            size = (float(m.group(1)), float(m.group(2)))
        else:
            variants.append(part)
    if size is None:
        return None
    return head, SEP.join(variants), size


def role_of(head: str, role_prefix: dict) -> str | None:
    """按前缀判定角色；最长前缀优先，避免互相吞并。"""
    for role, prefix in sorted(role_prefix.items(), key=lambda kv: -len(kv[1])):
        if head.startswith(prefix) and len(head) > len(prefix):
            return role
    return None


def head_for(role: str, key: str, role_prefix: dict) -> str:
    cur = role_prefix["current"]
    if not key.startswith(cur):
        raise ValueError(f"契约 key 必须以 {cur!r} 开头，收到 {key!r}")
    return role_prefix[role] + key[len(cur):]


# ---------------------------------------------------------------------------
# 契约合法性（结构性错误 -> 退出码 2）
# ---------------------------------------------------------------------------
def _scrub_for_digits(s: str) -> str:
    s = re.sub(r"\\d|\\D|\[0-9\]|\[\\d\]", "", s)
    return re.sub(r"\{[^}]*\}", "", s)


def hygiene_problems(field: str, raw: object) -> list[str]:
    s = str(raw)
    problems: list[str] = []
    if EMAIL_RE.search(s):
        problems.append("含邮箱")
    for bad in FORBIDDEN_SUBSTRINGS:
        if bad in s:
            problems.append(f"含真实串 {bad!r}")
    probe = _scrub_for_digits(s) if field == "pattern" else s
    if DIGIT_RUN_RE.search(probe):
        problems.append("含 4 位以上连续数字")
    if AMOUNT_RE.search(probe):
        problems.append("含具体金额")
    return problems


def validate_contract(contract: dict) -> list[str]:
    errors: list[str] = []
    role_prefix = contract.get("rolePrefix")
    if not isinstance(role_prefix, dict) or "current" not in role_prefix:
        errors.append("缺少 rolePrefix.current")
        return errors
    if contract.get("reviewStatus") != "proposed":
        errors.append(
            f"reviewStatus 应为 'proposed'（人脸批准前不得置为其它值），收到 "
            f"{contract.get('reviewStatus')!r}"
        )

    seen_keys: set[str] = set()
    for screen in contract.get("screens") or []:
        key = screen.get("key")
        if not isinstance(key, str) or not key:
            errors.append("screen 缺少 key")
            continue
        if key in seen_keys:
            errors.append(f"screen key 重复: {key}")
        seen_keys.add(key)
        try:
            head_for("current", key, role_prefix)
            head_for("candidate", key, role_prefix)
            head_for("approved", key, role_prefix)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        for role in role_prefix:
            if role != "current" and not head_for(role, key, role_prefix):
                errors.append(f"{key} 无法推导 {role} 角色 head")

        for group, kind in (("fields", "field"), ("actions", "action")):
            reqs = screen.get(group) or []
            if not reqs:
                errors.append(f"{key} 的 {group} 为空")
            ids = set()
            for req in reqs:
                rid = req.get("id")
                label = f"{key}:{rid}"
                if not isinstance(rid, str) or not rid:
                    errors.append(f"{key} 的 {group} 存在无 id 项")
                    continue
                if rid in ids:
                    errors.append(f"{label} id 重复")
                ids.add(rid)
                if req.get("kind") != kind:
                    errors.append(f"{label} kind 应为 {kind!r}，收到 {req.get('kind')!r}")
                markers = req.get("markers") or []
                all_markers = req.get("allMarkers") or []
                if not markers and not all_markers:
                    errors.append(f"{label} 没有任何 marker")
                if kind == "action":
                    anchored = any(
                        any(f in m for f in ANCHOR_FIELDS)
                        for m in list(markers) + list(all_markers)
                    )
                    if not anchored:
                        errors.append(
                            f"{label} 是 action 但没有结构锚点（{' / '.join(ANCHOR_FIELDS)}）；"
                            "拼接文案子串不能证明操作存在"
                        )
                for marker in list(markers) + list(all_markers):
                    if not isinstance(marker, dict):
                        errors.append(f"{label} marker 不是对象")
                        continue
                    fields = [f for f in (*MARKER_TEXT_FIELDS, "pattern") if f in marker]
                    if "label" in marker:
                        fields.append("label")
                    if not fields:
                        errors.append(f"{label} marker 为空")
                    if "label" in marker and not isinstance(marker["label"], list):
                        errors.append(f"{label} 的 label 必须是数组（允许同义词）")
                    if "textNode" in marker and not isinstance(marker["textNode"], list):
                        errors.append(f"{label} 的 textNode 必须是数组（允许同义词）")
                    for field in fields:
                        if field in ("label", "textNode"):
                            for alt in marker[field]:
                                for p in hygiene_problems(field, alt):
                                    errors.append(f"{label} {field} {alt!r} {p}")
                        else:
                            for p in hygiene_problems(field, marker[field]):
                                errors.append(f"{label} {field}={marker[field]!r} {p}")
    for entry in contract.get("uncovered") or []:
        if not entry.get("key"):
            errors.append("uncovered 存在无 key 项")
    return errors


# ---------------------------------------------------------------------------
# 判定
# ---------------------------------------------------------------------------
def eval_marker(marker: dict, frame: dict, default_min: int) -> bool:
    scope = [frame]
    if "within" in marker:
        anchor = norm(marker["within"])
        scope = [n for n in iter_nodes(frame) if isinstance(n.get("name"), str) and norm(n["name"]) == anchor]
        if not scope:
            return False

    names: list[str] = []
    texts: list[str] = []
    for root in scope:
        names.extend(node_names(root))
        texts.append(node_texts(root))
    joined = "".join(texts)

    if "node" in marker:
        return norm(marker["node"]) in names
    if "nodePrefix" in marker:
        prefix = norm(marker["nodePrefix"])
        need = int(marker.get("min", default_min))
        return sum(1 for n in names if n.startswith(prefix)) >= need
    if "textNode" in marker:
        exact = set()
        for root in scope:
            exact |= exact_text_nodes(root)
        hits = sum(1 for alt in marker["textNode"] if norm(alt) in exact)
        return hits >= int(marker.get("min", default_min))
    if "label" in marker:
        hits = sum(1 for alt in marker["label"] if norm(alt) in joined)
        return hits >= int(marker.get("min", default_min))
    if "pattern" in marker:
        return re.search(str(marker["pattern"]), joined) is not None
    return False


def eval_requirement(req: dict, frame: dict, default_min: int) -> bool:
    markers = req.get("markers") or []
    all_markers = req.get("allMarkers") or []
    min_markers = int(req.get("minMarkers", 1 if markers else 0))
    hits = sum(1 for m in markers if eval_marker(m, frame, default_min))
    if hits < min_markers:
        return False
    return all(eval_marker(m, frame, default_min) for m in all_markers)


def anchor_kind(req: dict) -> str:
    """req 的锚点强度：node > scoped > text。

    - node      : 有具名结构节点（node / nodePrefix / textNode）
    - scoped    : 没有具名节点，但把搜索收到某个具名容器内（within）
    - text      : 只靠拼接文案（label / pattern），最弱
    """
    markers = list(req.get("markers") or []) + list(req.get("allMarkers") or [])
    if any("node" in m for m in markers):
        return "node"
    if any("nodePrefix" in m for m in markers):
        return "nodePrefix"
    if any("textNode" in m for m in markers):
        return "textNode"
    if any("within" in m for m in markers):
        return "scoped"
    return "text"


def check_doc(doc: dict, contract: dict, registry: dict | None) -> tuple[int, list[str], dict]:
    """返回 (退出码, 输出行, 机器可读摘要)。"""
    lines: list[str] = []
    role_prefix = contract["rolePrefix"]
    defaults = contract.get("defaults") or {}
    default_min = int(defaults.get("min", 1))
    apply_to = defaults.get("applyTo") or ["current"]
    required_roles = defaults.get("requiredRoles") or ["current"]

    # 1) 收集设计源里所有受管理 frame
    frames: list[tuple[str, str, str, tuple, dict]] = []  # head, role, variant, size, node
    for page in doc.get("pages", []):
        for n in iter_nodes(page):
            if n.get("type") != "frame":
                continue
            parsed = parse_frame_name(str(n.get("name") or ""))
            if not parsed:
                continue
            head, variant, size = parsed
            role = role_of(head, role_prefix)
            if role is None:
                continue
            frames.append((head, role, variant, size, n))

    by_head: dict[str, list] = {}
    for item in frames:
        by_head.setdefault(item[0], []).append(item)

    failures: list[str] = []
    # 逐屏条目的缺陷会打印在各自的 OK/FAIL 行里；structural 只装「没有对应屏行」的问题，
    # 两条通道分开，避免同一个问题打印两遍。
    structural: list[str] = []
    summary = {"screens": [], "undeclared": [], "staleUncovered": [], "weakRequirements": []}

    # 2) 同一身份重复
    seen_identity: dict[tuple, int] = {}
    for head, role, variant, size, _ in frames:
        identity = (role, head, variant, size)
        seen_identity[identity] = seen_identity.get(identity, 0) + 1
    for identity, count in sorted(seen_identity.items(), key=lambda kv: str(kv[0])):
        if count > 1:
            role, head, variant, size = identity
            msg = (
                f"duplicate-frame {head} · {variant or '-'} · {size[0]:g}×{size[1]:g}"
                f"（role={role}，出现 {count} 次）"
            )
            failures.append(msg)
            structural.append(msg)

    # 「已声明」= 每个契约屏在 `applyTo` 角色下的推导 head。
    # applyTo 之外的角色（例如尚未纳入候选期的 approved）出现即算未声明，
    # 避免脚本静默出现第三个角色而不被人察觉。
    contract_heads = set()
    for screen in contract.get("screens") or []:
        for role in apply_to:
            contract_heads.add(head_for(role, screen["key"], role_prefix))
    uncovered_heads = {e["key"] for e in contract.get("uncovered") or []}

    # 3) 未声明 frame：新帧出现必须先在契约里认领或显式列入 uncovered
    for head in sorted(by_head):
        if head not in contract_heads and head not in uncovered_heads:
            summary["undeclared"].append(head)
            msg = f"undeclared-frame {head}（需写入 _contract.json 的 screens 或 uncovered）"
            failures.append(msg)
            structural.append(msg)

    # 4) 注册表一致性（可选，仅校验 screens[].registryKey）
    if registry is not None:
        registry_keys = {s.get("key") for s in registry.get("screens") or []}
        for screen in contract.get("screens") or []:
            rk = screen.get("registryKey")
            if rk and rk not in registry_keys:
                msg = (
                    f"registry-mismatch {screen['key']} 声明的 registryKey {rk} 不在 _registry.json"
                )
                failures.append(msg)
                structural.append(msg)

    # 5) 逐屏逐角色判定
    covered_roles = 0
    judged = 0
    for screen in contract.get("screens") or []:
        key = screen["key"]
        for role in apply_to:
            head = head_for(role, key, role_prefix)
            present = by_head.get(head) or []
            entry = {"key": key, "role": role, "head": head, "present": bool(present)}
            # 2026-10-05 批准：屏级 requiredRoles 覆盖全局默认（如 B0-2 后收紧 dashboard 的 candidate 为必需）
            # 屏级覆盖全局默认；显式 [] 表达「本屏无必需角色」，不得被 or 兜底吞掉
            screen_required = (screen["requiredRoles"]
                               if "requiredRoles" in screen else required_roles)
            if not present:
                if role in screen_required:
                    failures.append(f"missing-frame {head}（role={role} 为必需）")
                    entry["status"] = "FAIL"
                    entry["reason"] = "必需 frame 缺失"
                else:
                    entry["status"] = "SKIP"
                summary["screens"].append(entry)
                continue

            covered_roles += 1
            reqs = list(screen.get("fields") or []) + list(screen.get("actions") or [])
            judged += len(reqs)
            missing: list[str] = []
            for frame in present:
                # 同一 head 的多尺寸/variant 变体都按同一契约判定；
                # 任一变体缺失即算缺失（契约表达的是「该屏必须覆盖」，与尺寸无关）
                for req in reqs:
                    if not eval_requirement(req, frame[4], default_min):
                        if req["id"] not in missing:
                            missing.append(req["id"])
            entry["variants"] = [f"{v[2] or '-'}/{v[3][0]:g}x{v[3][1]:g}" for v in present]
            entry["checked"] = len(reqs)
            entry["anchors"] = sorted({anchor_kind(r) for r in reqs})
            # 纯文案判据（连 within 都没有）是判定链上最弱的一环，显式报出来给人审，
            # 而不是让它悄悄混在「通过」里。
            for req in reqs:
                if anchor_kind(req) == "text":
                    summary["weakRequirements"].append(f"{head}:{req['id']}")
            if missing:
                entry["status"] = "FAIL"
                entry["missing"] = missing
                failures.append(f"{head}（role={role}）缺 {len(missing)} 项: {', '.join(missing)}")
            else:
                entry["status"] = "OK"
            summary["screens"].append(entry)

    for head in uncovered_heads:
        if head not in by_head:
            summary["staleUncovered"].append(head)
    summary["frameCount"] = len(frames)
    summary["requirementChecks"] = judged
    summary["coveredRoles"] = covered_roles
    summary["failures"] = failures

    lines.append(
        f"检查 {len(contract.get('screens') or [])} 个契约屏 / {len(frames)} 个受管理 frame"
        "（便携版，按 frame key 精确匹配）"
    )
    for entry in summary["screens"]:
        loc = f"{entry['head']}"
        if entry["status"] == "OK":
            lines.append(f"OK   {loc:<38} role={entry['role']:<9} 项 {entry['checked']} · 变体 {len(entry['variants'])}")
        elif entry["status"] == "SKIP":
            lines.append(f"SKIP {loc:<38} role={entry['role']:<9} 未出现（非必需）")
        else:
            reason = entry.get("reason") or f"缺 {len(entry.get('missing', []))} 项: {', '.join(entry.get('missing', []))}"
            lines.append(f"FAIL {loc:<38} role={entry['role']:<9} {reason}")
    # 逐屏条目的缺失已打印在各自的 OK/FAIL 行；这里只补没有对应屏行的结构性问题。
    for msg in structural:
        lines.append(f"FAIL {msg}")
    for head in summary["staleUncovered"]:
        lines.append(f"INFO uncovered 中 {head} 在设计源中不存在（可清理）")
    if summary["weakRequirements"]:
        lines.append(
            f"INFO 纯文案判据 {len(summary['weakRequirements'])} 项（无结构锚点，最弱环节）: "
            + ", ".join(summary["weakRequirements"])
        )

    return (1 if failures else 0), lines, summary


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="屏帧字段/动作契约检查（便携版）")
    ap.add_argument("--op", default=str(DEFAULT_OP), help="设计源 .op")
    ap.add_argument("--contract", default=str(DEFAULT_CONTRACT), help="契约 JSON")
    ap.add_argument("--registry", default=str(DEFAULT_REGISTRY), help="注册表 JSON（缺失则跳过一致性校验）")
    ap.add_argument("--json", action="store_true", help="输出机器可读摘要")
    args = ap.parse_args(argv)

    op_path = Path(args.op)
    contract_path = Path(args.contract)
    registry_path = Path(args.registry)

    if not op_path.exists():
        print(f"找不到设计源: {op_path}", file=sys.stderr)
        return 2
    if not contract_path.exists():
        print(f"找不到契约: {contract_path}", file=sys.stderr)
        return 2

    try:
        doc = load_json(op_path)
    except Exception as exc:
        print(f"设计源解析失败: {exc}", file=sys.stderr)
        return 2
    try:
        contract = load_json(contract_path)
    except Exception as exc:
        print(f"契约解析失败: {exc}", file=sys.stderr)
        return 2

    errors = validate_contract(contract)
    if errors:
        print("契约不合法（退出码 2）:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 2

    registry = None
    if registry_path.exists():
        try:
            registry = load_json(registry_path)
        except Exception:
            registry = None

    code, lines, summary = check_doc(doc, contract, registry)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        for line in lines:
            print(line)
        if code == 0:
            print("\n契约覆盖通过：命名精确、字段与动作齐全")
        else:
            print(f"\n契约违规 {len(summary['failures'])} 项", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
