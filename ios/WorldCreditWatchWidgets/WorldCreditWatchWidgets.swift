import WidgetKit
import SwiftUI
import WorldCreditCore

struct WatchDueEntry: TimelineEntry {
    let date: Date
    let days: Int
    let amount: Double
}

struct WatchDueWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchDueEntry {
        WatchDueEntry(date: Date(), days: 3, amount: 3200)
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchDueEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchDueEntry>) -> Void) {
        let entry = WatchDueEntry(date: Date(), days: 3, amount: 3200)
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }
}

struct WatchDueCircularView: View {
    var entry: WatchDueEntry

    var body: some View {
        VStack {
            Text(entry.days <= 0 ? "!" : "\(entry.days)")
                .font(.title2.bold())
                .foregroundStyle(entry.days <= 0 ? .red : .orange)
            Text("天")
                .font(.system(size: 8))
        }
    }
}

@main
struct WorldCreditWatchWidgets: Widget {
    let kind: String = "WorldCreditWatchWidgets"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchDueWidgetProvider()) { entry in
            WatchDueCircularView(entry: entry)
        }
        .configurationDisplayName("还款倒计时")
        .description("显示下一笔账单的还款剩余天数。")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
