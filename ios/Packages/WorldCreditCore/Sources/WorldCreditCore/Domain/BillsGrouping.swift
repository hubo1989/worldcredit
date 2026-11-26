import Foundation

/// 账单页按卡分组的值对象与纯函数：分组、排序、多币种合计折算。
/// 排序口径与 Web `compareBillsListCardsByMode` 对齐：
/// - nearestDue：逾期卡 → 待还卡 → 已结清卡，组间按组内最紧还款日升序。
/// - maxInterestFree：按「今日刷卡免息天数」降序，不参与压力分组。
public struct CardBillsGroup: Identifiable, Equatable, Sendable {
    public let cardId: String
    public let cardTitle: String
    public let bankName: String
    public let holderId: String
    public let holderName: String
    public let currency: String
    public let bills: [BillDisplayItem]

    public var id: String { cardId }

    /// 组内未还合计(已结清期为 0，不影响和)。
    public var unpaidAmount: Double {
        bills.reduce(0) { $0 + $1.remainingAmount }
    }

    public var hasOverdue: Bool {
        bills.contains(where: \.isOverdue)
    }

    public var hasUnpaid: Bool {
        bills.contains { $0.remainingAmount > 0.01 }
    }

    /// 卡维度免息天数：同一张卡的账单共享该值。
    public var interestFreeDaysToday: Int {
        bills.first?.interestFreeDaysToday ?? 0
    }

    /// 组内未还账单距还款日的最小值；无未还时为 nil。
    public var nearestDaysUntilDue: Int? {
        bills.filter { $0.remainingAmount > 0.01 }.map(\.daysUntilDue).min()
    }

    /// 下期账单日（今天交易所在期的出账日），Asia/Shanghai 自然日口径。
    /// 产品缺失的非贷款卡返回 nil——缺还款规则时宁可不出日期，也不把
    /// 「今天」编造成账单日。
    public func nextBillingDate(today: Date = Date()) -> Date? {
        graceDates(today: today)?.billing
    }

    /// 下期还款日（下一期账单的到期日）；贷款卡为下个月供日（出账日与还款日同一天）。
    /// 产品缺失的非贷款卡返回 nil。
    public func nextDueDate(today: Date = Date()) -> Date? {
        graceDates(today: today)?.due
    }

    /// 缺账提醒：已过账单日 `graceDays`（默认 3，容忍账单邮件晚到）而系统里
    /// 还没有下一期账单，返回已过天数；不满足返回 nil。
    ///
    /// 基线 `latestBillMonth` 必须来自**全量**账单（`BillsGrouping.latestBillMonth(of:)`）：
    /// 已还/待还过滤会把最新一期已还账单从组里滤掉，拿组内过滤后的账单当基线会误报。
    /// 贷款卡不参与（账单日语义不适用）；从未收过账单（基线 nil）不提醒。
    public func missingStatementDays(
        latestBillMonth: String?,
        today: Date = Date(),
        graceDays: Int = 3
    ) -> Int? {
        guard let first = bills.first, first.card.cardType != "loan" else { return nil }
        return BillsGrouping.missingStatementDays(
            billingDay: first.card.overrideBillingDay ?? first.card.billingDay,
            latestBillMonth: latestBillMonth,
            today: today,
            graceDays: graceDays)
    }

    /// 贷款卡：出账日 = 还款日 = 下个月供日；信用卡：走 calculateCardGracePeriod。
    /// 产品缺失的信用卡无还款规则，返回 nil（calculateCardGracePeriod 会返回
    /// (今天, 今天, 0)，与真实日期不可区分，这里在源头拦掉）。
    private func graceDates(today: Date) -> (billing: Date, due: Date)? {
        guard let first = bills.first else { return nil }
        let card = first.card
        if card.cardType == "loan" {
            guard let loanDueDay = card.loanDueDay else { return nil }
            let due = BillingDateCalculator.getLoanNextDueDate(loanDueDay: loanDueDay, today: today)
            return (due, due)
        }
        guard let product = first.product else { return nil }
        let grace = BillingDateCalculator.calculateCardGracePeriod(card: card, cardProduct: product, today: today)
        return (grace.nextBillingDate, grace.nextDueDate)
    }
}

