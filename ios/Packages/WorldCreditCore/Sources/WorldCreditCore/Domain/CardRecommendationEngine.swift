import Foundation

public enum RecommendationCategory: String, CaseIterable, Codable, Sendable, Identifiable {
    case dining
    case shopping
    case travel
    case transport
    case utilities
    case entertainment
    case medical
    case education
    case other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .dining: return "餐饮美食"
        case .shopping: return "日常购物"
        case .travel: return "旅行住宿"
        case .transport: return "交通出行"
        case .utilities: return "生活缴费"
        case .entertainment: return "娱乐订阅"
        case .medical: return "医疗健康"
        case .education: return "教育培训"
        case .other: return "其他消费"
        }
    }
}

public enum OptimizeForMode: String, CaseIterable, Codable, Sendable, Identifiable {
    case balanced
    case maxReward = "max_reward"
    case longestGrace = "longest_grace"
    case taskFirst = "task_first"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .balanced: return "综合最优"
        case .maxReward: return "净回报最高"
        case .longestGrace: return "免息期最长"
        case .taskFirst: return "优先冲刺达标"
        }
    }
}

public struct CategoryRewardRuleV1: Codable, Sendable, Equatable {
    public var category: String
    public var ratePct: Double
    public var rawLabel: String?
    public var pointsMultiplier: Double?
    public var currencyScope: String?
    public var monthlyCapAmount: Double?
    public var minTxnAmount: Double?

    enum CodingKeys: String, CodingKey {
        case category
        case ratePct = "rate_pct"
        case rawLabel = "raw_label"
        case pointsMultiplier = "points_multiplier"
        case currencyScope = "currency_scope"
        case monthlyCapAmount = "monthly_cap_amount"
        case minTxnAmount = "min_txn_amount"
    }
}

public struct RewardRulesV1: Codable, Sendable, Equatable {
    public var schemaVersion: Int?
    public var rewardKind: String?
    public var pointUnitName: String?
    public var pointValuePerUnit: Double?
    public var baseRatePct: Double
    public var baseRawLabel: String?
    public var categoryRules: [CategoryRewardRuleV1]?
    public var notes: String?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case rewardKind = "reward_kind"
        case pointUnitName = "point_unit_name"
        case pointValuePerUnit = "point_value_per_unit"
        case baseRatePct = "base_rate_pct"
        case baseRawLabel = "base_raw_label"
        case categoryRules = "category_rules"
        case notes
    }
}

public struct AnnualFeeWaiverRuleV1: Codable, Sendable, Equatable {
    public var schemaVersion: Int?
    public var waiverType: String
    public var firstYearFree: Bool?
    public var targetAmount: Double?
    public var targetCurrency: String?
    public var targetCount: Int?
    public var perTxnMinAmount: Double?
    public var pointsCost: Int?
    public var notes: String?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case waiverType = "waiver_type"
        case firstYearFree = "first_year_free"
        case targetAmount = "target_amount"
        case targetCurrency = "target_currency"
        case targetCount = "target_count"
        case perTxnMinAmount = "per_txn_min_amount"
        case pointsCost = "points_cost"
        case notes
    }
}

public struct WaiverProgressV1: Codable, Sendable, Equatable {
    public var schemaVersion: Int?
    public var cycleDueDate: String?
    public var amount: Double
    public var count: Int
    public var pointsRedeemed: Int?
    public var asOfOn: String
    public var source: String?
    public var note: String?

    public init(
        schemaVersion: Int? = 1,
        cycleDueDate: String? = nil,
        amount: Double = 0,
        count: Int = 0,
        pointsRedeemed: Int? = nil,
        asOfOn: String,
        source: String? = "manual",
        note: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.cycleDueDate = cycleDueDate
        self.amount = amount
        self.count = count
        self.pointsRedeemed = pointsRedeemed
        self.asOfOn = asOfOn
        self.source = source
        self.note = note
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case cycleDueDate = "cycle_due_date"
        case amount, count
        case pointsRedeemed = "points_redeemed"
        case asOfOn = "as_of_on"
        case source, note
    }
}

public struct PurchaseRecommendationInput: Codable, Sendable, Equatable {
    public var amount: Double
    public var currency: String
    public var category: String?
    public var holderId: String?
    public var merchantKeyword: String?
    public var purchaseDate: String?
    public var optimizeFor: String?
    public var displayCurrency: String?

    public init(
        amount: Double,
        currency: String,
        category: String? = nil,
        holderId: String? = nil,
        merchantKeyword: String? = nil,
        purchaseDate: String? = nil,
        optimizeFor: String? = "balanced",
        displayCurrency: String? = nil
    ) {
        self.amount = amount
        self.currency = currency
        self.category = category
        self.holderId = holderId
        self.merchantKeyword = merchantKeyword
        self.purchaseDate = purchaseDate
        self.optimizeFor = optimizeFor
        self.displayCurrency = displayCurrency
    }

