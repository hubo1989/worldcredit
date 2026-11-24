"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getBillDashboardItems,
  markBillAsPaid,
  markAllOverdueBillsAsPaid,
  type BillDashboardItem,
} from "@/lib/api/bills";
import { getHolders } from "@/lib/api/holders";
import { getCardsBasicByHolders } from "@/lib/api/cards";
import {
  getRecurringPayables,
  payRecurringPayable,
  type PayableWithStatus,
} from "@/lib/api/payables";
import { getUnreadNotificationCount } from "@/lib/api/notifications";
import {
  type HolderFilter,
  type FutureRange,
  billCurrency,
  computeMetrics,
  countCardsByHolder,
  formatMoney,
  payableRemaining,
} from "@/lib/dashboard-metrics";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { fetchRates, type FxRates } from "@/lib/fx";
import { resolveDisplayCurrency } from "@/lib/api/preferences.shared";
import { useAuth } from "@/lib/auth";
import { getOpportunityTodayCount } from "@/lib/api/dashboard";
import { loadReminders } from "@/components/opportunities/ReminderList";
import { QuickActionSheet } from "@/components/mobile/QuickActionSheet";
import { consumeNativeQuickActionUrl, type NativeQuickAction } from "@/lib/native-action";
import { DashboardView } from "@/components/obsidian/DashboardView";
import { DashboardOverlays } from "@/components/obsidian/DashboardOverlays";
import { computeThreePartDebtBreakdown } from "@/lib/direction3/pure";
import { getInstallmentPlans } from "@/lib/direction3/rpc";
import type { InstallmentPlanWithSummary } from "@/lib/direction3/types";
import {
  EyeIcon,
  EyeOffIcon,
  NoteIcon,
  PromoIcon,
  BenefitIcon,
  ImportIcon,
} from "@/components/icons/WcIcon";
import type { CardHolder } from "@/lib/types";