public enum BillsGrouping {
    /// 按卡分组，保持输入顺序(输入通常已按 nearest_due 排好)。
    public static func groups(from bills: [BillDisplayItem]) -> [CardBillsGroup] {
        var order: [String] = []
        var byCard: [String: [BillDisplayItem]] = [:]
        for item in bills {
            if byCard[item.card.id] == nil { order.append(item.card.id) }
            byCard[item.card.id, default: []].append(item)
        }
        return order.compactMap { cardId in
            guard let items = byCard[cardId], let first = items.first else { return nil }
            return CardBillsGroup(
                cardId: cardId,
                cardTitle: first.cardTitle,
                bankName: first.bankName,
                holderId: first.holderId,
                holderName: first.holderName,
                currency: first.currency,
                bills: items
            )
        }
    }

    private static func urgencyTier(_ group: CardBillsGroup) -> Int {
        if group.hasOverdue { return 0 }
        if group.hasUnpaid { return 1 }
        return 2
    }

    /// 组间排序。maxInterestFree 不参与压力分组(Web 同口径)。
    public static func sorted(_ groups: [CardBillsGroup], by mode: BillsSortMode) -> [CardBillsGroup] {
        switch mode {
        case .maxInterestFree:
            return groups.sorted { $0.interestFreeDaysToday > $1.interestFreeDaysToday }
        case .nearestDue:
            return groups.sorted { a, b in
                let tierA = urgencyTier(a)
                let tierB = urgencyTier(b)
                if tierA != tierB { return tierA < tierB }
                switch (a.nearestDaysUntilDue, b.nearestDaysUntilDue) {
                case let (x?, y?):
                    return x < y
                case (nil, _?):
                    return false
                case (_?, nil):
                    return true
                default:
                    return false
                }
            }
        }
    }

    /// 组内最新一期账单月份（"YYYY-MM"），无账单为 nil。
    /// 调用方应传**全量**账单（filter == .all 的结果）：已还过滤会滤掉最新一期
    /// 已还账单，让缺账提醒的基线退回更早一期而误报。
    public static func latestBillMonth(of bills: [BillDisplayItem]) -> String? {
        var latest: String?
        for item in bills {
            let month = item.bill.billMonth
            guard !month.isEmpty else { continue }
            if let latest, month <= latest { continue }
            latest = month
        }
        return latest
    }

    /// 「已过账单日但没收到新账单」提醒，移植 Web `missingStatementDays`
    /// （2026-10-20 规则）：最新一期（latestBillMonth）的下一期出账日已过
    /// `graceDays` 天（默认 3，容忍账单邮件晚到）而系统里还没有那一期账单，
    /// 返回已过天数（> graceDays），不满足返回 nil。
    ///
    /// - 基线取「下一期」而非「本月」：连续几期没收到时「本月账单日过了没」
    ///   会漏报——10 月账单日还没到，但 9 月那期早就该到了。
    /// - 从未收过账单（latestBillMonth 为 nil）不提醒：没有基线，出账时间
    ///   本来就不确定，提醒只会是噪音。
    /// - 账单日大于当月天数按当月最后一天收拢（2 月 30 日 → 2 月 28/29 日），
    ///   非法账单日（< 1）按 1 号算，跨年由日历自然处理。
    public static func missingStatementDays(
        billingDay: Int,
        latestBillMonth: String?,
        today: Date = Date(),
        graceDays: Int = 3
    ) -> Int? {
        guard let latestBillMonth else { return nil }
        let parts = latestBillMonth.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2, (1...12).contains(parts[1]) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var base = DateComponents()
        base.year = parts[0]
        base.month = parts[1]
        base.day = 1
        guard let baseDate = cal.date(from: base),
              let nextMonthDate = cal.date(byAdding: .month, value: 1, to: baseDate) else { return nil }
        let effectiveDay = billingDay >= 1 ? min(billingDay, 31) : 1
        let expected = BillingDateCalculator.getActualBillingDate(billingDay: effectiveDay, month: nextMonthDate)
        let daysPast = -BillingDateCalculator.diffInCalendarDays(target: expected, today: today)
        return daysPast > graceDays ? daysPast : nil
    }

    /// 多币种合计折算：每组按其账单币种折算到 displayCurrency；
    /// 同币种组无需汇率直接累计（见 DashboardFx.convert 的同币种直返），
    /// 缺汇率/非法汇率的**外币**组排除在合计之外并计入 unconvertedCurrencies。
    /// rates 为 nil 时只有与 displayCurrency 同币种的组计入合计。
    public static func total(
        of groups: [CardBillsGroup],
        rates: FxRates?,
        displayCurrency: String
    ) -> BillsTotal {
        var total = 0.0
        var unconverted = Set<String>()
        for group in groups where group.unpaidAmount > 0.01 {
            // 同币种直返不依赖 rates;不能因为整体没有汇率就把本币合计清零。
            if let converted = DashboardFx.convert(
                group.unpaidAmount, from: group.currency,
                to: displayCurrency, rates: rates) {
                total += converted
            } else {
                unconverted.insert(group.currency)
            }
        }
        return BillsTotal(amount: total, unconvertedCurrencies: unconverted.sorted())
    }
}

