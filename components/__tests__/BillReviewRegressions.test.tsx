// BillForm / PayableRow 行为回归测试：
// 1. BillForm 编辑已有账单：单次 updateBillFields（含 override 回显与 null 清空语义），不拆成两次非原子 RPC
// 2. PayableRow 整卡与内层按钮键盘事件互不劫持
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Bill, CreditCard, CardProduct } from "@/lib/types";
import type { PayableWithStatus } from "@/lib/api/payables";
import type { BillDashboardItem, CardWithBillsSummary } from "@/lib/api/bills";
import { BillsView, type BillsViewProps } from "@/components/obsidian/BillsView";

const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

vi.mock("@/lib/api/bills", () => ({
  createBill: vi.fn(),
  updateBill: vi.fn(),
  updateBillStatusChecked: vi.fn(),
  updateBillFields: vi.fn(),
  getBillByCardMonth: vi.fn(),
}));

vi.mock("@/lib/api/cards", () => ({
  getAllCardsWithProduct: vi.fn(),
}));

vi.mock("@/lib/api/ai", () => ({
  aiComplete: vi.fn(),
}));

import {
  createBill,
  updateBill,
  updateBillStatusChecked,
  updateBillFields,
  getBillByCardMonth,
} from "@/lib/api/bills";
import { getAllCardsWithProduct } from "@/lib/api/cards";
import { BillForm } from "@/components/mobile/BillForm";
import { PayableRow } from "@/components/mobile/PayableList";

const mockedCreateBill = vi.mocked(createBill);
const mockedUpdateBill = vi.mocked(updateBill);
const mockedUpdateBillStatusChecked = vi.mocked(updateBillStatusChecked);
const mockedUpdateBillFields = vi.mocked(updateBillFields);
const mockedGetBillByCardMonth = vi.mocked(getBillByCardMonth);
const mockedGetAllCards = vi.mocked(getAllCardsWithProduct);

function makeCardWithProduct(): CreditCard & { card_product: CardProduct; card_name?: string } {
  return {
    id: "card-1",
    holder_id: "holder-1",
    card_product_id: "prod-1",
    card_number_last4: "8888",
    credit_limit: 50000,
    billing_day: 5,
    status: "active",
    card_type: "credit",
    created_at: "2026-01-01T00:00:00Z",
    card_product: {
      id: "prod-1",
      country: "CN",
      bank_name: "招商银行",
      card_name: "经典白金卡",
      currency: "CNY",
      payment_due_type: "after_billing",
      payment_due_value: 20,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function makeExistingBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-existing",
    card_id: "card-1",
    bill_month: "2026-10",
    statement_start: "2026-09-06",
    statement_end: "2026-10-05",
    statement_date: "2026-10-05",
    bill_amount: 3200,
    min_payment: 320,
    due_date: "2026-10-25",
    status: "paid",
    created_at: "2026-10-06T00:00:00Z",
    ...overrides,
  };
}

function makePayable(overrides: Partial<PayableWithStatus> = {}): PayableWithStatus {
  return {
    id: "payable-1",
    created_by: "user-1",
    holder_id: null,
    name: "深圳房租",
    category: "rent",
    amount: 6500,
    currency: "CNY",
    due_day: 15,
    period: "2026-11",
    bank_account: "6222000011112222",
    note: null,
    is_active: 1,
    created_at: "2026-01-01T00:00:00Z",
    status: "unpaid",
    due_date: "2026-11-15",
    days_until_due: 12,
    paid_amount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAllCards.mockResolvedValue([makeCardWithProduct()]);
  mockedGetBillByCardMonth.mockResolvedValue(null);
});

describe("BillForm 编辑与更新闭环", () => {
  it("existingBill 编辑保存走单个 updateBillFields（回显 override，清空选填传 null），不调用 updateBill/updateBillStatusChecked", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const existing = makeExistingBill({
      bill_amount: 3600,
      bill_amount_override: 3600,
      min_payment: 320,
      min_payment_override: 500,
      statement_date: "2026-10-05",
      statement_date_override: "2026-10-06",
      due_date: "2026-10-25",
      due_date_override: "2026-10-28",
    });
    mockedUpdateBillFields.mockResolvedValue(existing);

    render(<BillForm open onClose={onClose} onSuccess={onSuccess} existingBill={existing} />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /招商银行/ })).toBeInTheDocument();
    });

    const amount = screen.getByLabelText(/账单金额/);
    const minPay = screen.getByLabelText(/最低还款额/);
    const statementDate = screen.getByLabelText(/账单日/);
    const dueDate = screen.getByLabelText(/还款到期日/);

    expect(amount).toHaveValue(3600);
    expect(minPay).toHaveValue(500);
    expect(statementDate).toHaveValue("2026-10-06");
    expect(dueDate).toHaveValue("2026-10-28");

    await user.clear(amount);
    await user.type(amount, "4100");
    await user.clear(minPay);
    await user.clear(statementDate);

    await user.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(mockedUpdateBillFields).toHaveBeenCalledTimes(1);
    });
    // 只提交改动过的字段：到期日未改，不得被钉成 override
    expect(mockedUpdateBillFields).toHaveBeenCalledWith("bill-existing", {
      amount: 4100,
      min_payment: null,
      statement_date: null,
    });
    expect(mockedUpdateBill).not.toHaveBeenCalled();
    expect(mockedUpdateBillStatusChecked).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("新建模式命中同卡同月已有账单后，更新也走单个 updateBillFields", async () => {
    const user = userEvent.setup();
    mockedGetBillByCardMonth.mockResolvedValue({
      id: "bill-dup",
      bill_amount: 1800,
      bill_amount_override: 1800,
      min_payment: 180,
      min_payment_override: null,
      statement_date: "2026-10-05",
      statement_date_override: null,
      due_date: "2026-10-25",
      due_date_override: null,
    });
    mockedUpdateBillFields.mockResolvedValue(makeExistingBill({ id: "bill-dup" }));

    render(<BillForm open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const cardSelect = await screen.findByLabelText(/信用卡/);
    await user.selectOptions(cardSelect, "card-1");

    await screen.findByText("当月账单已存在，将更新金额");
    // 改动一个字段：验证只提交变更项，不把其余字段钉成 override
    const amount = screen.getByLabelText(/账单金额/);
    await user.clear(amount);
    await user.type(amount, "1900");
    await user.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(mockedUpdateBillFields).toHaveBeenCalledWith("bill-dup", { amount: 1900 });
    });
    expect(mockedCreateBill).not.toHaveBeenCalled();
    expect(mockedUpdateBill).not.toHaveBeenCalled();
  });
});

