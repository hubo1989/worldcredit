import SwiftUI
import WorldCreditCore

struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var payingItem: BillDisplayItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // 汇总卡片
                    summaryCard

                    // 逾期提醒（若有）
                    if let summary = appState.summary, summary.overdueCount > 0 {
                        overdueBanner(summary: summary)
                    }

                    // 临期待还列表
                    urgentBillsSection
                }
                .padding()
            }
            .navigationTitle("概览")
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .refreshable {
                await appState.sync()
            }
            .task {
                await appState.reloadData()
            }
            .sheet(item: $payingItem) { item in
                PaymentSheetView(item: item) { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note
                    )
                }
            }
        }
    }

    // MARK: - 汇总卡片

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("本期待还总额")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                if appState.isSyncing {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            Text("¥\(String(format: "%.2f", appState.summary?.totalDebt ?? 0))")
                .accessibilityIdentifier("dashboard.totalDebt")
                .font(.system(size: 36, weight: .bold, design: .rounded))

            Divider()

            // 额度与利用率
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("总信用额度")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("¥\(String(format: "%.0f", appState.summary?.totalCreditLimit ?? 0))")
                        .font(.subheadline.bold())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("额度使用率")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    let limit = appState.summary?.totalCreditLimit ?? 1.0
                    let debt = appState.summary?.totalDebt ?? 0.0
                    let pct = limit > 0 ? (debt / limit) * 100 : 0.0
                    Text("\(String(format: "%.1f", pct))%")
                        .font(.subheadline.bold())
                        .foregroundStyle(pct > 70 ? .red : (pct > 50 ? .orange : .primary))
                }
            }
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - 逾期横幅

    private func overdueBanner(summary: DashboardSummary) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.title3)

            VStack(alignment: .leading, spacing: 2) {
                Text("有 \(summary.overdueCount) 笔账单已逾期")
                    .font(.subheadline.bold())
                    .foregroundStyle(.red)
                Text("逾期总额 ¥\(String(format: "%.2f", summary.overdueAmount))，请尽快处理")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(Color.red.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - 临期账单

    private var urgentBillsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("近期还款")
                    .font(.headline)
                Spacer()
            }

            if let urgent = appState.summary?.urgentBills, !urgent.isEmpty {
                ForEach(urgent) { item in
                    NavigationLink(value: BillDetailRoute(item: item)) {
                        VStack(spacing: 8) {
                            HStack {
                                Text("\(item.bankName) · \(item.cardTitle)")
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text("¥\(String(format: "%.2f", item.remainingAmount))")
                                    .font(.headline)
                                    .foregroundStyle(item.isOverdue ? .red : .primary)
                            }
                            HStack {
                                Text("\(item.holderName) · 尾号 \(item.last4)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(item.distanceLabel)
                                    .font(.caption.bold())
                                    .foregroundStyle(item.isOverdue ? .red : .orange)
                            }
                        }
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            } else {
                HStack {
                    Spacer()
                    Text("未来 7 天暂无到期账单")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                    Spacer()
                }
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}
