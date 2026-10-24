"use client";

import { useEffect, useState, useCallback } from "react";
import { BottomSheet, Toast } from "@/components/obsidian/overlays";
import {
  NoteIcon,
  CheckIcon,
  CardIcon,
  ChevronRightIcon,
  UserIcon,
} from "@/components/icons/WcIcon";
import { BillForm } from "./BillForm";
import { PaymentForm } from "./PaymentForm";
import { CardForm } from "./CardForm";
import { getHolders } from "@/lib/api/holders";
import { createPayment, updateBillStatus, getUnpaidBills, getPaymentTotal } from "@/lib/api/bills";
import { createCard } from "@/lib/api/cards";
import { type NativeQuickAction } from "@/lib/native-action";
import type { CardHolder, CreditCard } from "@/lib/types";

/**
 * 记一笔 ActionSheet（§5.2）。
 * 首页金刚区「记一笔」触发，三个选项：录入账单 / 记还款 / 添加卡片。
 * 添加卡片需要持卡人，故内置一个持卡人选择子步。
 *
 * initialAction：原生 DashboardWebView 快捷桥（?native_action=bill|card）。
 * 传入后跳过三选单，直达对应真实表单（录入账单 / 添加卡片），无假按钮；
 * 不传时保持既有默认行为（先展示三选单）。
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** 录入/还款/加卡成功后的回调（通常刷新列表） */
  onChanged?: () => void;
  /** 直达子动作：'bill'=录入账单，'card'=添加卡片 */
  initialAction?: NativeQuickAction | null;
}

