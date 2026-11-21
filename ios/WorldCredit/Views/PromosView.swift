import SwiftUI
import WorldCreditCore

/// 银行优惠活动原生视图（纯离线读取本地 GRDB 同步的 `appState.promos`，零 WebView）。
struct PromosView: View {
    @Environment(AppState.self) private var appState

    @State private var selectedBank: String? = nil
    @State private var selectedDiscountType: String? = nil
    @State private var searchText: String = ""
    @State private var expandedPromoIds: Set<String> = []
    @State private var hapticSelectionTrigger: Int = 0

    private static let shanghaiDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private var todayString: String {
        Self.shanghaiDateFormatter.string(from: Date())
    }

    private var bankOptions: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for promo in appState.promos {
            let bank = promo.bankName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !bank.isEmpty, seen.insert(bank).inserted else { continue }
            result.append(bank)
        }
        return result.sorted()
    }

    private var discountTypeOptions: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for promo in appState.promos {
            let normalized = normalizedDiscountType(promo.discountType)
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { continue }
            result.append(normalized)
        }
        let preferredOrder = ["满减", "折扣", "积分", "返现"]
        return result.sorted { a, b in
            let ia = preferredOrder.firstIndex(of: a) ?? Int.max
            let ib = preferredOrder.firstIndex(of: b) ?? Int.max
            if ia != ib { return ia < ib }
            return a < b
        }
    }

    private var filteredPromos: [PromoRecord] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return appState.promos.filter { promo in
            if let selectedBank, promo.bankName != selectedBank {
                return false
            }
            if let selectedDiscountType, normalizedDiscountType(promo.discountType) != selectedDiscountType {
                return false
            }
            if !query.isEmpty {
                let haystack = [
                    promo.title,
                    promo.bankName,
                    promo.description ?? "",
                    promo.conditions ?? "",
                    promo.discountType ?? "",
                ].joined(separator: " ")
                if !haystack.localizedCaseInsensitiveContains(query) {
                    return false
                }
            }
            return true
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                searchBar
                if !bankOptions.isEmpty {
                    bankFilterChips
                }
                if discountTypeOptions.count > 1 {
                    discountTypeChips
                }

                if appState.promos.isEmpty {
                    emptyStateCard(
                        title: "暂无优惠活动",
                        icon: "tag.slash",
                        subtitle: "下拉刷新同步服务端银行优惠活动目录，离线也可随时查阅。",
                        showReset: false
                    )
                } else if filteredPromos.isEmpty {
                    emptyStateCard(
                        title: "没有匹配的优惠活动",
                        icon: "magnifyingglass",
                        subtitle: "可调整银行筛选、优惠类型或清空搜索关键词。",
                        showReset: true
                    )
                } else {
                    ForEach(filteredPromos) { promo in
                        promoCard(promo)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(WCColors.canvas)
        .refreshable {
            await appState.sync()
        }
        .sensoryFeedback(.selection, trigger: hapticSelectionTrigger)
    }

    // MARK: - Search & Filter Chips

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(WCColors.textSecondary)
                .font(.subheadline)
            TextField("搜索银行、优惠名称或参与条件", text: $searchText)
                .font(.subheadline)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("promos.search")
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(WCColors.textSecondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private var bankFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                filterChip(
                    title: "全部银行 (\(appState.promos.count))",
                    selected: selectedBank == nil
                ) {
                    selectedBank = nil
                }
                ForEach(bankOptions, id: \.self) { bank in
                    filterChip(title: bank, selected: selectedBank == bank) {
                        selectedBank = (selectedBank == bank) ? nil : bank
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var discountTypeChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                filterChip(
                    title: "全部类型",
                    selected: selectedDiscountType == nil
                ) {
                    selectedDiscountType = nil
                }
                ForEach(discountTypeOptions, id: \.self) { type in
                    filterChip(title: type, selected: selectedDiscountType == type) {
                        selectedDiscountType = (selectedDiscountType == type) ? nil : type
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func filterChip(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            hapticSelectionTrigger += 1
            action()
        } label: {
            Text(title)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    selected ? WCColors.primaryAccent : WCColors.surface,
                    in: Capsule()
                )
                .foregroundStyle(selected ? Color.white : WCColors.textSecondary)
                .overlay(
                    Capsule()
                        .stroke(selected ? Color.clear : WCColors.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Promo Card

    private func promoCard(_ promo: PromoRecord) -> some View {
        let isExpanded = expandedPromoIds.contains(promo.id)
        let typeLabel = normalizedDiscountType(promo.discountType)
        let validity = validitySummary(promo)

        return Button {
            hapticSelectionTrigger += 1
            withAnimation(.easeInOut(duration: 0.2)) {
                if isExpanded {
                    expandedPromoIds.remove(promo.id)
                } else {
                    expandedPromoIds.insert(promo.id)
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            if !promo.bankName.isEmpty {
                                Text(promo.bankName)
                                    .font(.caption.bold())
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(WCColors.subtle, in: Capsule())
                                    .foregroundStyle(WCColors.textPrimary)
                            }
                            if !typeLabel.isEmpty {
                                discountBadge(typeLabel)
                            }
                        }

                        Text(promo.title)
                            .font(.headline)
                            .foregroundStyle(WCColors.textPrimary)
                            .multilineTextAlignment(.leading)
                    }

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(WCColors.textSecondary)
                        .padding(.top, 4)
                }

                if let desc = promo.description, !desc.isEmpty {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(WCColors.textSecondary)
                        .lineLimit(isExpanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                }

                HStack(spacing: 10) {
                    if let dateRange = dateRangeText(start: promo.startDate, end: promo.endDate) {
                        Label(dateRange, systemImage: "calendar")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    Spacer()
                    if let validity {
                        Text(validity.label)
                            .font(.caption2.bold())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(validity.softColor, in: Capsule())
                            .foregroundStyle(validity.inkColor)
                    }
                }

                if isExpanded {
                    Divider()
                        .background(WCColors.border)

                    VStack(alignment: .leading, spacing: 6) {
                        if let conditions = promo.conditions, !conditions.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("参与条件")
                                    .font(.caption.bold())
                                    .foregroundStyle(WCColors.textPrimary)
                                Text(conditions)
                                    .font(.caption)
                                    .foregroundStyle(WCColors.textSecondary)
                                    .multilineTextAlignment(.leading)
                            }
                        }

                        if let maxUses = promo.maxUses, maxUses > 0 {
                            Label("每人限享 \(maxUses) 次", systemImage: "person.badge.clock")
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .padding(16)
            .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(WCColors.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("promo.row.\(promo.id)")
    }

    private func discountBadge(_ type: String) -> some View {
        let style: (bg: Color, fg: Color) = switch type {
        case "满减": (WCColors.dangerSoft, WCColors.dangerInk)
        case "折扣": (WCColors.warningSoft, WCColors.warningInk)
        case "积分": (WCColors.subtle, WCColors.primaryAccent)
        case "返现": (WCColors.successSoft, WCColors.successInk)
        default: (WCColors.subtle, WCColors.textSecondary)
        }
        return Text(type)
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(style.bg, in: Capsule())
            .foregroundStyle(style.fg)
    }

    private func normalizedDiscountType(_ raw: String?) -> String {
        guard let raw else { return "" }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed.lowercased() {
        case "cashback": return "返现"
        case "points": return "积分"
        case "discount": return "折扣"
        case "instant_discount", "full_reduction": return "满减"
        default: return trimmed
        }
    }

    private func dateRangeText(start: String?, end: String?) -> String? {
        let s = start?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let e = end?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !s.isEmpty && !e.isEmpty { return "\(s) ~ \(e)" }
        if !s.isEmpty { return "\(s) 起" }
        if !e.isEmpty { return "至 \(e)" }
        return nil
    }

    private func validitySummary(_ promo: PromoRecord) -> (label: String, softColor: Color, inkColor: Color)? {
        if !promo.isActive {
            return ("已下线", WCColors.subtle, WCColors.textSecondary)
        }
        let today = todayString
        if let end = promo.endDate, !end.isEmpty, end < today {
            return ("已结束", WCColors.subtle, WCColors.textSecondary)
        }
        if let start = promo.startDate, !start.isEmpty, start > today {
            return ("即将开始", WCColors.warningSoft, WCColors.warningInk)
        }
        return ("进行中", WCColors.successSoft, WCColors.successInk)
    }

    private func emptyStateCard(
        title: String,
        icon: String,
        subtitle: String,
        showReset: Bool
    ) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.largeTitle)
                .foregroundStyle(WCColors.textSecondary)
            Text(title)
                .font(.headline)
                .foregroundStyle(WCColors.textPrimary)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(WCColors.textSecondary)
                .multilineTextAlignment(.center)
            if showReset {
                Button("重置筛选") {
                    selectedBank = nil
                    selectedDiscountType = nil
                    searchText = ""
                }
                .font(.subheadline.bold())
                .foregroundStyle(WCColors.primaryAccent)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 20)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }
}