describe("PayableRow 键盘交互边界", () => {
  it("焦点在内层「登记付款」或「复制账号」按钮按 Enter/Space 时不劫持为整卡编辑；焦点在卡片自身时触发编辑", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const onEdit = vi.fn();
    const onPay = vi.fn();
    const payable = makePayable();

    render(<PayableRow payable={payable} onEdit={onEdit} onPay={onPay} />);

    const payBtn = screen.getByRole("button", { name: "登记付款" });
    payBtn.focus();
    await user.keyboard("{Enter}");
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();

    await user.keyboard(" ");
    expect(onPay).toHaveBeenCalledTimes(2);
    expect(onEdit).not.toHaveBeenCalled();

    const copyBtn = screen.getByRole("button", { name: /账号/ });
    copyBtn.focus();
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith("6222000011112222");
    expect(onEdit).not.toHaveBeenCalled();

    const card = screen.getByRole("button", { name: "编辑固定支出 深圳房租" });
    card.focus();
    await user.keyboard("{Enter}");
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(card.tagName).toBe("BUTTON");
    expect(card.closest('[role="button"]')).toBeNull();
  });
});

function makeBillsViewFixture(): { props: BillsViewProps; unpaid: BillDashboardItem; paid: BillDashboardItem } {
  const card = makeCardWithProduct();
  const unpaid: BillDashboardItem = {
    ...makeExistingBill({ status: "partial", bill_amount_override: 3200 }),
    card,
    payments: [],
    paid_amount: 100,
    remaining_amount: 3100,
    days_until_due: 5,
    interest_free_days_left: 5,
    computed_status: "partial",
  };
  const paid: BillDashboardItem = {
    ...unpaid,
    id: "bill-paid",
    bill_month: "2026-09",
    status: "paid",
    computed_status: "paid",
    paid_amount: 3200,
    remaining_amount: 0,
  };
  const item: CardWithBillsSummary = {
    card,
    holder_id: card.holder_id,
    status: "partial",
    activeBill: unpaid,
    unpaidAmount: 3100,
    graceDays: 5,
    billingDay: 5,
    nextBillingDate: new Date(2026, 11, 5),
    nextDueDate: new Date(2026, 11, 25),
    historyBills: [unpaid, paid],
  };
  return {
    unpaid,
    paid,
    props: {
      syncing: false, onSync: vi.fn(), overdueCount: 0, overdueTotal: 0,
      overdueUnconverted: [], displayCurrency: "CNY", onPayAllOpen: vi.fn(),
      filtersOpen: false, onFiltersToggle: vi.fn(), filterSummary: "全部账单",
      activeFilterCount: 0, hasActiveFilter: false, onResetFilters: vi.fn(),
      entityType: "all", onEntityType: vi.fn(),
      statusKeys: [], onToggleStatus: vi.fn(), onClearStatuses: vi.fn(),
      statusCounts: { unpaid: 0, overdue: 0, unissued: 0, paid: 0 },
      entityCounts: { cards: 1, payables: 0 },
      tagCounts: { holders: {}, banks: {}, noBank: 0 },
      sortMode: "nearest_due", onSortMode: vi.fn(),
      dimension: "holder", onDimension: vi.fn(), selectedTag: "all", onSelectedTag: vi.fn(),
      holderTags: [], bankTags: [],
      loading: false, loadError: null, onRetry: vi.fn(), onEmptySync: vi.fn(),
      payables: [], onEditPayable: vi.fn(), onPayPayable: vi.fn(),
      payablePayments: {}, payableHistoryErrors: {}, payableHistoryLoading: new Set<string>(),
      expandedPayableIds: new Set<string>(),
      onTogglePayableHistory: vi.fn(), cards: [item],
      allCards: [item], holderMap: {}, bankGroups: [], onOpenPayment: vi.fn(),
      onManualAmount: vi.fn(), onAddBill: vi.fn(),
    },
  };
}

