import SwiftUI
import WorldCreditCore

struct BillsView: View {
    @Environment(AppState.self) private var appState
    @State private var payingItem: BillDisplayItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // 筛选标签
                Picker("账单状态", selection: Binding(
                    get: { appState.selectedBillFilter },
                    set: { newFilter in
                        appState.selectedBillFilter = newFilter
                        Task { await appState.reloadData() }
                    }
                )) {
                    ForEach(BillFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .accessibilityIdentifier("bills.filter")

                if appState.bills.isEmpty {
                    ContentUnavailableView(
                        "没有\(appState.selectedBillFilter.rawValue)账单",
                        systemImage: "doc.text",
                        description: Text("下拉可同步最新账单数据")
                    )
                } else {
                    List {
                        ForEach(appState.bills) { item in
                            NavigationLink(value: BillDetailRoute(item: item)) {
                                BillRowView(item: item) {
                                    payingItem = item
                                }
                            }
                            .accessibilityIdentifier("bill.row.\(item.id)")
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("账单")
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .refreshable {
                await appState.sync()
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
}

struct BillRowView: View {
    let item: BillDisplayItem
    let onQuickPay: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.bankName)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Text(item.cardTitle)
                            .font(.headline)
                    }

                    HStack(spacing: 6) {
                        Text(item.holderName)
                        if !item.last4.isEmpty {
                            Text("(\(item.last4))")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("¥\(String(format: "%.2f", item.remainingAmount))")
                        .font(.headline)
                        .foregroundStyle(item.isOverdue ? .red : .primary)

                    if item.totalPaid > 0 && item.remainingAmount > 0.01 {
                        Text("已还 ¥\(String(format: "%.2f", item.totalPaid))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            HStack {
                Text(item.distanceLabel)
                    .font(.footnote)
                    .foregroundStyle(item.isOverdue ? .red : (item.daysUntilDue <= 3 ? .orange : .secondary))

                Spacer()

                Text(item.displayStatus)
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(
                        item.remainingAmount <= 0.01 ? Color.green.opacity(0.12) :
                        (item.isOverdue ? Color.red.opacity(0.12) : Color.blue.opacity(0.12))
                    )
                    .foregroundStyle(
                        item.remainingAmount <= 0.01 ? .green :
                        (item.isOverdue ? .red : .blue)
                    )
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}