public struct MissingStatementDetectionItem: Identifiable, Equatable, Sendable {
    public let targetKey: String
    public let anchorCardId: String
    public let accountId: String?
    public let holderId: String
    public let isMerged: Bool
    public let missingBillMonth: String
    public let expectedStatementDate: String
    public let suggestedDueDate: String
    public let daysPast: Int
    public let graceDays: Int
    public let subject: String
    public let currency: String
    public let bankName: String
    public let holderName: String
    public let cardTitle: String

    public var id: String { targetKey }

    public init(
        targetKey: String,
        anchorCardId: String,
        accountId: String?,
        holderId: String,
        isMerged: Bool,
        missingBillMonth: String,
        expectedStatementDate: String,
        suggestedDueDate: String,
        daysPast: Int,
        graceDays: Int,
        subject: String,
        currency: String,
        bankName: String,
        holderName: String,
        cardTitle: String
    ) {
        self.targetKey = targetKey
        self.anchorCardId = anchorCardId
        self.accountId = accountId
        self.holderId = holderId
        self.isMerged = isMerged
        self.missingBillMonth = missingBillMonth
        self.expectedStatementDate = expectedStatementDate
        self.suggestedDueDate = suggestedDueDate
        self.daysPast = daysPast
        self.graceDays = graceDays
        self.subject = subject
        self.currency = currency
        self.bankName = bankName
        self.holderName = holderName
        self.cardTitle = cardTitle
    }
}

public struct BillsTotal: Equatable, Sendable {
    public let amount: Double
    public let unconvertedCurrencies: [String]

    public init(amount: Double, unconvertedCurrencies: [String]) {
        self.amount = amount
        self.unconvertedCurrencies = unconvertedCurrencies
    }
}

extension BillsGrouping {
    public static func normalizeMissingStatementGraceDays(_ raw: Int?) -> Int {
        guard let raw, (0...15).contains(raw) else { return 3 }
        return raw
    }