/** 金刚区项 */
interface QuickAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { displayConfig, togglePrivacyMode } = useUserPreferences();
  const router = useRouter();

  /** 折算目标币种：用户偏好 display_config.default_currency（缺省 CNY）。 */
  const displayCurrency = resolveDisplayCurrency(displayConfig);
  /** 汇率状态：null 表示这次没取到，界面走「未含汇率」的降级展示。 */
  const [fxRates, setFxRates] = useState<FxRates | null>(null);

  // ---- 数据状态 ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holders, setHolders] = useState<CardHolder[]>([]);
  const [bills, setBills] = useState<BillDashboardItem[]>([]);
  const [payables, setPayables] = useState<PayableWithStatus[]>([]);
  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlanWithSummary[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [cards, setCards] = useState<Array<{ id: string; holder_id: string }>>([]);
  const unreadSyncedRef = useRef(false);

  // ---- 交互状态 ----
  const [holderFilter, setHolderFilter] = useState<HolderFilter>("all");
  const [futureRange, setFutureRange] = useState<FutureRange>(7);
  const [debtExpanded, setDebtExpanded] = useState(false);
  const [quickSheetOpen, setQuickSheetOpen] = useState(false);
  /** 原生 DashboardWebView 桥：?native_action=bill|card 直达录入/加卡表单 */
  const [quickInitialAction, setQuickInitialAction] = useState<NativeQuickAction | null>(null);
  // 优惠入口：P0 起不再展示“可享数量”——当前接口只能给有效活动总数，
  // 不能证明持卡资格，数字会误导。可信计数待 Task 11 统一查询接入后恢复。
  const [promoCount, setPromoCount] = useState<number | null>(null);
  const [urgentReminders, setUrgentReminders] = useState<
    Array<{
      event: {
        event_key: string;
        kind: string;
        title: string;
        local_date_on: string;
        action_hint: string;
      };
    }>
  >([]);

  // 一键还款与 Toast 状态
  const [payAllOpen, setPayAllOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payingPayableId, setPayingPayableId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "info" | "error";
  }>({
    open: false,
    message: "",
    severity: "success",
  });

  const privacyOn = !!displayConfig.privacy_mode;
  const blurClass = privacyOn ? "privacy-blur" : "privacy-clear";

  // ---- 数据加载 ----
  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) return;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    const shouldSyncUnread = !unreadSyncedRef.current;
    try {
      // 并行：持卡人 / 账单 / 固定支出 / 未读通知数 / 活跃分期；卡片依赖持卡人 id
      const [holderList, allBills, payableList, unreadCount, activeInstallments] = await Promise.all([
        getHolders(user.id),
        getBillDashboardItems(200, user.id),
        getRecurringPayables(user.id).catch((err) => {
          console.warn("[dashboard] Failed to load recurring payables:", err);
          if (!silent) {
            setToast({
              open: true,
              message: "固定支出加载失败，当日待还金额暂不含固定支出",
              severity: "info",
            });
          }
          return [];
        }),
        getUnreadNotificationCount(shouldSyncUnread)
          .then((count) => {
            if (shouldSyncUnread) unreadSyncedRef.current = true;
            return count;
          })
          .catch((err) => {
            console.warn("[dashboard] Failed to load unread notification count:", err);
            return 0;
          }),
        getInstallmentPlans({ status: "active" }).catch(() => [] as InstallmentPlanWithSummary[]),
      ]);
      holderList.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const holderIds = holderList.map((h) => h.id);
      const cardsRes = holderIds.length > 0 ? await getCardsBasicByHolders(holderIds) : [];

      setHolders(holderList);
      setCards(cardsRes);
      setBills(allBills);
      setPayables(payableList);
      setInstallmentPlans(Array.isArray(activeInstallments) ? activeInstallments : []);
      setUnreadNotificationCount(unreadCount);
    } catch (err) {
      console.error("Dashboard load failed:", err);
      setError(err instanceof Error ? err.message : "加载失败，请下拉重试");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 原生快捷动作桥：?native_action=bill|card 打开 QuickActionSheet 对应子动作。
  // 与 promos 页一致直接读 window.location.search，避免 useSearchParams 的构建期 Suspense 边界。
  // 消费后立即清理该 query：否则刷新/重挂载会重复弹表单（原生侧约定由 Web 清理）。
  useEffect(() => {
    const { action, nextUrl } = consumeNativeQuickActionUrl(window.location.href);
    if (!action || !nextUrl) return;
    window.history.replaceState(null, "", nextUrl);
    setQuickInitialAction(action);
    setQuickSheetOpen(true);
  }, []);

  // 汇率与业务数据解耦：拿不到也不该让整页失败，只是合计里少了外币部分。
  useEffect(() => {
    let cancelled = false;
    fetchRates()
      .then((rates) => {
        if (!cancelled) setFxRates(rates);
      })
      .catch(() => {
        if (!cancelled) setFxRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 今天可用机会数（Task 11/12）：与 /promos 同一服务端口径；失败显示入口
  // 文案而不是假数字，绝不回退目录总数。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getOpportunityTodayCount()
      .then((n) => {
        if (!cancelled) setPromoCount(n);
      })
      .catch(() => {
        if (!cancelled) setPromoCount(null);
      });
    void loadReminders()
      .then((items) => {
        if (!cancelled) setUrgentReminders(items.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setUrgentReminders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handlePaySingle = async (e: React.MouseEvent, bill: BillDashboardItem) => {
    e.stopPropagation();
    try {
      const amount = bill.remaining_amount > 0 ? bill.remaining_amount : Number(bill.bill_amount);
      await markBillAsPaid(bill.id, amount);
      // 单张账单金额用自己的币种展示，不能挂人民币符号
      setToast({
        open: true,
        message: `🎉 已成功结清 ${bill.card?.card_product?.bank_name || ""} 账单（${formatMoney(amount, billCurrency(bill, displayCurrency))}）！`,
        severity: "success",
      });
      loadData();
    } catch (err) {
      setToast({
        open: true,
        message: "还款失败: " + (err instanceof Error ? err.message : String(err)),
        severity: "error",
      });
    }
  };

  const handlePayPayable = async (e: React.MouseEvent, payable: PayableWithStatus) => {
    e.stopPropagation();
    if (payingPayableId === payable.id) return;
    const remaining = payableRemaining(payable);
    if (remaining <= 0) return;
    setPayingPayableId(payable.id);
    try {
      await payRecurringPayable(payable.id, remaining);
      setToast({
        open: true,
        message: `🎉 已登记 ${payable.name} 本期付款（${formatMoney(remaining, payable.currency || displayCurrency)}）！`,
        severity: "success",
      });
      await loadData({ silent: true });
    } catch (err) {
      setToast({
        open: true,
        message: "登记付款失败: " + (err instanceof Error ? err.message : String(err)),
        severity: "error",
      });
    } finally {
      setPayingPayableId((curr) => (curr === payable.id ? null : curr));
    }
  };

  const handlePayAllOverdue = async () => {
    if (!user?.id) return;
    setPaying(true);
    try {
      const res = await markAllOverdueBillsAsPaid(user.id, metrics.overdueBills);
      setPayAllOpen(false);
      // 展示口径用界面已折算好的 metrics.overdueAmount：服务端返回的 totalAmount
      // 仍是跨币种直接相加的老口径（那是 bills.server.ts，本次不改）。
      setToast({
        open: true,
        message: `🎉 恭喜！已一键全额结清 ${res.count} 笔逾期账单（合计 ${formatMoney(metrics.overdueAmount, displayCurrency)}）！`,
        severity: "success",
      });
      await loadData();
    } catch (err) {
      setToast({
        open: true,
        message: "一键还款失败: " + (err instanceof Error ? err.message : String(err)),
        severity: "error",
      });
    } finally {
      setPaying(false);
    }
  };

  // ---- 派生数据 ----

  // 传给视图层的具名回调：保持渲染与状态更新的关系一目了然。
  const toggleDebtExpanded = useCallback(() => setDebtExpanded((v) => !v), []);
  const openPayAllConfirm = useCallback(() => setPayAllOpen(true), []);
  const closePayAllConfirm = useCallback(() => setPayAllOpen(false), []);
  const closeQuickSheet = useCallback(() => {
    setQuickSheetOpen(false);
    setQuickInitialAction(null);
  }, []);
  const closeToast = useCallback(() => setToast((prev) => ({ ...prev, open: false })), []);
  const goToBills = useCallback(() => router.push("/bills"), [router]);
  const goToPromos = useCallback(() => router.push("/promos"), [router]);
  const goToCashflowForecast = useCallback(() => router.push("/analytics#cashflow"), [router]);
  const goToNotifications = useCallback(() => router.push("/notifications"), [router]);

  // 当前选中持卡人下的账单
  const visibleBills = useMemo(() => {
    if (holderFilter === "all") return bills;
    return bills.filter((b) => b.card?.holder_id === holderFilter);
  }, [bills, holderFilter]);

  // 当前选中持卡人下的固定支出
  const visiblePayables = useMemo(() => {
    if (holderFilter === "all") return payables;
    return payables.filter((p) => p.holder_id === holderFilter);
  }, [payables, holderFilter]);

  // 当前选中持卡人下的卡片
  const visibleCards = useMemo(() => {
    if (holderFilter === "all") return cards;
    return cards.filter((c) => c.holder_id === holderFilter);
  }, [cards, holderFilter]);

  const metrics = useMemo(
    () => computeMetrics(visibleBills, futureRange, displayCurrency, fxRates, visiblePayables),
    [visibleBills, futureRange, displayCurrency, fxRates, visiblePayables],
  );

  const visibleInstallmentPlans = useMemo(() => {
    if (holderFilter === "all") return installmentPlans;
    const cardIds = new Set(visibleCards.map((c) => c.id));
    return installmentPlans.filter(
      (p) => p.holder_id === holderFilter || cardIds.has(p.card_id),
    );
  }, [installmentPlans, holderFilter, visibleCards]);

  const debtBreakdown = useMemo(
    () =>
      computeThreePartDebtBreakdown({
        bills: visibleBills,
        payables: visiblePayables,
        installmentPlans: visibleInstallmentPlans,
        targetCurrency: displayCurrency,
        rates: fxRates,
      }),
    [visibleBills, visiblePayables, visibleInstallmentPlans, displayCurrency, fxRates],
  );

  const cardsByHolder = useMemo(() => countCardsByHolder(cards), [cards]);
  const totalCardCount = cards.length;

  // 隐私脱敏：金额整体模糊
  const amountClass = `${blurClass} num-tabular`;

  // ---- 渲染辅助 ----

  /** 持卡人分段标签：全部 + 各持卡人姓名首字 */
  const holderPills = useMemo(() => {
    const items: Array<{ value: HolderFilter; label: string; fullName?: string }> = [
      { value: "all", label: "全部" },
    ];
    for (const h of holders) {
      const first = (h.name || "?").trim().charAt(0).toUpperCase();
      items.push({ value: h.id, label: first, fullName: h.name });
    }
    return items;
  }, [holders]);

  /** 金刚区 4 项 */
  const quickActions: QuickAction[] = [
    {
      key: "note",
      label: "记一笔",
      icon: <NoteIcon size={26} />,
      // 手动入口清掉原生直达标记，保持既有三选单默认行为
      onClick: () => {
        setQuickInitialAction(null);
        setQuickSheetOpen(true);
      },
    },
    {
      key: "promo",
      label: "优惠",
      icon: <PromoIcon size={26} />,
      onClick: () => router.push("/promos"),
    },
    {
      key: "benefit",
      label: "权益",
      icon: <BenefitIcon size={26} />,
      onClick: () => router.push("/benefits"),
    },
    {
      key: "import",
      label: "邮箱账单",
      icon: <ImportIcon size={26} />,
      onClick: () => router.push("/gmail-ledger"),
    },
  ];

  // visibleCards 仅用于未来潜在展示，这里消费一下避免 lint 警告
  void visibleCards;

  // ---- 加载态：骨架屏 ----
  if (loading) {
    return (
      <div className="obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-5 text-d-text">
        <div className="mb-4 space-y-2">
          <div className="wc-skeleton h-9 w-40 rounded-lg" />
          <div className="wc-skeleton h-3.5 w-24 rounded" />
        </div>
        <div className="wc-skeleton mb-4 h-10 w-full rounded-full" />
        <div className="wc-skeleton mb-4 h-[140px] w-full rounded-xl" />
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="wc-skeleton h-24 rounded-xl" />
          <div className="wc-skeleton h-24 rounded-xl" />
          <div className="wc-skeleton h-24 rounded-xl" />
          <div className="wc-skeleton h-24 rounded-xl" />
        </div>
        <div className="space-y-3">
          <div className="wc-skeleton h-[72px] w-full rounded-xl" />
          <div className="wc-skeleton h-[72px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <>
      <DashboardView
        metrics={metrics}
        holderPills={holderPills}
        holderFilter={holderFilter}
        onHolderFilter={setHolderFilter}
        futureRange={futureRange}
        onFutureRange={setFutureRange}
        debtExpanded={debtExpanded}
        onDebtExpanded={toggleDebtExpanded}
        privacyOn={privacyOn}
        privacyIcon={privacyOn ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
        onTogglePrivacy={togglePrivacyMode}
        amountClass={amountClass}
        displayCurrency={displayCurrency}
        onPaySingle={handlePaySingle}
        onPayPayable={handlePayPayable}
        payingPayableId={payingPayableId}
        onPayAllOpen={openPayAllConfirm}
        onNavBills={goToBills}
        onNavPromos={goToPromos}
        onNavCashflowForecast={goToCashflowForecast}
        onNavNotifications={goToNotifications}
        debtBreakdown={debtBreakdown}
        unreadNotificationCount={unreadNotificationCount}
        totalCardCount={totalCardCount}
        holders={holders}
        cardsByHolder={cardsByHolder}
        quickActions={quickActions}
        promoCount={promoCount}
        urgentReminders={urgentReminders}
        userName={user?.name ?? null}
        userEmail={user?.email ?? null}
      />

      {/* 还款确认 / Toast / 加载失败重试：保持原有交互，不随视图重写而丢失 */}
      <DashboardOverlays
        metrics={metrics}
        displayCurrency={displayCurrency}
        formatMoney={formatMoney}
        payAllOpen={payAllOpen}
        onPayAllClose={closePayAllConfirm}
        onPayAllConfirm={handlePayAllOverdue}
        paying={paying}
        toast={toast}
        onToastClose={closeToast}
        error={error}
        onRetry={() => void loadData()}
      />

      <QuickActionSheet
        open={quickSheetOpen}
        onClose={closeQuickSheet}
        onChanged={() => void loadData({ silent: true })}
        initialAction={quickInitialAction}
      />
    </>
  );
}