    enum CodingKeys: String, CodingKey {
        case amount, currency, category
        case holderId = "holder_id"
        case merchantKeyword = "merchant_keyword"
        case purchaseDate = "purchase_date"
        case optimizeFor = "optimize_for"
        case displayCurrency = "display_currency"
    }
}

public struct ScoreBreakdownItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { "\(factor)-\(label)" }
    public var factor: String
    public var score: Double
    public var label: String
    public var ruleSource: String

    enum CodingKeys: String, CodingKey {
        case factor, score, label
        case ruleSource = "rule_source"
    }
}

public struct MatchedOpportunityItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var title: String
    public var statusLabel: String
    public var targetUrl: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title
        case statusLabel = "status_label"
        case targetUrl = "target_url"
    }
}

public struct CardRecommendationItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { cardId }
    public var rank: Int
    public var cardId: String
    public var holderId: String
    public var holderName: String
    public var bankName: String
    public var cardName: String
    public var cardNumberLast4: String?
    public var cardCurrency: String
    public var totalScore: Double
    public var netRatePct: Double
    public var estimatedNetRewardPurchaseCcy: Double
    public var estimatedNetRewardDisplayCcy: Double?
    public var graceDays: Int
    public var nextBillingDate: String
    public var nextDueDate: String
    public var availableCredit: Double?
    public var isSharedQuota: Bool
    public var creditCheck: String
    public var ruleCompleteness: String
    public var ftfStatus: String
    public var rewardsSummaryFallback: String?
    public var scoreBreakdown: [ScoreBreakdownItem]
    public var matchedOpportunities: [MatchedOpportunityItem]
    public var warnings: [String]
    public var skippedTaskHints: [String]

    enum CodingKeys: String, CodingKey {
        case rank
        case cardId = "card_id"
        case holderId = "holder_id"
        case holderName = "holder_name"
        case bankName = "bank_name"
        case cardName = "card_name"
        case cardNumberLast4 = "card_number_last4"
        case cardCurrency = "card_currency"
        case totalScore = "total_score"
        case netRatePct = "net_rate_pct"
        case estimatedNetRewardPurchaseCcy = "estimated_net_reward_purchase_ccy"
        case estimatedNetRewardDisplayCcy = "estimated_net_reward_display_ccy"
        case graceDays = "grace_days"
        case nextBillingDate = "next_billing_date"
        case nextDueDate = "next_due_date"
        case availableCredit = "available_credit"
        case isSharedQuota = "is_shared_quota"
        case creditCheck = "credit_check"
        case ruleCompleteness = "rule_completeness"
        case ftfStatus = "ftf_status"
        case rewardsSummaryFallback = "rewards_summary_fallback"
        case scoreBreakdown = "score_breakdown"
        case matchedOpportunities = "matched_opportunities"
        case warnings
        case skippedTaskHints = "skipped_task_hints"
    }
}

public struct ExcludedCardItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { cardId }
    public var cardId: String
    public var holderId: String
    public var holderName: String
    public var bankName: String
    public var cardName: String
    public var cardNumberLast4: String?
    public var cardCurrency: String
    public var excludeCode: String
    public var reason: String
    public var availableCredit: Double?
    public var requiredInCardCurrency: Double?

    enum CodingKeys: String, CodingKey {
        case cardId = "card_id"
        case holderId = "holder_id"
        case holderName = "holder_name"
        case bankName = "bank_name"
        case cardName = "card_name"
        case cardNumberLast4 = "card_number_last4"
        case cardCurrency = "card_currency"
        case excludeCode = "exclude_code"
        case reason
        case availableCredit = "available_credit"
        case requiredInCardCurrency = "required_in_card_currency"
    }
}

public struct RecommendationEngineOutput: Codable, Sendable, Equatable {
    public var purchaseDate: String
    public var optimizeFor: String
    public var fxAvailable: Bool
    public var allCardsUnconfigured: Bool
    public var bannerWarnings: [String]
    public var emptyReason: String?
    public var topRecommendations: [CardRecommendationItem]
    public var otherCandidates: [CardRecommendationItem]
    public var excludedCards: [ExcludedCardItem]

    enum CodingKeys: String, CodingKey {
        case purchaseDate = "purchase_date"
        case optimizeFor = "optimize_for"
        case fxAvailable = "fx_available"
        case allCardsUnconfigured = "all_cards_unconfigured"
        case bannerWarnings = "banner_warnings"
        case emptyReason = "empty_reason"
        case topRecommendations = "top_recommendations"
        case otherCandidates = "other_candidates"
        case excludedCards = "excluded_cards"
    }
}

public enum RoiDecisionTag: String, CaseIterable, Codable, Sendable {
    case freeEarning = "free_earning"
    case freeIdle = "free_idle"
    case keepHighRoi = "keep_high_roi"
    case borderlineNegotiate = "borderline_negotiate"
    case negativeDowngradeCancel = "negative_downgrade_cancel"

    public var label: String {
        switch self {
        case .freeEarning: return "纯赚持有"
        case .freeIdle: return "闲置零成本卡"
        case .keepHighRoi: return "高 ROI · 建议续卡"
        case .borderlineNegotiate: return "临界持平 · 观察/谈心"
        case .negativeDowngradeCancel: return "负 ROI · 建议降级或销卡"
        }
    }
}

public struct UnvaluedBenefitRefItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { "\(accountId ?? "")-\(definitionId ?? "")-\(quantity)" }
    public var accountId: String?
    public var definitionId: String?
    public var quantity: Int

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case definitionId = "definition_id"
        case quantity
    }
}

public struct RoiItemCounts: Codable, Sendable, Equatable {
    public var benefitUsages: Int
    public var promoUsages: Int
    public var taskResults: Int

    enum CodingKeys: String, CodingKey {
        case benefitUsages = "benefit_usages"
        case promoUsages = "promo_usages"
        case taskResults = "task_results"
    }
}

public struct FxSumDTO: Codable, Sendable, Equatable {
    public var convertedCurrency: String
    public var byCurrency: [String: Double]
    public var total: Double
    public var converted: Bool
    public var unconvertedCurrencies: [String]
    public var mixed: Bool

    enum CodingKeys: String, CodingKey {
        case convertedCurrency = "converted_currency"
        case byCurrency = "by_currency"
        case total, converted
        case unconvertedCurrencies = "unconverted_currencies"
        case mixed
    }
}

public struct CardAnnualFeeRoiDetail: Codable, Sendable, Equatable, Identifiable {
    public var id: String { cardId }
    public var cardId: String
    public var holderId: String
    public var holderName: String
    public var bankName: String
    public var cardName: String
    public var cardNumberLast4: String?
    public var cardCurrency: String
    public var periodMode: String
    public var periodStart: String
    public var periodEndExclusive: String
    public var windowModeResolved: String
    public var annualFeeCost: Double
    public var costBasis: String
    public var redeemedBenefitsValue: Double
    public var promoAndRewardValue: Double
    public var manualRewardValue: Double
    public var totalValue: Double
    public var netValue: Double
    public var coveragePct: Double?
    public var roiPct: Double?
    public var decisionTag: RoiDecisionTag
    public var decisionLabel: String?
    public var unvaluedBenefitCount: Int
    public var unvaluedBenefitRefs: [UnvaluedBenefitRefItem]
    public var itemCounts: RoiItemCounts?
    public var nextAnnualFeeDate: String?
    public var daysUntilAnnualFee: Int?
    public var annualFeeStatus: String?

    enum CodingKeys: String, CodingKey {
        case cardId = "card_id"
        case holderId = "holder_id"
        case holderName = "holder_name"
        case bankName = "bank_name"
        case cardName = "card_name"
        case cardNumberLast4 = "card_number_last4"
        case cardCurrency = "card_currency"
        case periodMode = "period_mode"
        case periodStart = "period_start"
        case periodEndExclusive = "period_end_exclusive"
        case windowModeResolved = "window_mode_resolved"
        case annualFeeCost = "annual_fee_cost"
        case costBasis = "cost_basis"
        case redeemedBenefitsValue = "redeemed_benefits_value"
        case promoAndRewardValue = "promo_and_reward_value"
        case manualRewardValue = "manual_reward_value"
        case totalValue = "total_value"
        case netValue = "net_value"
        case coveragePct = "coverage_pct"
        case roiPct = "roi_pct"
        case decisionTag = "decision_tag"
        case decisionLabel = "decision_label"
        case unvaluedBenefitCount = "unvalued_benefit_count"
        case unvaluedBenefitRefs = "unvalued_benefit_refs"
        case itemCounts = "item_counts"
        case nextAnnualFeeDate = "next_annual_fee_date"
        case daysUntilAnnualFee = "days_until_annual_fee"
        case annualFeeStatus = "annual_fee_status"
    }
}

public struct FamilyAnnualFeeRoiTotals: Codable, Sendable, Equatable {
    public var annualFeeCost: FxSumDTO
    public var redeemedBenefitsValue: FxSumDTO
    public var promoAndRewardValue: FxSumDTO
    public var manualRewardValue: FxSumDTO
    public var totalValue: FxSumDTO
    public var netValue: FxSumDTO

    enum CodingKeys: String, CodingKey {
        case annualFeeCost = "annual_fee_cost"
        case redeemedBenefitsValue = "redeemed_benefits_value"
        case promoAndRewardValue = "promo_and_reward_value"
        case manualRewardValue = "manual_reward_value"
        case totalValue = "total_value"
        case netValue = "net_value"
    }
}

public struct FamilyAnnualFeeRoiBoard: Codable, Sendable, Equatable {
    public var periodMode: String
    public var windowStart: String
    public var windowEndExclusive: String
    public var displayCurrency: String
    public var fxAvailable: Bool
    public var cards: [CardAnnualFeeRoiDetail]
    public var totals: FamilyAnnualFeeRoiTotals
    public var unconvertedCurrencies: [String]
    public var warnings: [String]

    public var overallRoiPct: Double? {
        let cost = totals.annualFeeCost.total
        guard cost > 0 else { return nil }
        return ((totals.netValue.total / cost) * 1000).rounded() / 10
    }