    /// 统一超期未获得账单检测：
    /// - 仅纳入 `cardType == "credit"` 且 `status == "active"` 且所属账户非 `"archived"` 的卡；
    /// - 合并账户（`statementMode == "merged"`）按账户级去重，主卡停用时顺位选活跃代理卡；
    /// - 有历史账单按 `latestBillMonth + 1`，从未出账按建卡日之后首个预期账单日（最近已过宽限期周期）。
    public static func detectMissingStatements(
        cards: [CardDisplayItem],
        bills: [BillDisplayItem],
        accounts: [CreditAccount] = [],
        today: Date = Date(),
        graceDays rawGraceDays: Int? = 3
    ) -> [MissingStatementDetectionItem] {
        let graceDays = normalizeMissingStatementGraceDays(rawGraceDays)
        let cal = BillingDateCalculator.businessCalendar
        let accountById = Dictionary(uniqueKeysWithValues: accounts.map { ($0.id, $0) })

        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        df.dateFormat = "yyyy-MM-dd"

        let ymFormatter = DateFormatter()
        ymFormatter.locale = Locale(identifier: "en_US_POSIX")
        ymFormatter.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        ymFormatter.dateFormat = "yyyy-MM"

        let todayStr = df.string(from: today)
        let todayMonth = String(todayStr.prefix(7))

        func normalizeMonth(_ raw: String?) -> String? {
            guard let raw else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let parts = trimmed.split(separator: "-").compactMap { Int($0) }
            if parts.count >= 2, (1...12).contains(parts[1]) {
                return String(format: "%04d-%02d", parts[0], parts[1])
            }
            let digits = trimmed.filter(\.isNumber)
            if digits.count == 6,
               let y = Int(digits.prefix(4)),
               let m = Int(digits.suffix(2)),
               (1...12).contains(m) {
                return String(format: "%04d-%02d", y, m)
            }
            return nil
        }

        func monthAnchorDate(_ ym: String) -> Date? {
            let parts = ym.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 2 else { return nil }
            var comp = DateComponents()
            comp.year = parts[0]
            comp.month = parts[1]
            comp.day = 1
            return cal.date(from: comp)
        }

        func addYearMonth(_ ym: String, _ delta: Int) -> String? {
            guard let anchor = monthAnchorDate(ym),
                  let shifted = cal.date(byAdding: .month, value: delta, to: anchor) else {
                return nil
            }
            return ymFormatter.string(from: shifted)
        }

        func parseCreatedDay(_ raw: String) -> String? {
            let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !s.isEmpty else { return nil }
            if s.count == 10, s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
                return s
            }
            if s.count == 19, s.range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"#, options: .regularExpression) != nil {
                let utcFmt = DateFormatter()
                utcFmt.locale = Locale(identifier: "en_US_POSIX")
                utcFmt.timeZone = TimeZone(secondsFromGMT: 0)
                utcFmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
                if let d = utcFmt.date(from: s) {
                    return df.string(from: d)
                }
            }
            let isoFrac = ISO8601DateFormatter()
            isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = isoFrac.date(from: s) {
                return df.string(from: d)
            }
            let isoPlain = ISO8601DateFormatter()
            isoPlain.formatOptions = [.withInternetDateTime]
            if let d = isoPlain.date(from: s) {
                return df.string(from: d)
            }
            return nil
        }

        struct DetectionUnit {
            let targetKey: String
            let accountId: String?
            let account: CreditAccount?
            let isMerged: Bool
            var members: [CardDisplayItem]
        }

        var mergedUnits: [String: DetectionUnit] = [:]
        var mergedOrder: [String] = []
        var independentUnits: [DetectionUnit] = []

        for item in cards {
            let acc = item.card.accountId.flatMap { accountById[$0] }
            if let acc, acc.statementMode == "merged", let accountId = item.card.accountId {
                if mergedUnits[accountId] == nil {
                    mergedOrder.append(accountId)
                    mergedUnits[accountId] = DetectionUnit(
                        targetKey: "account:\(accountId)",
                        accountId: accountId,
                        account: acc,
                        isMerged: true,
                        members: []
                    )
                }
                mergedUnits[accountId]?.members.append(item)
            } else {
                independentUnits.append(DetectionUnit(
                    targetKey: "card:\(item.id)",
                    accountId: item.card.accountId,
                    account: acc,
                    isMerged: false,
                    members: [item]
                ))
            }
        }

        let units = mergedOrder.compactMap { mergedUnits[$0] } + independentUnits
        var results: [MissingStatementDetectionItem] = []

        for unit in units {
            if unit.account?.status == "archived" { continue }
            let activeMembers = unit.members.filter {
                $0.card.status == "active" && $0.card.cardType == "credit"
            }
            guard !activeMembers.isEmpty else { continue }

            let carrier: CardDisplayItem
            if unit.isMerged {
                if let primaryId = unit.account?.primaryCardId,
                   let primary = activeMembers.first(where: { $0.id == primaryId }) {
                    carrier = primary
                } else {
                    let billCounts = Dictionary(grouping: bills, by: \.card.id).mapValues(\.count)
                    carrier = activeMembers.sorted { a, b in
                        let ca = billCounts[a.id, default: 0]
                        let cb = billCounts[b.id, default: 0]
                        if ca != cb { return ca > cb }
                        if a.card.createdAt != b.card.createdAt {
                            return a.card.createdAt < b.card.createdAt
                        }
                        return a.id < b.id
                    }.first!
                }
            } else {
                carrier = activeMembers[0]
            }

            let memberCardIds = Set(unit.members.map(\.id))
            var latestBillMonth: String?
            for b in bills {
                let belongs = (unit.accountId != nil && b.bill.accountId == unit.accountId)
                    || memberCardIds.contains(b.card.id)
                guard belongs, let norm = normalizeMonth(b.bill.billMonth) else { continue }
                if let current = latestBillMonth {
                    if norm > current { latestBillMonth = norm }
                } else {
                    latestBillMonth = norm
                }
            }

            let rawBillingDay = carrier.card.overrideBillingDay ?? carrier.card.billingDay
            let effectiveBillingDay = rawBillingDay >= 1
                ? min(rawBillingDay, 31)
                : min(max(unit.account?.billingDay ?? 1, 1), 31)

            var missingMonth: String?
            var expectedDate: Date?
            var daysPast = 0

            if let latestBillMonth {
                if let targetMonth = addYearMonth(latestBillMonth, 1),
                   let anchor = monthAnchorDate(targetMonth) {
                    let expected = BillingDateCalculator.getActualBillingDate(
                        billingDay: effectiveBillingDay,
                        month: anchor
                    )
                    let diff = -BillingDateCalculator.diffInCalendarDays(target: expected, today: today)
                    if diff > graceDays {
                        missingMonth = targetMonth
                        expectedDate = expected
                        daysPast = diff
                    }
                }
            } else {
                let createdDays = activeMembers.compactMap { parseCreatedDay($0.card.createdAt) }.sorted()
                if let earliestCreated = createdDays.first {
                    let createdMonth = String(earliestCreated.prefix(7))
                    if let createdAnchor = monthAnchorDate(createdMonth) {
                        let firstStmt = BillingDateCalculator.getActualBillingDate(
                            billingDay: effectiveBillingDay,
                            month: createdAnchor
                        )
                        let firstStmtStr = df.string(from: firstStmt)
                        let firstExpectedMonth = earliestCreated <= firstStmtStr
                            ? createdMonth
                            : (addYearMonth(createdMonth, 1) ?? createdMonth)

                        let candidates = [
                            todayMonth,
                            addYearMonth(todayMonth, -1),
                            addYearMonth(todayMonth, -2),
                        ].compactMap { $0 }

                        for m in candidates where m >= firstExpectedMonth {
                            guard let anchor = monthAnchorDate(m) else { continue }
                            let expected = BillingDateCalculator.getActualBillingDate(
                                billingDay: effectiveBillingDay,
                                month: anchor
                            )
                            let diff = -BillingDateCalculator.diffInCalendarDays(target: expected, today: today)
                            if diff > graceDays {
                                missingMonth = m
                                expectedDate = expected
                                daysPast = diff
                                break
                            }
                        }
                    }
                }
            }

            guard let resolvedMonth = missingMonth,
                  let resolvedExpected = expectedDate,
                  let resolvedAnchor = monthAnchorDate(resolvedMonth) else {
                continue
            }

            let suggestedDue: Date
            if let product = carrier.product {
                suggestedDue = BillingDateCalculator.getDueDate(
                    card: carrier.card,
                    cardProduct: product,
                    billMonth: resolvedAnchor
                )
            } else if let dueType = unit.account?.parsedDueType, let dueValue = unit.account?.dueValue {
                let synthetic = CardProduct(
                    id: carrier.card.cardProductId,
                    bankName: carrier.bankName,
                    cardName: carrier.displayName,
                    currency: unit.account?.currency ?? "CNY",
                    paymentDueType: dueType,
                    paymentDueValue: dueValue
                )
                suggestedDue = BillingDateCalculator.getDueDate(
                    card: carrier.card,
                    cardProduct: synthetic,
                    billMonth: resolvedAnchor
                )
            } else {
                suggestedDue = cal.date(byAdding: .day, value: 20, to: resolvedExpected) ?? resolvedExpected
            }

            let bankName = carrier.bankName.isEmpty ? (unit.account?.bankName ?? "银行卡") : carrier.bankName
            let subject: String
            if unit.isMerged && activeMembers.count >= 2 {
                let tails = activeMembers
                    .map { $0.last4.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                if tails.count > 2 {
                    subject = "\(bankName) 合并账单（含尾号 \(tails.prefix(2).joined(separator: " · ")) 等 \(activeMembers.count) 张卡）"
                } else if !tails.isEmpty {
                    subject = "\(bankName) 合并账单（含尾号 \(tails.joined(separator: " · "))）"
                } else {
                    subject = "\(bankName) 合并账单（\(activeMembers.count) 张卡）"
                }
            } else {
                let tail = carrier.last4.trimmingCharacters(in: .whitespacesAndNewlines)
                let base = bankName.isEmpty ? carrier.displayName : "\(bankName) \(carrier.displayName)"
                subject = tail.isEmpty ? base : "\(base)（尾号 \(tail)）"
            }

            results.append(MissingStatementDetectionItem(
                targetKey: unit.targetKey,
                anchorCardId: carrier.id,
                accountId: unit.accountId,
                holderId: carrier.card.holderId,
                isMerged: unit.isMerged,
                missingBillMonth: resolvedMonth,
                expectedStatementDate: df.string(from: resolvedExpected),
                suggestedDueDate: df.string(from: suggestedDue),
                daysPast: daysPast,
                graceDays: graceDays,
                subject: subject,
                currency: carrier.product?.currency ?? unit.account?.currency ?? "CNY",
                bankName: bankName,
                holderName: carrier.holderName,
                cardTitle: carrier.displayName
            ))
        }

        return results.sorted { a, b in
            if a.daysPast != b.daysPast { return a.daysPast > b.daysPast }
            return a.anchorCardId < b.anchorCardId
        }
    }
}
