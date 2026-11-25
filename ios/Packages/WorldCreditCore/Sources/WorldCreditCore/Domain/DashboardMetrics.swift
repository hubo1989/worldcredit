import Foundation

/// 汇率快照，字段与 Web `lib/fx.ts` 的 `FxRates` 一致。
///
/// `timestamp` 是数据源给出的秒级时间戳（日粒度）；`fetchedAt` 是本地写入缓存的
/// **毫秒**时间戳（Web `fetched_at`），用于 TTL 判断，解码时必须原样保留。
public struct FxRates: Codable, Equatable, Sendable {
    /// 汇率基准币种，数据源固定返回 USD。
    public var base: String
    /// rates[X] = 1 base 等于多少 X。
    public var rates: [String: Double]
    /// 数据源给出的时间戳（秒）。
    public var timestamp: Double
    /// 本地写入缓存的毫秒时间戳（对齐 Web fetched_at）。
    public var fetchedAt: Double

    public init(base: String, rates: [String: Double], timestamp: Double, fetchedAt: Double) {
        self.base = base
        self.rates = rates
        self.timestamp = timestamp
        self.fetchedAt = fetchedAt
    }

    enum CodingKeys: String, CodingKey {
        case base
        case rates
        case timestamp
        case fetchedAt = "fetched_at"
    }

    /// 汇率缓存有效期，与 Web `FX_TTL_MS` 相同（数据源是日粒度，6 小时足够新）。
    public static let ttlMs: Double = 6 * 60 * 60 * 1000

    /// 缓存是否仍在有效期内；过期数据不当新数据使用。
    public func isFresh(nowMs: Double = Date().timeIntervalSince1970 * 1000) -> Bool {
        fetchedAt.isFinite && nowMs - fetchedAt < Self.ttlMs
    }
}

/// 按币种分组折算的纯函数集合，对齐 Web `lib/fx.ts` 的语义：
/// 绝不把「拿不到汇率」当成 1:1 静默换算，缺汇率时该币种保留原币小计、
/// 排除在折算合计之外，并记录到 `unconvertedCurrencies`。
public enum DashboardFx {
    /// 归一化币种代码；非法输入返回 nil（绝不猜一个默认币种）。
    public static func normalizeCurrency(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard code.count == 3, code.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        return code
    }

    /// 归一化币种代码，非法时回落到给定默认值（默认值也非法则回落 CNY）。
    public static func normalizeCurrencyOrDefault(_ raw: String?, _ fallback: String) -> String {
        normalizeCurrency(raw) ?? normalizeCurrency(fallback) ?? "CNY"
    }

    /// 把 amount 从 from 折算到 to，经基准币中转（amount / rates[from] * rates[to]）。
    /// 同币种直接返回原值；任何跨币种失败（无汇率、币种不在 rates 里、汇率非正数、
    /// 金额非有限数）都返回 nil，绝不猜。
    public static func convert(_ amount: Double, from: String, to: String, rates: FxRates?) -> Double? {
        guard amount.isFinite else { return nil }
        guard let source = normalizeCurrency(from), let target = normalizeCurrency(to) else { return nil }
        if source == target { return amount }
        guard let rates else { return nil }
        guard let sourceRate = rates.rates[source], let targetRate = rates.rates[target],
              sourceRate.isFinite, sourceRate > 0, targetRate.isFinite, targetRate > 0 else { return nil }
        return amount / sourceRate * targetRate
    }