    enum CodingKeys: String, CodingKey {
        case periodMode = "period_mode"
        case windowStart = "window_start"
        case windowEndExclusive = "window_end_exclusive"
        case displayCurrency = "display_currency"
        case fxAvailable = "fx_available"
        case cards, totals
        case unconvertedCurrencies = "unconverted_currencies"
        case warnings
    }
}

public struct CardCycleSpendEstimate: Codable, Sendable, Equatable {
    public var cardId: String
    public var periodStart: String
    public var periodEndExclusive: String
    public var windowModeResolved: String
    public var spendAmount: Double
    public var spendCount: Int
    public var currency: String
    public var source: String

    enum CodingKeys: String, CodingKey {
        case cardId = "card_id"
        case periodStart = "period_start"
        case periodEndExclusive = "period_end_exclusive"
        case windowModeResolved = "window_mode_resolved"
        case spendAmount = "spend_amount"
        case spendCount = "spend_count"
        case currency, source
    }
}

public struct AnnualFeeCycleState: Equatable, Sendable {
    public var nominalFee: Double
    public var cycleType: String?
    public var status: String
    public var nextDueDate: String?
    public var cycleStartOn: String?
    public var daysUntilDue: Int?
    public var rolloverNextDueDate: String?
}

public struct OfflineCardSnapshot: Sendable {
    public var card: CreditCard
    public var product: CardProduct?
    public var holderName: String
    public var account: CreditAccount?
    public var cardUnpaidTotal: Double
    public var poolUnpaidTotal: Double

    public init(
        card: CreditCard,
        product: CardProduct?,
        holderName: String,
        account: CreditAccount? = nil,
        cardUnpaidTotal: Double = 0,
        poolUnpaidTotal: Double = 0
    ) {
        self.card = card
        self.product = product
        self.holderName = holderName
        self.account = account
        self.cardUnpaidTotal = cardUnpaidTotal
        self.poolUnpaidTotal = poolUnpaidTotal
    }
}

public enum CardRecommendationEngine {
    private static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    public static func parseRewardRules(_ json: String?) -> RewardRulesV1? {
        guard let json, !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(RewardRulesV1.self, from: data)
    }

    public static func parseFxFreeCurrencies(_ json: String?) -> [String] {
        guard let json, !json.isEmpty, let data = json.data(using: .utf8) else { return [] }
        guard let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return list.compactMap { DashboardFx.normalizeCurrency($0) }
    }

    public static func parseWaiverRules(_ json: String?) -> AnnualFeeWaiverRuleV1? {
        guard let json, !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(AnnualFeeWaiverRuleV1.self, from: data)
    }

