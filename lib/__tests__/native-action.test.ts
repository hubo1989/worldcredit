import { describe, expect, it } from "vitest";
import { consumeNativeQuickActionUrl, parseNativeQuickAction } from "../native-action";

describe("parseNativeQuickAction（原生桥接 query）", () => {
  it("接受 bill / card 两种原生快捷动作", () => {
    expect(parseNativeQuickAction("bill")).toBe("bill");
    expect(parseNativeQuickAction("card")).toBe("card");
  });

  it("空值与未知值不触发直达，保持既有默认行为", () => {
    expect(parseNativeQuickAction(null)).toBeNull();
    expect(parseNativeQuickAction(undefined)).toBeNull();
    expect(parseNativeQuickAction("")).toBeNull();
    expect(parseNativeQuickAction("payment")).toBeNull();
    expect(parseNativeQuickAction("Bill")).toBeNull();
    expect(parseNativeQuickAction("bill;card")).toBeNull();
    expect(parseNativeQuickAction("<script>")).toBeNull();
  });

  it("消费有效 native_action 后从 URL 清除该参数并保留其余 query", () => {
    expect(
      consumeNativeQuickActionUrl("https://app.all-bill.com/dashboard?native_action=bill"),
    ).toEqual({
      action: "bill",
      nextUrl: "/dashboard",
    });
    expect(
      consumeNativeQuickActionUrl(
        "https://app.all-bill.com/dashboard?tab=1&native_action=card#top",
      ),
    ).toEqual({
      action: "card",
      nextUrl: "/dashboard?tab=1#top",
    });
    expect(
      consumeNativeQuickActionUrl("https://app.all-bill.com/dashboard?native_action=unknown"),
    ).toEqual({
      action: null,
      nextUrl: null,
    });
  });
});