export function QuickActionSheet({ open, onClose, onChanged, initialAction }: Props) {
  const [billFormOpen, setBillFormOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cardFormOpen, setCardFormOpen] = useState(false);

  // 还款需要先选账单：这里做一个简易选择，从所有未还账单中挑
  const [holders, setHolders] = useState<CardHolder[]>([]);
  const [holdersLoaded, setHoldersLoaded] = useState(false);
  const [holderPickerOpen, setHolderPickerOpen] = useState(false);
  const [pickedHolder, setPickedHolder] = useState<CardHolder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 尚未消费的原生直达动作；非空时隐藏三选单，避免菜单闪现 */
  const [pendingAction, setPendingAction] = useState<NativeQuickAction | null>(null);

  // 还款选择账单相关
  const [unpaidBills, setUnpaidBills] = useState<
    Array<{ id: string; bill_month: string; bill_amount: number }>
  >([]);
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [pickedBill, setPickedBill] = useState<{
    id: string;
    bill_month: string;
    bill_amount: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHoldersLoaded(false);
    getHolders()
      .then((rows) => {
        if (cancelled) return;
        setHolders(rows);
        setHoldersLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHolders([]);
        setHoldersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const startBill = useCallback(() => {
    setBillFormOpen(true);
  }, []);

  const startCard = useCallback(() => {
    if (holders.length === 0) {
      setNotice("还没有持卡人，请先到「我的 → 家庭管理」添加");
      return;
    }
    if (holders.length === 1) {
      setPickedHolder(holders[0]);
      setCardFormOpen(true);
    } else {
      setHolderPickerOpen(true);
    }
  }, [holders]);

  // 原生 ?native_action=bill|card：打开即直达真实表单（card 等持卡人加载完成）
  useEffect(() => {
    if (!open) {
      setPendingAction(null);
      return;
    }
    setPendingAction(initialAction ?? null);
  }, [open, initialAction]);

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction === "bill") {
      setPendingAction(null);
      startBill();
      return;
    }
    // 加卡依赖持卡人列表，等加载结束后再进入真实流程
    if (!holdersLoaded) return;
    setPendingAction(null);
    startCard();
  }, [pendingAction, holdersLoaded, startBill, startCard]);

  const closeAll = () => {
    setBillFormOpen(false);
    setPaymentOpen(false);
    setCardFormOpen(false);
    setHolderPickerOpen(false);
    setBillPickerOpen(false);
    setPickedHolder(null);
    setPickedBill(null);
    onClose();
  };

  const handlePickBill = async () => {
    // 拉取未还账单供选择
    try {
      setUnpaidBills(await getUnpaidBills());
      setBillPickerOpen(true);
    } catch (err) {
      setNotice("加载账单失败：" + (err instanceof Error ? err.message : "未知错误"));
    }
  };

  const handlePaymentSubmit = async (data: { amount: number; paid_at: string; note?: string }) => {
    if (!pickedBill) return;
    await createPayment({
      bill_id: pickedBill.id,
      amount: data.amount,
      paid_at: data.paid_at,
      channel: "手动还款",
      note: data.note,
    });
    // 重算状态
    const totalPaid = await getPaymentTotal(pickedBill.id);
    const billAmount = Number(pickedBill.bill_amount);
    let status: "unpaid" | "partial" | "paid" | "overdue" = "unpaid";
    if (totalPaid >= billAmount && billAmount > 0) status = "paid";
    else if (totalPaid > 0) status = "partial";
    await updateBillStatus(pickedBill.id, status);
    onChanged?.();
  };

  const handleCardSubmit = async (data: Omit<CreditCard, "id" | "created_at">) => {
    if (!pickedHolder) return;
    const created = await createCard({
      holder_id: pickedHolder.id,
      card_product_id: data.card_product_id,
      card_number_last4: data.card_number_last4 || undefined,
      credit_limit: Number(data.credit_limit) || 0,
      billing_day: Number(data.billing_day) || 1,
      card_type: "credit",
      status: "active",
    });
    onChanged?.();
    void created;
  };

  const options = [
    {
      key: "bill",
      title: "录入账单",
      desc: "手动录入一张账单，支持粘贴邮件 / 短信智能填充",
      icon: <NoteIcon size={20} />,
      onClick: startBill,
    },
    {
      key: "payment",
      title: "记还款",
      desc: "选择未还账单登记一笔还款",
      icon: <CheckIcon size={20} />,
      onClick: () => handlePickBill(),
    },
    {
      key: "card",
      title: "添加卡片",
      desc: "为持卡人新增一张信用卡",
      icon: <CardIcon size={20} />,
      onClick: startCard,
    },
  ];

  return (
    <>
      <BottomSheet
        open={
          open &&
          !pendingAction &&
          !billFormOpen &&
          !paymentOpen &&
          !cardFormOpen &&
          !holderPickerOpen &&
          !billPickerOpen
        }
        title="记一笔"
        onClose={closeAll}
      >
        <div className="flex flex-col gap-1">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={opt.onClick}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors active:bg-d-subtle"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-d-subtle text-d-accent-light">
                {opt.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-5 text-d-text">
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-4 text-d-muted">{opt.desc}</span>
              </span>
              <ChevronRightIcon size={18} className="shrink-0 text-d-muted" />
            </button>
          ))}
          <div className="h-2" />
        </div>
      </BottomSheet>

      {/* 持卡人选择子步 */}
      <BottomSheet
        open={holderPickerOpen}
        title="选择持卡人"
        onClose={() => setHolderPickerOpen(false)}
      >
        <div className="flex flex-col gap-1">
          {holders.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                setPickedHolder(h);
                setHolderPickerOpen(false);
                setCardFormOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors active:bg-d-subtle"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-d-subtle text-d-accent-light">
                <UserIcon size={20} />
              </span>
              <span className="flex-1 text-[15px] font-semibold leading-5 text-d-text">
                {h.name}
              </span>
              <ChevronRightIcon size={18} className="shrink-0 text-d-muted" />
            </button>
          ))}
          <div className="h-2" />
        </div>
      </BottomSheet>

      {/* 账单选择子步 */}
      <BottomSheet
        open={billPickerOpen}
        title="选择要还款的账单"
        onClose={() => setBillPickerOpen(false)}
      >
        <div className="flex flex-col gap-2">
          {unpaidBills.length === 0 && (
            <p className="py-4 text-center text-[13px] leading-5 text-d-muted">暂无未还账单</p>
          )}
          {unpaidBills.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setPickedBill(b);
                setBillPickerOpen(false);
                setPaymentOpen(true);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-d-border bg-d-surface p-3 text-left transition-colors active:bg-d-subtle"
            >
              <span>
                <span className="block text-[13px] leading-4 text-d-muted">
                  {b.bill_month} 账单
                </span>
                <span className="num-tabular mt-1 block text-[15px] font-bold leading-5 text-d-text">
                  ¥{Number(b.bill_amount).toLocaleString()}
                </span>
              </span>
              <ChevronRightIcon size={18} className="shrink-0 text-d-muted" />
            </button>
          ))}
          <div className="h-2" />
        </div>
      </BottomSheet>

      {/* 三个表单 */}
      <BillForm
        open={billFormOpen}
        onClose={() => {
          setBillFormOpen(false);
          closeAll();
        }}
        onSuccess={() => {
          onChanged?.();
          closeAll();
        }}
      />

      <PaymentForm
        open={paymentOpen}
        onClose={() => {
          setPaymentOpen(false);
          closeAll();
        }}
        onSubmit={handlePaymentSubmit}
        totalAmount={pickedBill?.bill_amount ?? 0}
        billMonth={pickedBill?.bill_month ?? ""}
        billId={pickedBill?.id}
      />

      <CardForm
        open={cardFormOpen}
        onClose={() => {
          setCardFormOpen(false);
          closeAll();
        }}
        onSubmit={handleCardSubmit}
        holderId={pickedHolder?.id ?? ""}
      />

      <Toast
        open={!!notice}
        message={notice ?? ""}
        severity="info"
        autoHideMs={3000}
        onClose={() => setNotice(null)}
      />
    </>
  );
}
