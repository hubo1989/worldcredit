import SwiftUI
import WorldCreditCore

struct WatchCardsListView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            if let cards = store.snapshot?.cards, !cards.isEmpty {
                ForEach(cards) { card in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(card.cardTitle)
                                .font(.headline)
                                .lineLimit(1)
                            Spacer()
                            Text("\(card.interestFreeDaysToday)天")
                                .font(.caption.bold())
                                .foregroundStyle(.tint)
                        }
                        HStack {
                            Text(card.bankName)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("刷卡免息")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Divider()
                        HStack {
                            Text("额度 ¥\(String(format: "%.0f", card.creditLimit))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Spacer()
                            if card.unpaidAmount > 0.01 {
                                Text("欠款 ¥\(String(format: "%.0f", card.unpaidAmount))")
                                    .font(.caption2.bold())
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            } else {
                Text("暂无卡片数据")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("卡片资产")
    }
}
