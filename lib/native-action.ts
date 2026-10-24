/**
 * 原生 DashboardWebView 快捷动作桥（?native_action=）。
 *
 * 原生 createBill/createCard 入口固定打开 /dashboard?native_action=bill|card，
 * Web 收到后直达 QuickActionSheet 的录入账单 / 添加卡片表单。
 * 未部署本查询参数支持时，旧 Web 会忽略未知 query，仅打开 dashboard（无直达表单）。
 */
export type NativeQuickAction = "bill" | "card";

/** 只认 bill/card；其余（含空、任意注入值）一律返回 null，保持既有默认行为。 */
export function parseNativeQuickAction(value: string | null | undefined): NativeQuickAction | null {
  return value === "bill" || value === "card" ? value : null;
}