    /// 按币种分组求和，再逐币种折算到目标币种。
    /// `byCurrency` 无论汇率是否可用都保留完整的原币小计；缺汇率的币种被排除在
    /// `total` 之外并记入 `unconvertedCurrencies`。
    public static func sumByCurrency(
        _ entries: [(amount: Double, currency: String)],
        target: String,
        rates: FxRates?
    ) -> (convertedCurrency: String, byCurrency: [String: Double], total: Double,
          converted: Bool, unconvertedCurrencies: [String], mixed: Bool) {
        let convertedCurrency = normalizeCurrencyOrDefault(target, "CNY")
        var byCurrency: [String: Double] = [:]
        var unconverted = Set<String>()
        var total = 0.0

        for entry in entries {
            let amount = entry.amount
            guard amount.isFinite, amount != 0 else { continue }
            let currency = normalizeCurrencyOrDefault(entry.currency, convertedCurrency)
            byCurrency[currency, default: 0] += amount

            guard let convertedAmount = convert(amount, from: currency, to: convertedCurrency, rates: rates) else {
                unconverted.insert(currency)
                continue
            }
            total += convertedAmount
        }

        return (
            convertedCurrency,
            byCurrency,
            total,
            unconverted.isEmpty,
            unconverted.sorted(),
            byCurrency.count > 1
        )
    }
}

/// 首页金额展示的纯格式化（对齐 Web `formatMoney` / `currencySymbol`）：
/// 币种符号 + 千分位 + 最多两位小数，符号由调用方传入的币种决定——这个应用同时
/// 有 CNY / USD / HKD 的卡，写死 ¥ 会把外币账单显示成人民币。
public enum DashboardMoney {
    /// 币种符号（¥ / US$ / HK$）。未知币种回落到币种代码本身，不假装它是人民币。
    public static func currencySymbol(_ currency: String) -> String {
        let code = normalizeForSymbol(currency)
        switch code {
        case "CNY": return "¥"
        case "USD": return "US$"
        case "HKD": return "HK$"
        default: return code
        }
    }

    /// 金额转展示字符串（符号 + 千分位，最多两位小数）。隐私模式由调用方决定是否脱敏。
    /// 非有限数按 0 展示（对齐 Web 的 `(n || 0)`）。
    public static func format(_ amount: Double, currency: String) -> String {
        format(amount, currency: currency, maxFractionDigits: 2)
    }

    /// 紧凑金额格式化（不保留小数位，适合 Watch / 小尺寸 Widget 空间）。
    public static func formatCompact(_ amount: Double, currency: String) -> String {
        format(amount, currency: currency, maxFractionDigits: 0)
    }

    private static func format(_ amount: Double, currency: String, maxFractionDigits: Int) -> String {
        let value = amount.isFinite ? amount : 0
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.groupingSeparator = ","
        formatter.decimalSeparator = "."
        formatter.roundingMode = .halfUp
        formatter.maximumFractionDigits = maxFractionDigits
        formatter.minimumFractionDigits = 0
        let number = formatter.string(from: NSNumber(value: value)) ?? "\(value)"
        return "\(currencySymbol(currency))\(number)"
    }

    private static func normalizeForSymbol(_ currency: String) -> String {
        let trimmed = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return DashboardFx.normalizeCurrency(trimmed) ?? "CNY"
    }
}

