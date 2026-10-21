import WidgetKit
import SwiftUI
import WorldCreditCore

struct DueEntry: TimelineEntry {
    let date: Date
    let bankName: String
    let cardName: String
    let amount: Double
    let days: Int
}

struct DueWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> DueEntry {
        DueEntry(date: Date(), bankName: "招商银行", cardName: "经典白", amount: 3200, days: 3)
    }

    func getSnapshot(in context: Context, completion: @escaping (DueEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DueEntry>) -> Void) {
        let entry = DueEntry(date: Date(), bankName: "招商银行", cardName: "经典白", amount: 3200, days: 3)
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct DueWidgetView: View {
    var entry: DueEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(entry.bankName) \(entry.cardName)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("¥\(String(format: "%.2f", entry.amount))")
                .font(.title2.bold())
            Text(BillingDateCalculator.dueDistanceLabel(days: entry.days))
                .font(.caption2.bold())
                .foregroundStyle(entry.days <= 0 ? .red : .orange)
        }
        .containerBackground(for: .widget) {
            Color.black
        }
    }
}

@main
struct WorldCreditWidgets: Widget {
    let kind: String = "WorldCreditWidgets"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DueWidgetProvider()) { entry in
            DueWidgetView(entry: entry)
        }
        .configurationDisplayName("近期待还")
        .description("显示下一笔到期的账单与还款倒计时。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