describe("BillsView 键盘导航边界", () => {
  it("历史账单编辑、登记还款、修改金额各自响应键盘，不跳到父卡详情；标题仍能进入卡片详情", async () => {
    const user = userEvent.setup();
    const { props, unpaid } = makeBillsViewFixture();
    render(<BillsView {...props} />);

    screen.getByRole("button", { name: "修改金额" }).focus();
    await user.keyboard("{Enter}");
    expect(props.onManualAmount).toHaveBeenCalledWith(props.cards[0]);
    expect(routerPush).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /历史账单明细/ }).focus();
    await user.keyboard(" ");
    expect(routerPush).not.toHaveBeenCalled();
    const editButtons = screen.getAllByRole("button", { name: "编辑" });
    editButtons[0].focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(routerPush.mock.calls).toEqual([["/bills/bill-existing"], ["/bills/bill-existing"]]);
    expect(props.onOpenPayment).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "登记 2026-10 期账单还款" }).focus();
    await user.keyboard("{Enter}");
    expect(props.onOpenPayment).toHaveBeenCalledWith(unpaid);
    expect(routerPush).toHaveBeenCalledTimes(2);

    // 行容器不再是点击目标：已结清期无按钮，未结清期走内部真实按钮
    const paidRow = screen.getByText("2026-09 期账单").parentElement?.parentElement;
    expect(paidRow).not.toHaveClass("cursor-pointer");
    expect(paidRow).not.toHaveClass("cursor-default");
    expect(screen.getByText("2026-09 期账单").closest("button")).toBeNull();
    editButtons[1].focus();
    await user.keyboard("{Enter}");
    expect(routerPush).toHaveBeenLastCalledWith("/bills/bill-paid");

    const cardButton = screen.getByRole("button", { name: "查看 招商银行 卡片详情" });
    cardButton.focus();
    await user.keyboard("{Enter}");
    expect(routerPush).toHaveBeenLastCalledWith("/cards/card-1");
    expect(cardButton.tagName).toBe("BUTTON");
    expect(document.querySelector('[role="button"] button, button button')).toBeNull();
  });

  it("BillsView 提供合并账单入口并响应点击", async () => {
    const user = userEvent.setup();
    const { props } = makeBillsViewFixture();
    const onMergeCards = vi.fn();
    render(<BillsView {...props} onMergeCards={onMergeCards} />);

    const mergeBtn = screen.getByRole("button", { name: "合并账单" });
    expect(mergeBtn).toBeInTheDocument();
    await user.click(mergeBtn);
    expect(onMergeCards).toHaveBeenCalledTimes(1);
  });
});