/// 首页指标计算结果，字段口径对齐 Web `lib/dashboard-metrics.ts` 的 `computeMetrics`
/// 加上额度折算（Web `lib/api/analytics.server.ts`）。
public struct DashboardMetrics: Equatable, Sendable {
    /// 待还合计：全部未还账单按币种分组折算到 `displayCurrency` 的真数。
    /// 缺汇率的币种被排除在外（不是按 1:1 混进来），看 `unconvertedCurrencies` 交代。
    public let totalPending: Double
    /// 已逾期（已过还款日且未还清）合计，折算口径同上。
    public let overdueAmount: Double
    /// 当日待还合计（今日到期未结清信用卡账单 + 今日到期未结清固定支出），折算口径同上。
    public let dueTodayAmount: Double
    /// 未来 N 天（含今天）待还合计，折算口径同上。
    public let futureAmount: Double
    /// 普通未还（当前数据模型仅普通未还，分期/贷款暂未接入）。
    public let plainOwed: Double
    /// 缺汇率因而未计入各项金额合计的币种（已排序）。
    public let unconvertedCurrencies: [String]
    /// 已逾期账单（原币金额，用于一键还款 CTA）。
    public let overdueBills: [BillDisplayItem]
    /// 今天到期且未结清的账单（原币金额）。
    public let dueTodayBills: [BillDisplayItem]
    /// 今天到期且未结清的固定支出（原币金额）。
    public let dueTodayPayables: [PayableItem]
    /// 今天待还款总笔数（账单 + 固定支出）。
    public let dueTodayCount: Int
    /// 当日待还按原币种的小计。
    public let dueTodayByCurrency: [String: Double]
    /// 还款日在今天到 N 天内（含今天）的未还账单。
    public let futureBills: [BillDisplayItem]
    /// 当前持卡人筛选下的全部账单（与账单页 tab 无关）。
    public let visibleBills: [BillDisplayItem]
    /// 待还账单笔数。
    public let unpaidCount: Int
    /// 汇率拿到没有：false 时各金额合计不完整，必须显式标注。
    public let ratesAvailable: Bool
    /// 待还是否出现多币种，用于决定要不要展示币种构成。
    public let mixed: Bool
    /// 待还金额按原币种的小计（汇率不可用时用它直接向用户交代）。
    public let pendingByCurrency: [String: Double]
    /// 保留额度（active 且额度 > 0 的卡）折算到 `displayCurrency` 的合计。
    public let totalCreditLimit: Double
    /// 缺汇率因而未计入额度合计的币种（原币保留在 `creditLimitByCurrency`）。
    public let missingLimitCurrencies: [String]
    /// 额度按原币种的小计。
    public let creditLimitByCurrency: [String: Double]