    public static func parseWaiverProgress(_ json: String?) -> WaiverProgressV1? {
        guard let json, !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WaiverProgressV1.self, from: data)
    }

    public static func addMonthsClamped(_ civilDate: String, months: Int) -> String? {
        guard BillEditService.isValidCalendarDate(civilDate) else { return nil }
        let parts = civilDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let year = parts[0]
        let month = parts[1]
        let day = parts[2]
        let totalMonths = (month - 1) + months
        let targetYear = year + Int(floor(Double(totalMonths) / 12.0))
        let targetMonth = ((totalMonths % 12) + 12) % 12 + 1
        let maxDay = daysInMonth(year: targetYear, month: targetMonth)
        return String(format: "%04d-%02d-%02d", targetYear, targetMonth, min(day, maxDay))
    }

    private static func daysInMonth(year: Int, month: Int) -> Int {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    }

    public static func diffCivilDays(target: String, from: String) -> Int? {
        guard BillEditService.isValidCalendarDate(target),
              BillEditService.isValidCalendarDate(from) else { return nil }
        let cal = BillingDateCalculator.businessCalendar
        let fromParts = from.split(separator: "-").compactMap { Int($0) }
        let targetParts = target.split(separator: "-").compactMap { Int($0) }
        guard fromParts.count == 3, targetParts.count == 3 else { return nil }
        let c1 = DateComponents(year: fromParts[0], month: fromParts[1], day: fromParts[2])
        let c2 = DateComponents(year: targetParts[0], month: targetParts[1], day: targetParts[2])
        guard let d1 = cal.date(from: c1), let d2 = cal.date(from: c2) else { return nil }
        return cal.dateComponents([.day], from: d1, to: d2).day
    }

    /// 严格对齐 WC-BEN-12：未知发卡/激活/扣费日绝不读取 createdAt 编造周年日；闰年 02-29 从原锚点按 12*k 推进。
    public static func resolveAnnualFeeCycleState(
        card: CreditCard,
        product: CardProduct?,
        todayStr: String
    ) -> AnnualFeeCycleState {
        let nominalFee = max(0.0, card.annualFeeOverride ?? product?.annualFee ?? 0.0)
        let cycleType = card.annualFeeCycleType ?? product?.annualFeeCycleType ?? (nominalFee <= 0 ? "none" : nil)

        if cycleType == "none", !(card.nextAnnualFeeDate.map { BillEditService.isValidCalendarDate($0) } ?? false) {
            return AnnualFeeCycleState(
                nominalFee: nominalFee,
                cycleType: "none",
                status: card.annualFeeStatus ?? "not_applicable",
                nextDueDate: nil,
                cycleStartOn: nil,
                daysUntilDue: nil,
                rolloverNextDueDate: nil
            )
        }

        var nextDueDate: String?
        var cycleStartOn: String?
        var rolloverNextDueDate: String?

        if let explicitDue = card.nextAnnualFeeDate, BillEditService.isValidCalendarDate(explicitDue) {
            nextDueDate = explicitDue
            cycleStartOn = addMonthsClamped(explicitDue, months: -12)
            if explicitDue < todayStr {
                var k = 1
                while let cand = addMonthsClamped(explicitDue, months: 12 * k), cand < todayStr {
                    k += 1
                }
                rolloverNextDueDate = addMonthsClamped(explicitDue, months: 12 * k)
            }
        } else {
            let anchor: String? = {
                if cycleType == "anniversary_issued", let issued = card.issuedOn, BillEditService.isValidCalendarDate(issued) {
                    return issued
                }
                if cycleType == "anniversary_activated", let activated = card.activatedOn, BillEditService.isValidCalendarDate(activated) {
                    return activated
                }
                return nil
            }()

            if let anchor {
                let anchorYear = Int(anchor.prefix(4)) ?? 2026
                let todayYear = Int(todayStr.prefix(4)) ?? 2026
                var k = max(1, todayYear - anchorYear - 1)
                while let cand = addMonthsClamped(anchor, months: 12 * k), cand < todayStr {
                    k += 1
                }
                nextDueDate = addMonthsClamped(anchor, months: 12 * k)
                cycleStartOn = addMonthsClamped(anchor, months: 12 * (k - 1))
            }
        }

        let daysUntilDue = nextDueDate.flatMap { diffCivilDays(target: $0, from: todayStr) }
        let status = card.annualFeeStatus ?? (nominalFee <= 0 ? "not_applicable" : "in_progress")
        return AnnualFeeCycleState(
            nominalFee: nominalFee,
            cycleType: cycleType,
            status: status,
            nextDueDate: nextDueDate,
            cycleStartOn: cycleStartOn,
            daysUntilDue: daysUntilDue,
            rolloverNextDueDate: rolloverNextDueDate
        )
    }

    /// 离线纯函数推荐评分引擎：与服务端 HUB-175 6 因子公式与 6 级同分决胜规则对齐。
    public static func rankCardsForPurchase(
        snapshots: [OfflineCardSnapshot],
        input: PurchaseRecommendationInput,
        rates: FxRates?,
        todayDate: Date = Date()
    ) -> RecommendationEngineOutput {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = BillingDateCalculator.businessCalendar.timeZone
        df.dateFormat = "yyyy-MM-dd"
        let todayStr = input.purchaseDate ?? df.string(from: todayDate)
        let purchaseDateObj = df.date(from: todayStr) ?? todayDate

        let purchaseCurrency = DashboardFx.normalizeCurrencyOrDefault(input.currency, "CNY")
        let displayCurrency = DashboardFx.normalizeCurrencyOrDefault(input.displayCurrency, purchaseCurrency)
        let mode = OptimizeForMode(rawValue: input.optimizeFor ?? "balanced") ?? .balanced

        let (wReward, wFtf, wGrace, maxTaskBonus): (Double, Double, Double, Double) = {
            switch mode {
            case .balanced: return (1.0, 1.0, 1.0, 5.0)
            case .maxReward: return (1.0, 1.0, 0.2, 0.0)
            case .longestGrace: return (0.6, 1.0, 3.0, 2.0)
            case .taskFirst: return (0.8, 1.0, 0.5, 8.0)
            }
        }()

        let creditSnapshots = snapshots.filter { $0.card.cardType != "loan" }
        var candidates: [(item: CardRecommendationItem, tieRule: Int, tieSameCcy: Int, tieUrgent: Int, tieGrace: Int, tieCredit: Double)] = []
        var excluded: [ExcludedCardItem] = []
        var bannerWarnings: Set<String> = []
        var fxMissingEncountered = false

        for snap in creditSnapshots {
            let card = snap.card
            let product = snap.product
            let cardCurrency = DashboardFx.normalizeCurrencyOrDefault(product?.currency ?? snap.account?.currency, "CNY")
            let bankName = product?.bankName ?? snap.account?.bankName ?? "银行卡"
            let cardName = card.nameOverride ?? product?.cardName ?? "信用卡"

            if card.status != "active" {
                let code = card.status == "frozen" ? "card_frozen" : "card_cancelled"
                let reason = card.status == "frozen" ? "卡片已冻结" : "卡片已注销"
                excluded.append(ExcludedCardItem(
                    cardId: card.id,
                    holderId: card.holderId,
                    holderName: snap.holderName,
                    bankName: bankName,
                    cardName: cardName,
                    cardNumberLast4: card.cardNumberLast4,
                    cardCurrency: cardCurrency,
                    excludeCode: code,
                    reason: reason,
                    availableCredit: nil,
                    requiredInCardCurrency: nil
                ))
                continue
            }

            let purchaseInCardCcy: Double? = DashboardFx.convert(input.amount, from: purchaseCurrency, to: cardCurrency, rates: rates)
            if purchaseCurrency != cardCurrency && purchaseInCardCcy == nil {
                fxMissingEncountered = true
            }

            let isSharedPool = snap.account?.quotaMode == "shared" || ((snap.account?.sharedCreditLimit ?? 0) > 0)
            let effectiveLimit: Double? = {
                if isSharedPool, let shared = snap.account?.sharedCreditLimit, shared > 0 {
                    return shared
                }
                if let ov = card.creditLimitOverride, ov > 0 { return ov }
                if card.creditLimit > 0 { return card.creditLimit }
                return nil
            }()
            let unpaid = isSharedPool ? snap.poolUnpaidTotal : snap.cardUnpaidTotal
            let availableCredit = effectiveLimit.map { max(0.0, $0 - unpaid) }

            var warnings: [String] = []
            let creditCheck: String
            if purchaseCurrency != cardCurrency && purchaseInCardCcy == nil {
                creditCheck = "unknown_fx"
                warnings.append("汇率暂缺，跨币种可用额度与折算净收益暂不可用")
            } else if effectiveLimit == nil {
                creditCheck = "unknown_limit"
                warnings.append("未设置卡片额度，请确认剩余额度充足")
            } else if let avail = availableCredit, let req = purchaseInCardCcy, avail + 1e-6 < req {
                let symbol = DashboardMoney.currencySymbol(cardCurrency)
                let code = isSharedPool ? "shared_pool_insufficient_credit" : "insufficient_credit"
                let prefix = isSharedPool ? "共享额度池剩余" : "可用额度不足，剩余"
                excluded.append(ExcludedCardItem(
                    cardId: card.id,
                    holderId: card.holderId,
                    holderName: snap.holderName,
                    bankName: bankName,
                    cardName: cardName,
                    cardNumberLast4: card.cardNumberLast4,
                    cardCurrency: cardCurrency,
                    excludeCode: code,
                    reason: "\(prefix) \(symbol)\(Int(avail)) 不足 \(symbol)\(Int(req))",
                    availableCredit: avail,
                    requiredInCardCurrency: req
                ))
                continue
            } else {
                creditCheck = "sufficient"
            }

            // 1) 回报规则
            let parsedRewards = parseRewardRules(product?.rewardRulesJson)
            var matchedRatePct = 0.0
            var rewardLabel = "未配置回报规则（按 0% 兜底）"
            var rewardSource = "卡产品暂无结构化回报规则"

            if let rules = parsedRewards {
                var hitCategory: CategoryRewardRuleV1?
                if let cat = input.category, let catRules = rules.categoryRules {
                    let eligible = catRules.filter { rule in
                        guard rule.category == cat else { return false }
                        let scope = rule.currencyScope ?? "all"
                        if scope == "domestic" && purchaseCurrency != cardCurrency { return false }
                        if scope == "foreign" && purchaseCurrency == cardCurrency { return false }
                        if let minTxn = rule.minTxnAmount, let req = purchaseInCardCcy, req < minTxn {
                            return false
                        }
                        return true
                    }
                    hitCategory = eligible.max(by: { $0.ratePct < $1.ratePct })
                }

                if let hit = hitCategory {
                    matchedRatePct = hit.ratePct
                    let est = round2(input.amount * matchedRatePct / 100.0)
                    let sym = DashboardMoney.currencySymbol(purchaseCurrency)
                    rewardLabel = hit.rawLabel?.isEmpty == false
                        ? "\(hit.rawLabel!)（预计赚取 \(sym)\(String(format: "%.2f", est))）"
                        : "类目返现 \(String(format: "%.2f", matchedRatePct))%（预计 \(sym)\(String(format: "%.2f", est))）"
                    rewardSource = "卡产品结构化规则 · \(bankName) \(cardName)"
                } else {
                    matchedRatePct = rules.baseRatePct
                    let est = round2(input.amount * matchedRatePct / 100.0)
                    let sym = DashboardMoney.currencySymbol(purchaseCurrency)
                    rewardLabel = rules.baseRawLabel?.isEmpty == false
                        ? "\(rules.baseRawLabel!)（预计赚取 \(sym)\(String(format: "%.2f", est))）"
                        : "基础返现 \(String(format: "%.2f", matchedRatePct))%（预计 \(sym)\(String(format: "%.2f", est))）"
                    rewardSource = "卡产品基础回报 · \(bankName) \(cardName)"
                }
            }
            let rewardScore = round2(matchedRatePct * wReward)

            // 2) FTF
            let fxFree = parseFxFreeCurrencies(product?.fxFreeCurrenciesJson)
            let effectiveFtfPct: Double
            let ftfStatus: String
            let ftfLabel: String
            if purchaseCurrency == cardCurrency {
                effectiveFtfPct = 0
                ftfStatus = "same_currency"
                ftfLabel = "外币手续费 0.00%（本币消费免货转）"
            } else if fxFree.contains(purchaseCurrency) {
                effectiveFtfPct = 0
                ftfStatus = "waived_currency"
                ftfLabel = "外币手续费 0.00%（命中免货转币种 \(purchaseCurrency)）"
            } else if let ftfRate = product?.ftfRate {
                effectiveFtfPct = max(0, ftfRate)
                ftfStatus = effectiveFtfPct == 0 ? "waived" : "charged"
                ftfLabel = effectiveFtfPct == 0
                    ? "外币手续费 0.00%（全币种免 FTF）"
                    : "外币手续费 -\(String(format: "%.2f", effectiveFtfPct))%"
            } else {
                effectiveFtfPct = 0
                ftfStatus = "unknown"
                ftfLabel = "外币手续费暂未配置（按 0% 估算）"
                warnings.append("未配置外币手续费（FTF）规则，暂按 0% 估算，实际可能产生 1%–2% 货转费")
            }
            let ftfRaw = round2(-effectiveFtfPct * wFtf)
            let ftfScore = ftfRaw == 0 ? 0.0 : ftfRaw
            let netRatePct = round2(matchedRatePct - effectiveFtfPct)

            // 3) 本币匹配
            let currencyBonus = purchaseCurrency == cardCurrency ? 0.20 : 0.00

            // 4) 免息期
            let graceWindow = BillingDateCalculator.calculateCardGracePeriod(
                card: card,
                cardProduct: product,
                today: purchaseDateObj
            )
            let graceScore = round2((min(max(Double(graceWindow.graceDays), 0), 60) / 60.0) * wGrace)

            // 5) 免年费进度加成（离线仅含卡级免年费缺口）
            var taskBonusScore = 0.0
            var skippedTaskHints: [String] = []
            var hasUrgentTask = false
            let cycleState = resolveAnnualFeeCycleState(card: card, product: product, todayStr: todayStr)
            if maxTaskBonus > 0,
               cycleState.nominalFee > 0,
               cycleState.status != "waived",
               cycleState.status != "paid",
               let waiverRule = parseWaiverRules(product?.annualFeeWaiverRulesJson),
               ["spend_amount", "spend_count", "spend_amount_or_count"].contains(waiverRule.waiverType) {
                let progress = parseWaiverProgress(card.waiverProgressJson)
                let taskCcy = DashboardFx.normalizeCurrencyOrDefault(waiverRule.targetCurrency, cardCurrency)
                let purchaseInTaskCcy = DashboardFx.convert(input.amount, from: purchaseCurrency, to: taskCcy, rates: rates)

                if let minTxn = waiverRule.perTxnMinAmount, let pAmt = purchaseInTaskCcy, pAmt < minTxn {
                    let sym = DashboardMoney.currencySymbol(taskCcy)
                    skippedTaskHints.append("当前消费金额低于免年费单笔门槛 \(sym)\(Int(minTxn))")
                } else {
                    let amtGap = max(0, (waiverRule.targetAmount ?? 0) - (progress?.amount ?? 0))
                    let cntGap = max(0, (waiverRule.targetCount ?? 0) - (progress?.count ?? 0))
                    let contribAmt = (waiverRule.targetAmount ?? 0) > 0 && amtGap > 0
                        ? min(1.0, (purchaseInTaskCcy ?? 0) / amtGap)
                        : 0.0
                    let contribCnt = (waiverRule.targetCount ?? 0) > 0 && cntGap > 0
                        ? min(1.0, 1.0 / Double(cntGap))
                        : 0.0
                    let contrib = max(contribAmt, contribCnt)
                    if contrib > 0 {
                        let urgency: Double
                        if let daysLeft = cycleState.daysUntilDue {
                            if daysLeft <= 7 { urgency = 1.0; hasUrgentTask = true }
                            else if daysLeft <= 30 { urgency = 0.7; hasUrgentTask = true }
                            else if daysLeft <= 90 { urgency = 0.4 }
                            else { urgency = 0.2 }
                        } else {
                            urgency = 0.25
                        }
                        taskBonusScore = min(maxTaskBonus, round2(4.0 * urgency * contrib))
                    }
                }
            }

            let totalScore = round2(rewardScore + ftfScore + currencyBonus + graceScore + taskBonusScore)
            let estNetPurchase = round2(input.amount * netRatePct / 100.0)
            let estNetDisplay = DashboardFx.convert(estNetPurchase, from: purchaseCurrency, to: displayCurrency, rates: rates).map { round2($0) }

            var breakdown: [ScoreBreakdownItem] = [
                ScoreBreakdownItem(factor: "reward", score: rewardScore, label: rewardLabel, ruleSource: rewardSource),
                ScoreBreakdownItem(factor: "ftf", score: ftfScore, label: ftfLabel, ruleSource: purchaseCurrency == cardCurrency ? "同币种消费" : "卡产品外币手续费"),
            ]
            if currencyBonus > 0 {
                breakdown.append(ScoreBreakdownItem(factor: "currency_match", score: currencyBonus, label: "本币消费无汇损 +\(String(format: "%.2f", currencyBonus))", ruleSource: "消费币种与卡币种一致"))
            }
            breakdown.append(ScoreBreakdownItem(
                factor: "grace_period",
                score: graceScore,
                label: "免息期 \(graceWindow.graceDays) 天",
                ruleSource: "账单日每月 \(card.overrideBillingDay ?? card.billingDay) 日 · 还款 \(df.string(from: graceWindow.nextDueDate))"
            ))
            if taskBonusScore > 0 {
                breakdown.append(ScoreBreakdownItem(
                    factor: "task_bonus",
                    score: taskBonusScore,
                    label: "临近免年费缺口推进 +\(String(format: "%.2f", taskBonusScore))",
                    ruleSource: cycleState.nextDueDate.map { "年费到期日 \($0)" } ?? "免年费进度"
                ))
            }

            let ruleCompleteness: String = {
                if parsedRewards != nil && product?.ftfRate != nil { return "complete" }
                if parsedRewards != nil || product?.ftfRate != nil { return "partial" }
                return "none"
            }()

            let item = CardRecommendationItem(
                rank: 0,
                cardId: card.id,
                holderId: card.holderId,
                holderName: snap.holderName,
                bankName: bankName,
                cardName: cardName,
                cardNumberLast4: card.cardNumberLast4,
                cardCurrency: cardCurrency,
                totalScore: totalScore,
                netRatePct: netRatePct,
                estimatedNetRewardPurchaseCcy: estNetPurchase,
                estimatedNetRewardDisplayCcy: estNetDisplay,
                graceDays: graceWindow.graceDays,
                nextBillingDate: df.string(from: graceWindow.nextBillingDate),
                nextDueDate: df.string(from: graceWindow.nextDueDate),
                availableCredit: availableCredit,
                isSharedQuota: isSharedPool,
                creditCheck: creditCheck,
                ruleCompleteness: ruleCompleteness,
                ftfStatus: ftfStatus,
                rewardsSummaryFallback: product?.rewardsSummary,
                scoreBreakdown: breakdown,
                matchedOpportunities: [],
                warnings: warnings,
                skippedTaskHints: skippedTaskHints
            )

            let tieRule = ruleCompleteness == "complete" ? 2 : (ruleCompleteness == "partial" ? 1 : 0)
            let tieSameCcy = purchaseCurrency == cardCurrency ? 1 : 0
            let tieUrgent = hasUrgentTask ? 1 : 0
            let tieCredit = creditCheck == "sufficient" ? (availableCredit ?? 0) : -1
            candidates.append((item, tieRule, tieSameCcy, tieUrgent, graceWindow.graceDays, tieCredit))
        }

        let sorted = candidates.sorted { a, b in
            if abs(a.item.totalScore - b.item.totalScore) >= 0.005 {
                return a.item.totalScore > b.item.totalScore
            }
            if a.tieRule != b.tieRule { return a.tieRule > b.tieRule }
            if a.tieSameCcy != b.tieSameCcy { return a.tieSameCcy > b.tieSameCcy }
            if a.tieUrgent != b.tieUrgent { return a.tieUrgent > b.tieUrgent }
            if a.tieGrace != b.tieGrace { return a.tieGrace > b.tieGrace }
            if a.tieCredit != b.tieCredit { return a.tieCredit > b.tieCredit }
            return a.item.cardId < b.item.cardId
        }

        let ranked: [CardRecommendationItem] = sorted.enumerated().map { idx, entry in
            var copy = entry.item
            copy.rank = idx + 1
            return copy
        }

        let allUnconfigured = !ranked.isEmpty && ranked.allSatisfy { $0.ruleCompleteness == "none" }
        bannerWarnings.insert("离线模式：暂不含线上最新权益机会，仅按本地规则与免息期计算")
        if fxMissingEncountered {
            bannerWarnings.insert("部分币种汇率暂不可用，跨币种卡额度校验与折算净收益已暂停")
        }

        let emptyReason: String? = {
            if !ranked.isEmpty { return nil }
            if creditSnapshots.isEmpty { return "no_credit_cards" }
            if excluded.allSatisfy({ $0.excludeCode == "card_frozen" || $0.excludeCode == "card_cancelled" }) {
                return "all_frozen_or_cancelled"
            }
            return "all_insufficient_credit"
        }()

        return RecommendationEngineOutput(
            purchaseDate: todayStr,
            optimizeFor: mode.rawValue,
            fxAvailable: rates != nil && !fxMissingEncountered,
            allCardsUnconfigured: allUnconfigured,
            bannerWarnings: Array(bannerWarnings).sorted(),
            emptyReason: emptyReason,
            topRecommendations: Array(ranked.prefix(3)),
            otherCandidates: Array(ranked.dropFirst(3)),
            excludedCards: excluded
        )
    }
}
