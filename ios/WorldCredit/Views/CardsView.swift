import SwiftUI
import WorldCreditCore

struct CardsView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationStack {
            List {
                if appState.cards.isEmpty {
                    ContentUnavailableView(
                        "暂无卡片数据",
                        systemImage: "creditcard",
                        description: Text("下拉可同步最新卡片数据")
                    )
                } else {
                    ForEach(appState.cards) { card in
                        CardRowView(card: card)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("卡片")
            .refreshable {
                await appState.sync()
            }
        }
    }
}

struct CardRowView: View {
    let card: CardDisplayItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(card.bankName)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Text(card.displayName)
                            .font(.headline)
                    }

                    HStack(spacing: 6) {
                        Text(card.holderName)
                        if !card.last4.isEmpty {
                            Text("(\(card.last4))")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                // 免息期标签
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(card.interestFreeDaysToday) 天")
                        .font(.title3.bold())
                        .foregroundStyle(.tint)
                    Text("今日刷卡免息")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("信用额度")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("¥\(String(format: "%.0f", card.card.creditLimit))")
                        .font(.footnote.bold())
                }

                Spacer()

                VStack(alignment: .center, spacing: 2) {
                    let billingDay = card.card.overrideBillingDay ?? card.card.billingDay
                    Text("账单日")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("每月 \(billingDay) 日")
                        .font(.footnote.bold())
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("未还账款")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("¥\(String(format: "%.2f", card.remainingAmount))")
                        .font(.footnote.bold())
                        .foregroundStyle(card.remainingAmount > 0.01 ? .primary : .secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
