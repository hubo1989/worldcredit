import SwiftUI
import WorldCreditCore

struct WatchCalendarView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            if let events = store.snapshot?.calendarEvents, !events.isEmpty {
                ForEach(events) { ev in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(ev.title)
                                .font(.footnote.bold())
                                .foregroundStyle(ev.type == "due" ? .orange : .blue)
                            Spacer()
                            Text(formatDate(ev.date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(ev.subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            } else {
                Text("暂无近期日历事件")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("还款日历")
    }

    private func formatDate(_ dateStr: String) -> String {
        // "2026-10-28" -> "10-28"
        let parts = dateStr.split(separator: "-")
        if parts.count == 3 {
            return "\(parts[1])-\(parts[2])"
        }
        return dateStr
    }
}
