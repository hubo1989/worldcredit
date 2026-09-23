#!/usr/bin/env python3
"""
WorldCredit 基线取证 — 6 条母版路由 × 四态（default / loading / empty / error）

用法:
    python3 design/openpencil/baseline/capture.py                # 全部路由
    python3 design/openpencil/baseline/capture.py --only dashboard bills
    python3 design/openpencil/baseline/capture.py --states default
    python3 design/openpencil/baseline/capture.py --base-url http://127.0.0.1:8787

前置:
    1. 本地服务在跑:  npx wrangler dev --port 8787   (见 baseline/README.md)
    2. Python playwright 可用:  python3 -c "import playwright"

产出:
    design/openpencil/baseline/shots/<route>/<state>.png    截图
    design/openpencil/baseline/dom/<route>/<state>.json     DOM 文本 / 字段 / 状态标记
    design/openpencil/baseline/index.json                   本次运行清单

设计要点:
  - 认证不依赖 Google OAuth：用 .dev.vars 的 SESSION_SECRET 本地签发 wc_user。
  - 四态不改应用代码：统一在 /api/rpc/** 层拦截
      loading → 永不响应（页面停在骨架屏）
      empty   → 返回空数组 / 空对象
      error   → 返回 500，触发页面错误态
  - DOM 抽取保留全部可见文本，用于比对母版字段完整性。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
except ImportError:
    sys.exit(
        "缺少 playwright。安装：\n"
        "  python3 -m pip install playwright && python3 -m playwright install chromium"
    )

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "design" / "openpencil" / "baseline"
SHOTS = OUT / "shots"
DOM = OUT / "dom"
DEV_VARS = REPO / ".dev.vars"

ADMIN_EMAIL = "hubo1989@gmail.com"

# 6 条母版路由：route key → (路径, 视口, 说明)
ROUTES: dict[str, dict] = {
    "dashboard": {
        "path": "/dashboard",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "mobile-dashboard",
    },
    "bills": {
        "path": "/bills",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "aggregated-list",
    },
    "card-detail": {
        # 真实 card id 从 RPC / DOM 里取；占位符在运行时替换
        "path": "/cards/{card_id}",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "detail",
    },
    "analytics": {
        "path": "/analytics",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "analytics",
    },
    "login": {
        "path": "/login",
        "viewport": {"width": 390, "height": 844},
        "surface": "auth",
        "master": "auth",
        "anonymous": True,
        # 无 RPC 可拦截：四态由表单交互产生（空表单 / 提交中 / 凭据错误）。
        # 选择器取自真实 DOM：email/password 输入框 + 文案「登录系统」的主按钮。
        "interaction": {
            "default": {"actions": [], "note": "空表单初始态"},
            "loading": {
                "actions": [
                    {"fill": ["input[type=email]", "baseline@example.com"]},
                    {"fill": ["input[type=password]", "baseline-password"]},
                    {"click_text": "登录系统"},
                    {"sleep": 400},
                ],
                "note": "提交中：主按钮 loading",
            },
            "empty": {
                "actions": [],
                "note": "空表单：主按钮可用但未填，字段无校验红字",
            },
            "error": {
                "actions": [
                    {"fill": ["input[type=email]", "baseline@example.com"]},
                    {"fill": ["input[type=password]", "wrong-password"]},
                    {"click_text": "登录系统"},
                    {"sleep": 2500},
                ],
                "note": "服务端凭据错误，且保留已填内容",
            },
        },
    },
    "admin-banks": {
        "path": "/admin/banks",
        "viewport": {"width": 1440, "height": 900},
        "surface": "admin",
        "master": "admin-crud",
    },
    # ---- 2026-09-22 追加：其余母版的基线 ----
    "bill-detail": {
        # bill id 运行时从 D1 取；用于 detail 母版的第二个样本
        "path": "/bills/{bill_id}",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "detail",
    },
    "benefits": {
        "path": "/benefits",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "catalog",
    },
    "gmail-ledger": {
        "path": "/gmail-ledger",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "ledger",
    },
    "settings": {
        "path": "/settings",
        "viewport": {"width": 390, "height": 844},
        "surface": "mobile",
        "master": "settings",
    },
    "admin-dashboard": {
        "path": "/admin",
        "viewport": {"width": 1440, "height": 900},
        "surface": "admin",
        "master": "admin-dashboard",
    },
    "admin-email-logs": {
        "path": "/admin/email-logs",
        "viewport": {"width": 1440, "height": 900},
        "surface": "admin",
        "master": "admin-ledger",
    },
}

STATES = ("default", "loading", "empty", "error")

DEVICE_SCALE = 2


# --------------------------------------------------------------------------
# session cookie：与 lib/session.ts / lib/hmac.ts 完全一致的线格式
# base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
# --------------------------------------------------------------------------
def read_dev_var(name: str) -> str | None:
    if not DEV_VARS.exists():
        return None
    for line in DEV_VARS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip('"').strip("'")
    return None


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_session(secret: str, user_id: str, email: str, name: str) -> str:
    payload = {
        "id": user_id,
        "email": email,
        "name": name,
        "role": "admin" if email.lower() == ADMIN_EMAIL else "member",
        "created_at": "2026-01-01T00:00:00.000Z",
        "exp": int(time.time()) + 7 * 24 * 3600,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()
    return f"{b64url(raw)}.{b64url(sig)}"


# --------------------------------------------------------------------------
# 四态拦截：按状态改写 /api/rpc/** 的响应
# --------------------------------------------------------------------------
# 配置/偏好类 RPC：必须原样穿透。清空它们会让页面在读取 display_config 时崩溃，
# 那是「缺陷态」而不是「空数据态」。
CONFIG_RPC_KEEP = (
    "preferences",
    "getuserpreferences",
    "session",
    "theme",
    "settings",
    "config",
)


def is_config_rpc(url: str) -> bool:
    low = url.lower()
    return any(k in low for k in CONFIG_RPC_KEEP)


def structurally_empty(value):
    """按真实响应结构生成「空数据」版本。

    早期实现按函数名猜形状（含 summary → 字典），但
    `getCardsWithBillsSummary` 名字里有 summary 却返回数组，
    猜错会让页面解构崩溃，产出的是「缺陷态」而非「空态」。

    改为保留真实结构，只把内容清空：
      列表 → []        数字 → 0        字典 → 递归
      字符串 / 布尔 / None → 原样保留（枚举与开关不能随便改）
    """
    if isinstance(value, list):
        return []
    if isinstance(value, dict):
        return {k: structurally_empty(v) for k, v in value.items()}
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return 0
    return value


# 冻结汇率：外部接口（api.exchangerate.fun）每日波动，会让多币种折算金额变化。
# 基线必须可复现，所以固定一组汇率；数值取自某次真实响应，量级与真实一致。
FROZEN_FX = {
    "timestamp": 1790067600,
    "base": "USD",
    "rates": {
        "USD": 1,
        "CNY": 6.6991,
        "CNH": 6.700348,
        "HKD": 7.8001,
        "EUR": 0.92,
        "JPY": 155.2,
        "GBP": 0.79,
    },
}


def install_rpc_router(page, state: str, log: list):
    """拦截 RPC 与汇率。loading 永不落地，empty 返回空，error 返回 500。"""

    async def handler(route):
        url = route.request.url
        # 汇率冻结：命中外部汇率接口就直接返回固定值，不发真实请求
        if "exchangerate.fun" in url:
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(FROZEN_FX),
            )
            return
        if "/api/rpc/" not in url:
            await route.continue_()
            return
        log.append(url.split("/api/rpc/", 1)[1])
        if state == "loading":
            # 不 fulfill / 不 continue：请求悬挂，页面停留在骨架屏
            await asyncio.sleep(600)
            return
        if state == "error":
            await route.fulfill(
                status=500,
                content_type="application/json",
                body=json.dumps({"error": "baseline-forced-error"}),
            )
            return
        if state == "empty":
            # 配置/偏好类必须原样穿透：清空 display_config 会让页面崩溃。
            if is_config_rpc(url):
                await route.continue_()
                return
            # 其余业务数据：取真实响应，再按结构清空内容。
            try:
                response = await route.fetch()
                raw = await response.json()
                if isinstance(raw, dict) and "data" in raw:
                    raw = {**raw, "data": structurally_empty(raw["data"])}
                else:
                    raw = structurally_empty(raw)
                await route.fulfill(
                    status=response.status,
                    content_type="application/json",
                    body=json.dumps(raw, ensure_ascii=False),
                )
            except Exception:
                await route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"data": []}),
                )
            return
        await route.continue_()

    return handler


# --------------------------------------------------------------------------
# DOM 抽取
# --------------------------------------------------------------------------
EXTRACT_JS = r"""
() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = [];       // 去重：适合看「出现了哪些内容」
  const textsRaw = [];    // 不去重：保留真实阅读顺序，适合重建连续文案
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const t = clean(n.nodeValue);
    if (!t) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    textsRaw.push(t);
    if (seen.has(t)) continue;
    seen.add(t);
    texts.push(t);
  }
  const inputs = [...document.querySelectorAll('input,textarea,select')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    placeholder: el.getAttribute('placeholder'),
    ariaLabel: el.getAttribute('aria-label'),
    value: el.tagName === 'SELECT' ? null : (el.value ? String(el.value).slice(0, 40) : ''),
  }));
  const buttons = [...document.querySelectorAll('button,[role=button],a')]
    .filter(visible)
    .map((el) => clean(el.textContent))
    .filter(Boolean);
  // 状态标记：骨架屏 / 空态 / 错误态在实现里的类名与文案特征
  const html = document.body.innerHTML;
  const markers = {
    skeleton: document.querySelectorAll('[class*=skeleton], .MuiSkeleton-root').length,
    spinner: document.querySelectorAll('.MuiCircularProgress-root,[role=progressbar]').length,
    alert: document.querySelectorAll('[class*=MuiAlert-root], [role=alert]').length,
    dialog: document.querySelectorAll('[role=dialog], .MuiDialog-root').length,
  };
  return {
    title: document.title,
    url: location.pathname,
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((e) => clean(e.textContent)).filter(Boolean),
    texts,
    textsRaw,
    inputs,
    buttons: [...new Set(buttons)],
    markers,
    bodyText: clean(document.body.innerText).slice(0, 12000),
    htmlBytes: html.length,
  };
}
"""


async def wait_for_data(page, state: str):
    """等页面稳定：default/empty 等网络静默，loading 只等固定时间。"""
    if state == "loading":
        await page.wait_for_timeout(2500)
        return
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except PWTimeout:
        pass
    await page.wait_for_timeout(1200)


def d1_query(sql: str, database: str = "worldcredit"):
    """本地 D1 只读查询，返回 results 数组。"""
    import subprocess

    proc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", database, "--local", "--json", "--command", sql],
        cwd=str(REPO), capture_output=True, text=True, timeout=120,
    )
    payload = json.loads(proc.stdout)
    if isinstance(payload, list) and payload:
        return payload[0].get("results") or []
    return []


def resolve_session_user(database: str = "worldcredit") -> tuple[str, str, str] | None:
    """挑一个「有数据归属」的真实用户作为取证身份。

    会话必须先绑定真实 user id：/bills 与 /dashboard 的查询都带
    `ch.created_by = ? OR ch.auth_user_id = ?`，用假 UUID 签发 cookie 会让
    真实上下文退化成空态，取证结果失真。
    优先级：能通过 created_by / auth_user_id 关联到持卡人的用户 > 第一个用户。
    """
    try:
        rows = d1_query(
            "SELECT u.id, u.email, u.name FROM users u "
            "WHERE u.id IN ("
            "  SELECT created_by FROM card_holders WHERE created_by IS NOT NULL"
            "  UNION SELECT auth_user_id FROM card_holders WHERE auth_user_id IS NOT NULL"
            ") LIMIT 1;",
            database,
        )
        if not rows:
            rows = d1_query("SELECT id, email, name FROM users LIMIT 1;", database)
        if rows:
            r = rows[0]
            return str(r["id"]), str(r.get("email") or ""), str(r.get("name") or "")
    except Exception:
        pass
    return None


def resolve_bill_id_from_d1(database: str = "worldcredit") -> str | None:
    """从本地 D1 取一个真实 bill id（详情页母版用）。"""
    try:
        rows = d1_query("SELECT id FROM bills ORDER BY due_date DESC LIMIT 1;", database)
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        pass
    return None


def resolve_card_id_from_d1(database: str = "worldcredit") -> str | None:
    """从本地 D1 直查一个真实 card id。

    不走 RPC：本地 card_holders.auth_user_id 可能为 null，
    getCardsBasicByHolders 会按成员作用域返回空数组，拿不到 id。
    D1 直查读的是同一份本地数据，且不受会话作用域影响。
    """
    try:
        rows = d1_query("SELECT id FROM credit_cards LIMIT 1;", database)
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        pass
    return None


async def capture_route(browser, route_key: str, cfg: dict, state: str, args, session_cookie):
    viewport = cfg["viewport"]
    ctx = await browser.new_context(
        viewport=viewport,
        device_scale_factor=DEVICE_SCALE,
        locale="zh-CN",
        timezone_id="Asia/Shanghai",
        bypass_csp=True,
        # 视觉回归要求可复现：冻结动画与过渡。
        # 项目 globals.css 已支持 prefers-reduced-motion，直接复用而不是注入 hack。
        reduced_motion="reduce",
        color_scheme="light",
    )
    if not cfg.get("anonymous") and session_cookie:
        await ctx.add_cookies([{
            "name": "wc_user",
            "value": session_cookie,
            "url": args.base_url,
            "httpOnly": True,
            "sameSite": "Lax",
        }])

    page = await ctx.new_page()
    rpc_log: list[str] = []
    await page.route("**/*", install_rpc_router(page, state, rpc_log))

    path = cfg["path"]
    if "{card_id}" in path:
        cid = args.card_id or args._card_id_cache
        if not cid:
            cid = resolve_card_id_from_d1()
            args._card_id_cache = cid
        if not cid:
            await ctx.close()
            return {"skipped": "no card id available for detail route"}
        path = path.replace("{card_id}", cid)
    if "{bill_id}" in path:
        bid = args.bill_id or args._bill_id_cache
        if not bid:
            bid = resolve_bill_id_from_d1()
            args._bill_id_cache = bid
        if not bid:
            await ctx.close()
            return {"skipped": "no bill id available for detail route"}
        path = path.replace("{bill_id}", bid)

    url = args.base_url.rstrip("/") + path
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    result = {"route": route_key, "state": state, "url": url, "viewport": viewport}
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        inter = (cfg.get("interaction") or {}).get(state)
        if inter:
            result["interaction"] = inter.get("note", "")
            for act in inter.get("actions", []):
                if "fill" in act:
                    sel, val = act["fill"]
                    try:
                        await page.fill(sel, val, timeout=8000)
                    except PWTimeout:
                        pass
                elif "click_text" in act:
                    try:
                        await page.get_by_role("button", name=re.compile(act["click_text"])).first.click(timeout=8000)
                    except Exception:
                        try:
                            await page.get_by_text(act["click_text"], exact=False).first.click(timeout=5000)
                        except Exception:
                            pass
                elif "sleep" in act:
                    await page.wait_for_timeout(act["sleep"])
        await wait_for_data(page, state)
        dom = await page.evaluate(EXTRACT_JS)

        # error 态的差异常常落在首屏之下（错误条 + 重试按钮）。
        # viewport 截图会漏掉它，导致 error 与 empty 看起来一样。
        # 这里先把错误元素滚入视野，让错误态证据可见。
        if state == "error":
            # 按「注入的错误消息」反查承载它的元素：类名选择器不可靠，
            # 这个页面的错误块没有 error 关键字类名。
            await page.evaluate(
                """
                (needle) => {
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                  while (walker.nextNode()) {
                    const t = (walker.currentNode.nodeValue || '').trim();
                    if (!t || !t.includes(needle)) continue;
                    const el = walker.currentNode.parentElement;
                    if (el) {
                      el.scrollIntoView({ block: 'center' });
                      return true;
                    }
                  }
                  // 退路：可见的 retry 按钮
                  for (const b of document.querySelectorAll('button,[role=button]')) {
                    if ((b.textContent || '').includes('重试')) {
                      b.scrollIntoView({ block: 'center' });
                      return true;
                    }
                  }
                  return false;
                }
                """,
                "baseline-forced-error",
            )
            await page.wait_for_timeout(700)

        # 冻结 CSS 动画 + 等字体就绪：shimmer 与 webfont 是视觉回归的两大噪声源。
        await page.add_style_tag(content="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}")
        try:
            await page.evaluate("() => document.fonts && document.fonts.ready")
        except Exception:
            pass
        await page.wait_for_timeout(300)

        shot_dir = SHOTS / route_key
        shot_dir.mkdir(parents=True, exist_ok=True)
        shot = shot_dir / f"{state}.png"
        await page.screenshot(path=str(shot), full_page=False)

        dom_dir = DOM / route_key
        dom_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            **result,
            "rpc": sorted(set(rpc_log)),
            "consoleErrors": console_errors[:20],
            **dom,
        }
        (dom_dir / f"{state}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        result.update({
            "screenshot": str(shot.relative_to(REPO)),
            "dom": str((dom_dir / f"{state}.json").relative_to(REPO)),
            "textCount": len(dom["texts"]),
            "skeleton": dom["markers"]["skeleton"],
            "alert": dom["markers"]["alert"],
            "rpcCount": len(set(rpc_log)),
            "consoleErrors": len(console_errors),
        })
    except Exception as exc:  # noqa: BLE001 — 基线脚本需要继续跑完其余路由
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        await ctx.close()
    return result


async def main():
    ap = argparse.ArgumentParser(description="WorldCredit 母版基线取证")
    ap.add_argument("--base-url", default=os.environ.get("WC_BASE_URL", "http://127.0.0.1:8787"))
    ap.add_argument("--only", nargs="*", choices=[*ROUTES, "all"], default=["all"])
    ap.add_argument("--states", nargs="*", choices=[*STATES, "all"], default=["all"])
    ap.add_argument("--card-id", default=None)
    ap.add_argument("--bill-id", default=None)
    ap.add_argument("--headed", action="store_true")
    ap.set_defaults(_card_id_cache=None)
    ap.set_defaults(_bill_id_cache=None)
    args = ap.parse_args()

    routes = list(ROUTES) if "all" in args.only else args.only
    states = list(STATES) if "all" in args.states else args.states

    secret = read_dev_var("SESSION_SECRET")
    session_cookie = None
    identity = None
    if secret:
        env_uid = os.environ.get("WC_USER_ID")
        if env_uid:
            identity = (env_uid, ADMIN_EMAIL, "胡波")
        else:
            identity = resolve_session_user()
            if not identity:
                identity = ("00000000-0000-4000-8000-000000000001", ADMIN_EMAIL, "胡波")
                print(
                    "! 本地 D1 没找到用户，退回占位 id；default 态会退化为空态",
                    file=sys.stderr,
                )
        session_cookie = mint_session(secret, user_id=identity[0], email=identity[1], name=identity[2])
        print(f"identity: {identity[1]} ({identity[0]})")
    else:
        print("! .dev.vars 缺少 SESSION_SECRET，认证路由将无法取证", file=sys.stderr)

    SHOTS.mkdir(parents=True, exist_ok=True)
    DOM.mkdir(parents=True, exist_ok=True)

    started = time.time()
    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headed)
        for route_key in routes:
            for state in states:
                r = await capture_route(browser, route_key, ROUTES[route_key], state, args, session_cookie)
                results.append(r)
                tag = "ERR " if r.get("error") or r.get("skipped") else "ok  "
                note = r.get("error") or r.get("skipped") or (
                    f"texts={r.get('textCount')} rpc={r.get('rpcCount')} "
                    f"skeleton={r.get('skeleton')} alert={r.get('alert')}"
                )
                print(f"{tag}{route_key:<14} {state:<8} {note}")
        await browser.close()

    index = {
        "baseUrl": args.base_url,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 1),
        "states": states,
        "routes": routes,
        "deterministic": {
            "fxFrozen": True,
            "reducedMotion": True,
            "animationsFrozen": True,
            "fontsAwaited": True,
            "deviceScaleFactor": DEVICE_SCALE,
            "colorScheme": "light",
        },
        "results": results,
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    failed = [r for r in results if r.get("error")]
    print(f"\n{len(results) - len(failed)}/{len(results)} captured → {OUT.relative_to(REPO)}")
    if failed:
        print(f"{len(failed)} route/state 失败，见 index.json", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
