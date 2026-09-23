#!/usr/bin/env python3
"""
母版字段完整性核对 — 防止 .op 母版漂移回「推演稿」。

原理:
  真实基线的 DOM 文本是字段真源。母版脚本必须覆盖基线的关键结构元素，
  否则说明母版又凭想象画了。

用法:
    python3 design/openpencil/baseline/check-master-fields.py

退出码: 0 通过 / 1 有缺失 / 2 基线缺失

被检查项是「结构元素」而非全部文案：数字、银行名等数据由种子数据决定，
不应写进母版；结构元素（区块标题、状态标签、操作按钮）必须出现。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "design" / "openpencil" / "baseline"
MASTER = REPO / "design" / "openpencil" / "scripts" / "10-mobile-core.js"

# 每个母版必须覆盖的结构元素（人工从真实基线归纳）
REQUIRED = {
    # mobile core
    "dashboard": [
        "概览", "管控信用卡资产与还款日程",
        "全部", "总待还款", "含逾期", "未来 7 天",
        "已逾期", "笔待处理", "未来待还", "7天", "14天", "30天", "天内到期合计",
        "总欠款", "未出账单", "暂无数据", "邮件解析待接入",
        "账户", "记一笔", "优惠", "权益", "邮箱账单",
        "逾期明细", "一键全部还款", "查看全部", "待还金额", "全额结清",
    ],
    "bills": [
        "卡片与账单", "笔历史逾期账单未结清", "待还合计", "一键还清",
        "筛选", "全部卡片 · 按持卡人 · 全部持卡人 · 逾期优先",
        "固定支出", "添加", "还没有固定支出",
        "当前待还金额", "登记还款", "账单日", "本期还款日", "历史账单明细",
        "部分还款", "待还款", "未出账单", "填写金额", "修改金额",
        "下期还款约", "今日刷卡免息",
    ],
    # mobile details
    "bill-detail": [
        "账单详情", "标准白金卡", "交通银行", "呼博", "尾号 9004", "待还",
        "应还", "最低", "已还", "剩余",
        "账单周期", "日期信息", "账单日", "还款日", "免息",
        "数据来源", "手动", "还款记录", "尚未还款", "去还款", "查看卡片详情",
    ],
    "card-detail": [
        "卡片详情", "中国银行", "呼博", "信用卡",
        "总额度", "已用", "可用",
        "日期与费用", "账单日", "还款日", "最长免息", "年费", "币种",
        "最近账单", "暂无账单",
    ],
    "analytics": [
        "消费与负债分析", "时间范围", "持卡人", "风险提示", "金额已折算为 CNY",
        "账单总额", "待还金额", "已还金额", "额度使用率",
        "月度账单趋势", "已还金额", "账单金额", "分类详情",
    ],
    # mobile extended
    "benefits": ["我的权益", "智能追踪与享用您的信用卡专属权益", "AI 搜集权益", "手动添加", "暂无可用权益", "一键 AI 自动搜集"],
    "gmail-ledger": [
        "邮箱账单流水", "全部", "未还", "部分", "已清",
        "账单总额", "待还金额", "待补金额",
        "全选", "北京银行", "未还款", "标记还款", "全额已还", "部分还款", "详情",
    ],
    "settings": [
        "我的", "hubo1989@gmail.com", "系统管理员权限", "进入后台",
        "家庭管理", "持卡人与卡片管理", "优惠活动", "可用优惠",
        "我的权益", "权益使用进度", "邮箱账单导入", "专属就绪",
        "提醒偏好", "还款提醒通道与节点", "设置", "界面显示偏好与隐私模式", "退出登录",
    ],
    # admin
    "admin-dashboard": [
        "管理控制台", "仪表盘", "银行管理", "卡产品管理", "优惠活动", "权益管理", "邮件日志", "系统设置",
        "返回前台 App", "平台运营概览", "WorldCredit 控制台",
        "注册用户", "卡产品数", "活跃信用卡", "进行中活动",
        "核心管理模块", "维护支持的银行列表", "管理信用卡产品及账期",
        "信用卡产品目录", "个在册产品", "银行", "卡片名称", "币种", "年费", "年费减免", "开卡数",
    ],
    "admin-banks": [
        "银行管理", "维护系统中支持的银行列表及所属国家",
        "新增银行", "按国家筛选", "按真实内容补全",
        "图标", "银行名称", "简称", "国家", "状态", "操作",
        "中国工商银行", "中国农业银行", "中国建设银行", "交通银行",
    ],
    "admin-email-logs": [
        "邮件日志", "每封收到的邮件及其处理结果",
        "全部", "成功", "失败", "跳过",
        "时间", "发件人", "主题", "状态", "说明",
        "中国农业银行信用卡电子账单", "Rows per page",
    ],
}


def main() -> int:

    # 校验对象是 .op 产物，不是脚本源码。
    # 早期版本按脚本文本匹配，注释里的字（如「逾期明细」）能撑过检查 —— 那是自欺。
    OP_FILE = REPO / "design" / "openpencil" / "worldcredit-redesign.op"
    if not OP_FILE.exists():
        print(f"找不到设计源: {OP_FILE}", file=sys.stderr)
        return 2
    try:
        doc = json.loads(OP_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"设计源解析失败: {exc}", file=sys.stderr)
        return 2

    # 母版所在的设计页 → 该页承载哪些母版
    PAGE_FOR = {
        "dashboard": "10 · Mobile Core",
        "bills": "10 · Mobile Core",
        "bill-detail": "11 · Mobile Details",
        "card-detail": "11 · Mobile Details",
        "analytics": "11 · Mobile Details",
        "benefits": "12 · Mobile Extended",
        "gmail-ledger": "12 · Mobile Extended",
        "settings": "12 · Mobile Extended",
        "admin-dashboard": "30 · Admin",
        "admin-banks": "30 · Admin",
        "admin-email-logs": "30 · Admin",
    }

    # 母版在 .op 里以顶层 frame 的形式存在，按 frame 名区分
    FRAME_MATCH = {
        "dashboard": "screen.mobile.dashboard",
        "bills": "screen.mobile.bills",
        "bill-detail": "screen.mobile.bill-detail",
        "card-detail": "screen.mobile.card-detail",
        "analytics": "screen.mobile.analytics",
        "benefits": "screen.mobile.benefits",
        "gmail-ledger": "screen.mobile.gmail-ledger",
        "settings": "screen.mobile.settings",
        "admin-dashboard": "screen.admin.dashboard",
        "admin-banks": "screen.admin.crud",
        "admin-email-logs": "screen.admin.ledger",
    }

    def collect_texts(node, out):
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("content"):
                out.append(str(node["content"]))
            for c in node.get("children") or []:
                collect_texts(c, out)
        elif isinstance(node, list):
            for c in node:
                collect_texts(c, out)

    def page_texts(page_name: str) -> str:
        page = next((p for p in doc.get("pages", []) if p.get("name") == page_name), None)
        if not page:
            return ""
        out: list[str] = []
        collect_texts(page, out)
        return " ".join(out)

    _page_cache: dict[str, str] = {}

    def master_texts(name: str) -> str:
        """取该母版 frame 子树内的文本（而不是整页），避免同页母版互相借字段。"""
        page_name = PAGE_FOR[name]
        needle = FRAME_MATCH[name]
        page = next((p for p in doc.get("pages", []) if p.get("name") == page_name), None)
        if not page:
            return ""
        found: list[str] = []

        def find_and_collect(node):
            if isinstance(node, dict):
                nm = str(node.get("name") or "")
                if needle in nm and node.get("type") == "frame":
                    collect_texts(node, found)
                    return True
                for c in node.get("children") or []:
                    if find_and_collect(c):
                        return True
            elif isinstance(node, list):
                for c in node:
                    if find_and_collect(c):
                        return True
            return False

        find_and_collect(page)
        return " ".join(found)

    sections = {name: master_texts(name) for name in REQUIRED}

    # 真实 DOM 会把视觉上连续的文案拆成多个节点（`7天` 实际是 `7` + `天`，
    # 因为胶囊样式导致换行）。母版里则是单个文本节点。统一去掉空白再比对，
    # 否则会把「同一内容的两种合法表达」误判为缺失。
    def normalize(text: str) -> str:
        return "".join(text.split())

    failures = 0
    for name, required in REQUIRED.items():
        base_dom = BASE / "dom" / name / "default.json"
        if not base_dom.exists():
            print(f"缺少基线: {base_dom.relative_to(REPO)}（先跑 capture.py）", file=sys.stderr)
            return 2
        payload = json.loads(base_dom.read_text(encoding="utf-8"))
        # 优先用 textsRaw（未去重、保留阅读顺序）：去重序列无法重建
        # 被样式拆开的连续文案（`7` + `天` → `7天`）。
        baseline_text = normalize(" ".join(payload.get("textsRaw") or payload["texts"]))
        master_text = normalize(sections[name])

        missing_in_master = [k for k in required if normalize(k) not in master_text]
        # 基线也必须含这些元素，否则说明检查清单过期
        missing_in_baseline = [k for k in required if normalize(k) not in baseline_text]

        status = "OK  "
        if missing_in_master or missing_in_baseline:
            status = "FAIL"
            failures += 1
        print(f"{status}{name:<12} 结构元素 {len(required)} 项")
        if missing_in_master:
            print(f"       母版缺失: {missing_in_master}")
        if missing_in_baseline:
            print(f"       检查清单与基线不符: {missing_in_baseline}")

    if failures:
        print(f"\n{failures} 个母版未对齐基线", file=sys.stderr)
        return 1
    print("\n全部母版与真实基线对齐")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