    /// 计算一组账单/卡片的首页指标。纯函数，不做任何 IO。
    ///
    /// - Parameters:
    ///   - bills: 全量账单（用 `QueryService.fetchDashboardBills()` 取，不随账单页 tab 变化）。
    ///   - cards: 全量卡片（用 `QueryService.fetchCards()` 取）。
    ///   - holderId: 持卡人筛选；nil 表示全部（Web 的 `'all'`）。
    ///   - futureDays: 未来 N 天区间（7 / 14 / 30），区间含今天。
    ///   - displayCurrency: 目标展示币种；rates 缺失时同币种部分仍精确计入。
    ///   - rates: 汇率快照；nil 时跨币种金额被排除并记入 unconverted 列表。
    ///   - payables: 当期固定支出列表（默认为空以保持调用方兼容）。
    ///   - creditAccounts: 信用账户列表（用于识别 `quotaMode == "shared"` 账户并去重计算共享额度池）。
    public static func compute(
        bills: [BillDisplayItem],
        cards: [CardDisplayItem],
        holderId: String?,
        futureDays: Int,
        displayCurrency: String,
        rates: FxRates?,
        payables: [PayableItem] = [],
        creditAccounts: [CreditAccount] = []
    ) -> DashboardMetrics {
        // 当前持卡人筛选下的账单、卡片与固定支出（nil = 全部）。
        let visibleBills: [BillDisplayItem]
        let visibleCards: [CardDisplayItem]
        let visiblePayables: [PayableItem]
        if let holderId {
            visibleBills = bills.filter { $0.card.holderId == holderId }
            visibleCards = cards.filter { $0.card.holderId == holderId }
            visiblePayables = payables.filter { $0.holderId == holderId }
        } else {
            visibleBills = bills
            visibleCards = cards
            visiblePayables = payables
        }

        // 只统计未还清的账单：已结清（status = paid）或剩余 ≤ 0.01 浮点容差的排除。
        let unpaid = visibleBills.filter { $0.bill.status != "paid" && $0.remainingAmount > 0.01 }
        let overdueBills = unpaid.filter { $0.daysUntilDue < 0 }
        let dueTodayBills = unpaid.filter { $0.daysUntilDue == 0 }
        let dueTodayPayables = visiblePayables.filter {
            $0.daysUntilDue == 0 && $0.status != .paid && !$0.isSettled && $0.remainingAmount > 0.01
        }
        let futureBills = unpaid.filter { $0.daysUntilDue >= 0 && $0.daysUntilDue <= futureDays }

        func sum(_ list: [BillDisplayItem]) -> (convertedCurrency: String, byCurrency: [String: Double], total: Double,
                                                converted: Bool, unconvertedCurrencies: [String], mixed: Bool) {
            DashboardFx.sumByCurrency(
                list.map { ($0.remainingAmount, $0.currency) },
                target: displayCurrency,
                rates: rates
            )
        }

        let pendingSum = sum(unpaid)
        let overdueSum = sum(overdueBills)
        let dueTodaySum = DashboardFx.sumByCurrency(
            dueTodayBills.map { ($0.remainingAmount, $0.currency) }
                + dueTodayPayables.map { ($0.remainingAmount, $0.currency) },
            target: displayCurrency,
            rates: rates
        )
        let futureSum = sum(futureBills)

        // 额度：只算 active 且额度 > 0 的卡（额度未知的外币卡不进分母）；
        // 对 `quotaMode == "shared"` 的同一信用账户只计一次共享池额度（不按卡片数翻倍）；
        // 卡产品/账户币种就是额度币种，缺省时回退到目标币种。
        let accountsById = Dictionary(uniqueKeysWithValues: creditAccounts.map { ($0.id, $0) })
        let activeCards = visibleCards.filter { $0.card.status == "active" }
        var sharedCardsByAccount: [String: [CardDisplayItem]] = [:]
        var limitEntries: [(Double, String)] = []

        for item in activeCards {
            if let accountId = item.card.accountId,
               let account = accountsById[accountId],
               account.quotaMode == "shared" {
                sharedCardsByAccount[accountId, default: []].append(item)
            } else if item.card.effectiveCreditLimit > 0 {
                limitEntries.append((item.card.effectiveCreditLimit, item.product?.currency ?? displayCurrency))
            }
        }

        for (accountId, groupCards) in sharedCardsByAccount {
            guard let account = accountsById[accountId] else { continue }
            let poolLimit: Double
            if let explicitShared = account.sharedCreditLimit, explicitShared > 0 {
                poolLimit = explicitShared
            } else {
                poolLimit = groupCards.map(\.card.effectiveCreditLimit).max() ?? 0.0
            }
            guard poolLimit > 0 else { continue }
            let trimmedAccCurrency = account.currency.trimmingCharacters(in: .whitespacesAndNewlines)
            let currency = trimmedAccCurrency.isEmpty
                ? (groupCards.first?.product?.currency ?? displayCurrency)
                : trimmedAccCurrency
            limitEntries.append((poolLimit, currency))
        }

        let limitSum = DashboardFx.sumByCurrency(
            limitEntries,
            target: displayCurrency,
            rates: rates
        )

        let unconvertedCurrencies = Set(pendingSum.unconvertedCurrencies)
            .union(overdueSum.unconvertedCurrencies)
            .union(dueTodaySum.unconvertedCurrencies)
            .union(futureSum.unconvertedCurrencies)
            .sorted()

        return DashboardMetrics(
            totalPending: pendingSum.total,
            overdueAmount: overdueSum.total,
            dueTodayAmount: dueTodaySum.total,
            futureAmount: futureSum.total,
            plainOwed: pendingSum.total,
            unconvertedCurrencies: unconvertedCurrencies,
            overdueBills: overdueBills,
            dueTodayBills: dueTodayBills,
            dueTodayPayables: dueTodayPayables,
            dueTodayCount: dueTodayBills.count + dueTodayPayables.count,
            dueTodayByCurrency: dueTodaySum.byCurrency,
            futureBills: futureBills,
            visibleBills: visibleBills,
            unpaidCount: unpaid.count,
            ratesAvailable: rates != nil,
            mixed: pendingSum.mixed,
            pendingByCurrency: pendingSum.byCurrency,
            totalCreditLimit: limitSum.total,
            missingLimitCurrencies: limitSum.unconvertedCurrencies,
            creditLimitByCurrency: limitSum.byCurrency
        )
    }
}
