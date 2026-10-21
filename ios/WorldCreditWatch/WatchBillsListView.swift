import SwiftUI
import WorldCreditCore

struct WatchBillsListView: View {
    @Environment(WatchStore.self) private var store
    @State private var selectedBill: WatchBillItem?
    @State private var showingConfirmAlert: Bool = false

    var body: some View {
        List {
            if let bills = store.snapshot?.bills, !bills.isEmpty {
                ForEach(bills) { bill in
                    Button {
                        selectedBill = bill
                        showingConfirmAlert = true
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(bill.cardTitle)
                                    .font(.headline)
                                    .lineLimit(1)
                                Spacer()
                                Text("¥\(String(format: "%.0f", bill.remainingAmount))")
                                    .font(.headline)
                                    .foregroundStyle(bill.isOverdue() ? .red : .primary)
                            }
                            HStack {
                                Text("\(bill.bankName) \(bill.last4.isEmpty ? "" : "(\(bill.last4))")")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(bill.distanceLabel())
                                    .font(.caption2.bold())
                                    .foregroundStyle(bill.isOverdue() ? .red : (bill.daysUntilDue() <= 3 ? .orange : .secondary))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                Text("暂无待还账单")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("待还账单")
        .confirmationDialog(
            "确认将 \(selectedBill?.cardTitle ?? "") 标记为已还清？",
            isPresented: $showingConfirmAlert,
            titleVisibility: .visible
        ) {
            if let b = selectedBill {
                Button("全额还款 ¥\(String(format: "%.2f", b.remainingAmount))") {
                    store.markAsPaid(bill: b)
                }
            }
            Button("取消", role: .cancel) {}
        }
    }
}
