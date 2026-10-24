import SwiftUI
import WorldCreditCore

struct WatchHomeView: View {
    @Environment(WatchStore.self) private var store
    @State private var showingConfirmAlert: Bool = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // 下一笔还款聚焦卡片
                if let nextBill = store.snapshot?.nextDueBill {
                    VStack(spacing: 4) {
                        Text("下一笔还款")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)

                        Text("\(nextBill.bankName) · \(nextBill.cardTitle)")
                            .font(.system(size: 13, weight: .medium))
                            .lineLimit(1)

                        Text("¥\(String(format: "%.2f", nextBill.remainingAmount))")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundStyle(nextBill.isOverdue() ? .red : .primary)

                        Text(nextBill.distanceLabel())
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(nextBill.isOverdue() ? .red : (nextBill.daysUntilDue() <= 3 ? .orange : .secondary))

                        Button {
                            showingConfirmAlert = true
                        } label: {
                            Text("标记已还清")
                                .font(.system(size: 12, weight: .bold))
                        }
                        .tint(.green)
                        .padding(.top, 4)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .confirmationDialog(
                        "确认将 \(nextBill.cardTitle) 标记为已还清？",
                        isPresented: $showingConfirmAlert,
                        titleVisibility: .visible
                    ) {
                        Button("全额还款 ¥\(String(format: "%.2f", nextBill.remainingAmount))") {
                            store.markAsPaid(bill: nextBill)
                        }
                        Button("取消", role: .cancel) {}
                    }
                } else {
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.green)
                        Text("近期暂无待还账单")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // 待还总额与逾期提示
                if let snap = store.snapshot {
                    if snap.overdueCount > 0 {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                                .font(.caption2)
                            Text("\(snap.overdueCount) 笔已逾期 (¥\(String(format: "%.0f", snap.overdueAmount)))")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.red)
                        }
                        .padding(6)
                        .frame(maxWidth: .infinity)
                        .background(Color.red.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    HStack {
                        Text("待还总额")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("¥\(String(format: "%.0f", snap.totalDebt))")
                            .font(.caption.bold())
                    }
                    .padding(.horizontal, 4)
                }

                // 快捷导航按钮
                VStack(spacing: 6) {
                    NavigationLink(destination: WatchBillsListView()) {
                        HStack {
                            Label("全部待还", systemImage: "doc.text.fill")
                            Spacer()
                            if let count = store.snapshot?.bills.count, count > 0 {
                                Text("\(count)")
                                    .font(.caption2.bold())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    NavigationLink(destination: WatchCardsListView()) {
                        HStack {
                            Label("卡片免息", systemImage: "creditcard.fill")
                            Spacer()
                        }
                    }

                    NavigationLink(destination: WatchCalendarView()) {
                        HStack {
                            Label("还款日历", systemImage: "calendar")
                            Spacer()
                        }
                    }
                }

                // 数据新鲜度标记
                Text(store.lastUpdatedText)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 6)
        }
        .navigationTitle("WorldCredit")
    }
}
