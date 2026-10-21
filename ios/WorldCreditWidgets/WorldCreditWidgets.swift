import WidgetKit
import SwiftUI
import WorldCreditCore

struct iPhoneDueEntry: TimelineEntry {
    let date: Date
    let bankName: String
    let cardTitle: String
    let amount: Double
    let days: Int
    let isOverdue: Bool
    let distanceLabel: String
    let totalDebt: Double
    let overdueCount: Int
    let upcomingBills: [WatchBillItem]
}

struct iPhoneDueWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> iPhoneDueEntry {
        iPhoneDueEntry(
            date: Date(),
            bankName: "招商银行",
            cardTitle: "经典白",
            amount: 3200,
            days: 3,
            isOverdue: false,
            distanceLabel: "3 天后",
            totalDebt: 6800,
            overdueCount: 0,
            upcomingBills: []
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (iPhoneDueEntry) -> Void) {
        let snapshot = WatchSnapshotManager.shared.load()
        completion(entry(from: snapshot, for: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<iPhoneDueEntry>) -> Void) {
        let snapshot = WatchSnapshotManager.shared.load()
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())

        var entries: [iPhoneDueEntry] = []
        for dayOffset in 0..<7 {
            if let entryDate = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) {
                let effectiveDate = dayOffset == 0 ? Date() : entryDate
                entries.append(entry(from: snapshot, for: entryDate, timestamp: effectiveDate))
            }
        }

        let nextWeek = calendar.date(byAdding: .day, value: 7, to: startOfToday) ?? Date()
        let timeline = Timeline(entries: entries, policy: .after(nextWeek))
        completion(timeline)
    }

    private func entry(from snapshot: WatchSnapshot?, for evalDate: Date, timestamp: Date? = nil) -> iPhoneDueEntry {
        let time = timestamp ?? evalDate
        guard let snapshot, let bill = snapshot.nextDueBill else {
            return iPhoneDueEntry(
                date: time,
                bankName: "",
                cardTitle: "暂无待还账单",
                amount: 0,
                days: 999,
                isOverdue: false,
                distanceLabel: "全部已结清",
                totalDebt: 0,
                overdueCount: 0,
                upcomingBills: []
            )
        }

        let days = bill.daysUntilDue(today: evalDate)
        let isOverdue = bill.isOverdue(today: evalDate)
        let label = bill.distanceLabel(today: evalDate)
        let rest = Array(snapshot.bills.dropFirst().prefix(2))

        return iPhoneDueEntry(
            date: time,
            bankName: bill.bankName,
            cardTitle: bill.cardTitle,
            amount: bill.remainingAmount,
            days: days,
            isOverdue: isOverdue,
            distanceLabel: label,
            totalDebt: snapshot.totalDebt,
            overdueCount: snapshot.overdueCount,
            upcomingBills: rest
        )
    }
}

struct iPhoneDueWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: iPhoneDueEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallView
        case .systemMedium:
            mediumView
        default:
            smallView
        }
    }

    // 小组件
    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("近期待还")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                if entry.overdueCount > 0 {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.caption2)
                }
            }

            if entry.amount <= 0 {
                Spacer()
                Label("账单已结清", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.green)
                Spacer()
            } else {
                Text("\(entry.bankName) · \(entry.cardTitle)")
                    .font(.caption.bold())
                    .lineLimit(1)

                Text("¥\(String(format: "%.0f", entry.amount))")
                    .font(.title2.bold())
                    .foregroundStyle(entry.isOverdue ? .red : .primary)

                Spacer()

                HStack {
                    Text(entry.distanceLabel)
                        .font(.caption2.bold())
                        .foregroundStyle(entry.isOverdue ? .red : (entry.days <= 3 ? .orange : .secondary))
                    Spacer()
                    Text("共¥\(String(format: "%.0f", entry.totalDebt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .containerBackground(Color(uiColor: .secondarySystemGroupedBackground), for: .widget)
    }

    // 中组件
    private var mediumView: some View {
        HStack(spacing: 16) {
            // 左半边：下一笔聚焦
            VStack(alignment: .leading, spacing: 6) {
                Text("下一笔还款")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if entry.amount <= 0 {
                    Spacer()
                    Label("所有账单已结清", systemImage: "checkmark.circle.fill")
                        .font(.subheadline.bold())
                        .foregroundStyle(.green)
                    Spacer()
                } else {
                    Text("\(entry.bankName) · \(entry.cardTitle)")
                        .font(.headline)
                        .lineLimit(1)

                    Text("¥\(String(format: "%.2f", entry.amount))")
                        .font(.title.bold())
                        .foregroundStyle(entry.isOverdue ? .red : .primary)

                    Text(entry.distanceLabel)
                        .font(.caption.bold())
                        .foregroundStyle(entry.isOverdue ? .red : (entry.days <= 3 ? .orange : .secondary))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // 右半边：汇总与后续
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("本期待还总额")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("¥\(String(format: "%.2f", entry.totalDebt))")
                        .font(.subheadline.bold())
                }

                if entry.overdueCount > 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.red)
                        Text("\(entry.overdueCount) 笔已逾期")
                            .font(.caption2.bold())
                            .foregroundStyle(.red)
                    }
                }

                if !entry.upcomingBills.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("后续待还")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                        ForEach(entry.upcomingBills) { b in
                            HStack {
                                Text(b.cardTitle)
                                    .font(.system(size: 11))
                                    .lineLimit(1)
                                Spacer()
                                Text("¥\(String(format: "%.0f", b.remainingAmount))")
                                    .font(.system(size: 11, weight: .medium))
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .containerBackground(Color(uiColor: .secondarySystemGroupedBackground), for: .widget)
    }
}

@main
struct WorldCreditWidgets: Widget {
    let kind: String = "WorldCreditWidgets"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: iPhoneDueWidgetProvider()) { entry in
            iPhoneDueWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("还款概览")
        .description("在主屏幕查看下一笔还款倒计时与待还总额。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
