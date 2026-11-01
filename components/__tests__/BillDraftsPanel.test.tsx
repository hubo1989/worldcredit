// BillDraftsPanel 字段编辑流程测试：
// 1. 编辑金额保存后调 updateBillImportDraft 且刷新草稿列表
// 2. 非法月份/日期被前端校验拦截（不发起请求）
// 3. 取消不发送请求
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// jest-dom 扩展 toBeInTheDocument 等 chai 匹配器（vitest 环境下走 @vitest/expect 桥）
import "@testing-library/jest-dom/vitest";
import { BillDraftsPanel } from "@/components/mobile/BillDraftsPanel";
import { validateDraftFields } from "@/components/mobile/BillDraftEditForm";
import type { BillImportDraft } from "@/lib/api/billDrafts";

vi.mock("@/lib/api/billDrafts", () => ({
  getBillImportDrafts: vi.fn(),
  confirmBillImportDraft: vi.fn(),
  discardBillImportDraft: vi.fn(),
  updateBillImportDraft: vi.fn(),
}));

vi.mock("@/lib/api/bills", () => ({
  getCardsWithBillsSummary: vi.fn().mockResolvedValue([]),
}));

import { getBillImportDrafts, updateBillImportDraft } from "@/lib/api/billDrafts";

const mockedGetDrafts = vi.mocked(getBillImportDrafts);
const mockedUpdate = vi.mocked(updateBillImportDraft);

function makeDraft(overrides: Partial<BillImportDraft> = {}): BillImportDraft {
  return {
    id: "draft-1",
    created_by: "user-1",
    card_id: null,
    source_type: "email",
    raw_text: null,
    file_ref: null,
    parsed_payload: {
      bill_month: "2026-10",
      bill_amount: 4860.5,
      min_payment: 486.05,
      statement_date: "2026-10-26",
      due_date: "2026-11-24",
    },
    status: "draft",
    confidence: 0.9,
    created_at: "2026-10-27T08:00:00Z",
    confirmed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateDraftFields", () => {
  const base = {
    bill_amount: "100",
    min_payment: "",
    bill_month: "2026-10",
    due_date: "2026-11-24",
    statement_date: "",
  };

  it("通过合法值", () => {
    expect(validateDraftFields(base)).toEqual({});
  });

  it("拒绝负数、非数字与空金额", () => {
    expect(validateDraftFields({ ...base, bill_amount: "-1" }).bill_amount).toBeTruthy();
    expect(validateDraftFields({ ...base, bill_amount: "abc" }).bill_amount).toBeTruthy();
    expect(validateDraftFields({ ...base, bill_amount: "" }).bill_amount).toBeTruthy();
  });

  it("拒绝非法月份格式", () => {
    expect(validateDraftFields({ ...base, bill_month: "2026/10" }).bill_month).toBeTruthy();
    expect(validateDraftFields({ ...base, bill_month: "2026-13" }).bill_month).toBeTruthy();
    expect(validateDraftFields({ ...base, bill_month: "" }).bill_month).toBeTruthy();
  });

  it("拒绝不存在的日历日期", () => {
    expect(validateDraftFields({ ...base, due_date: "2026-02-30" }).due_date).toBeTruthy();
    expect(validateDraftFields({ ...base, due_date: "2026-11-31" }).due_date).toBeTruthy();
    expect(
      validateDraftFields({ ...base, statement_date: "2026-13-01" }).statement_date,
    ).toBeTruthy();
  });
});

describe("BillDraftsPanel 编辑字段流程", () => {
  it("编辑金额后保存：调 updateBillImportDraft（带合并后的 parsed_payload）并刷新列表", async () => {
    const user = userEvent.setup();
    const draft = makeDraft();
    mockedGetDrafts
      .mockResolvedValueOnce([draft])
      .mockResolvedValueOnce([
        { ...draft, parsed_payload: { ...draft.parsed_payload, bill_amount: 5200 } },
      ]);
    mockedUpdate.mockResolvedValueOnce({ ...draft });

    render(<BillDraftsPanel />);

    await screen.findByText(/待确认导入草稿/);
    await user.click(screen.getByRole("button", { name: "编辑字段" }));
    await screen.findByText("编辑草稿字段");

    const amountInput = screen.getByLabelText(/账单金额/);
    await user.clear(amountInput);
    await user.type(amountInput, "5200");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockedUpdate).toHaveBeenCalledWith("draft-1", {
      parsed_payload: expect.objectContaining({
        bill_amount: 5200,
        bill_month: "2026-10",
        due_date: "2026-11-24",
        min_payment: 486.05,
        statement_date: "2026-10-26",
      }),
    });
    // 刷新后表单关闭
    await waitFor(() => {
      expect(screen.queryByText("编辑草稿字段")).not.toBeInTheDocument();
    });
    expect(mockedGetDrafts).toHaveBeenCalledTimes(2);
  });

  it("非法/被清空的月份与日期被前端校验拦截，不发起保存请求", async () => {
    const user = userEvent.setup();
    mockedGetDrafts.mockResolvedValue([makeDraft()]);

    render(<BillDraftsPanel />);
    await screen.findByText(/待确认导入草稿/);

    await user.click(screen.getByRole("button", { name: "编辑字段" }));
    await screen.findByText("编辑草稿字段");

    // jsdom 对 type=month/date 输入做值净化，非法字面量（2026/13、2026-02-30）
    // 会被浏览器层吞成空串——行为上等价于必填拦截；非法格式本身由上面
    // validateDraftFields 的单测覆盖。
    await user.clear(screen.getByLabelText(/账单月份/));
    await user.clear(screen.getByLabelText(/还款到期日/));

    await user.click(screen.getByRole("button", { name: "保存" }));

    // 校验错误横幅可见，且没有发出任何写请求
    expect(await screen.findByText("请先修正标红的字段再保存")).toBeInTheDocument();
    expect(screen.getByText("请填写账单月份")).toBeInTheDocument();
    expect(screen.getByText("请填写还款到期日")).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("取消关闭弹窗且不发送请求", async () => {
    const user = userEvent.setup();
    mockedGetDrafts.mockResolvedValue([makeDraft()]);

    render(<BillDraftsPanel />);
    await screen.findByText(/待确认导入草稿/);

    await user.click(screen.getByRole("button", { name: "编辑字段" }));
    await screen.findByText("编辑草稿字段");

    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByText("编辑草稿字段")).not.toBeInTheDocument();
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
