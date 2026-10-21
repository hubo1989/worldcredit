import WidgetKit
import SwiftUI
import WorldCreditCore

struct WatchDueEntry: TimelineEntry {
    let date: Date
    let bankName: String
    let cardTitle: String
    let amount: Double
    let days: Int
    let isOverdue: Bool
    let distanceLabel: String
    let remainingBillCount: Int
}

struct WatchDueWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchDueEntry {
        WatchDueEntry(
            date: Date(),
            bankName: "招商银行",
            cardTitle: "经典白",
            amount: 3200,
            days: 3,
            isOverdue: false,
            distanceLabel: "3 天后",
            remainingBillCount: 1
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchDueEntry) -> Void) {
        let snapshot = WatchSnapshotManager.shared.load()
        completion(entry(from: snapshot, for: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchDueEntry>) -> Void) {
        let snapshot = WatchSnapshotManager.shared.load()
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())

        // 预先生成未来 7 天、每天零点一条的时间线
        var entries: [WatchDueEntry] = []
        for dayOffset in 0..<7 {
            if let entryDate = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) {
                // For day 0, use current time so widget displays immediately
                let effectiveDate = dayOffset == 0 ? Date() : entryDate
                entries.append(entry(from: snapshot, for: entryDate, timestamp: effectiveDate))
            }
        }

        let nextWeek = calendar.date(byAdding: .day, value: 7, to: startOfToday) ?? Date()
        let timeline = Timeline(entries: entries, policy: .after(nextWeek))
        completion(timeline)
    }

    private func entry(from snapshot: WatchSnapshot?, for evaluationDate: Date, timestamp: Date? = nil) -> WatchDueEntry {
        let time = timestamp ?? evaluationDate
        guard let snapshot, let bill = snapshot.nextDueBill else {
            return WatchDueEntry(
                date: time,
                bankName: "",
                cardTitle: "暂无待还",
                amount: 0,
                days: 999,
                isOverdue: false,
                distanceLabel: "全部已结清",
                remainingBillCount: 0
            )
        }

        let days = bill.daysUntilDue(today: evaluationDate)
        let isOverdue = bill.isOverdue(today: evaluationDate)
        let label = bill.distanceLabel(today: evaluationDate)

        return WatchDueEntry(
            date: time,
            bankName: bill.bankName,
            cardTitle: bill.cardTitle,
            amount: bill.remainingAmount,
            days: days,
            isOverdue: isOverdue,
            distanceLabel: label,
            remainingBillCount: max(0, snapshot.bills.count - 1)
        )
    }
}

// MARK: - Widget Views

struct WatchDueWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: WatchDueEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            circularView
        case .accessoryRectangular:
            rectangularView
        case .accessoryInline:
            inlineView
        default:
            circularView
        }
    }

    // 圆形组件：剩余天数，逾期时感叹号
    private var circularView: some View {
        ZStack {
            Gauge(value: max(0.0, min(1.0, Double(entry.days) / 30.0))) {
                Text("还款")
            } currentValueLabel: {
                if entry.amount <= 0 {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.green)
                } else if entry.isOverdue {
                    Image(systemName: "exclamationmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.red)
                } else {
                    Text("\(entry.days)")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(entry.isOverdue ? .red : (entry.days <= 3 ? .orange : .blue))
        }
    }

    // 矩形组件：下一笔银行 + 金额 + 倒计时 + 剩余笔数
    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.amount <= 0 {
                Label("账单已结清", systemImage: "checkmark.circle.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.green)
                Text("近期无待还")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                HStack {
                    Text("\(entry.bankName) ¥\(String(format: "%.0f", entry.amount))")
                        .font(.caption2.bold())
                        .lineLimit(1)
                    Spacer()
                    if entry.isOverdue {
                        Text("逾期")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.red)
                    }
                }

                Text(entry.distanceLabel)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(entry.isOverdue ? .red : (entry.days <= 3 ? .orange : .secondary))

                if entry.remainingBillCount > 0 {
                    Text("另有 \(entry.remainingBillCount) 笔待还")
                        .font(.system(size: 8))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // 单行组件
    private var inlineView: some View {
        if entry.amount <= 0 {
            Text("WorldCredit · 账单结清")
        } else {
            Text("\(entry.bankName) ¥\(String(format: "%.0f", entry.amount)) · \(entry.distanceLabel)")
        }
    }
}

@main
struct WorldCreditWatchWidgets: Widget {
    let kind: String = "WorldCreditWatchWidgets"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchDueWidgetProvider()) { entry in
            WatchDueWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("还款提醒")
        .description("显示下一笔待还账单与到期倒计时。")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
