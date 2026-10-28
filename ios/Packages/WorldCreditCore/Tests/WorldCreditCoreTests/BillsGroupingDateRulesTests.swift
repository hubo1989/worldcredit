import Foundation
import Testing
@testable import WorldCreditCore

/// 缺账提醒与下期账单/还款日 —— 移植 Web `lib/utils.ts` 的 `missingStatementDays`
/// (2026-10-20 规则)与卡组下期日期，全部走 Asia/Shanghai 自然日口径。
@Suite("Missing statement reminder and next billing/due dates")
struct BillsGroupingDateRulesTests {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return cal
    }

    /// "yyyy-MM-dd" → 上海时区当天零点
    private func day(_ s: String) -> Date {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        precondition(parts.count == 3, "expected yyyy-MM-dd, got \(s)")
        var c = DateComponents()
        c.year = parts[0]
        c.month = parts[1]
        c.day = parts[2]
        return calendar.date(from: c)!
    }

    private func dateString(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return f.string(from: d)
    }

    private func makeItem(
        cardId: String = "c1",
        billingDay: Int = 10,
        overrideBillingDay: Int? = nil,
        cardType: String = "credit",
        loanDueDay: Int? = nil,
        product: CardProduct? = CardProduct(
            id: "p1", bankName: "测试银行", cardName: "测试卡",
            currency: "CNY", paymentDueType: .fixed, paymentDueValue: 25),
        billId: String = "b1",
        billMonth: String = "2026-10",
        status: String = "unpaid",
        remaining: Double = 100
    ) -> BillDisplayItem {
        let card = CreditCard(
            id: cardId, holderId: "h1", cardProductId: product?.id ?? "p-missing",
            billingDay: billingDay, overrideBillingDay: overrideBillingDay,
            cardType: cardType, loanDueDay: loanDueDay)
        let bill = Bill(
            id: billId, cardId: cardId, billMonth: billMonth,
            billAmount: remaining, dueDate: "2026-11-25", status: status)
        return BillDisplayItem(
            bill: bill, card: card, product: product, bank: nil, holder: nil,
            totalPaid: 0, remainingAmount: remaining, daysUntilDue: 10,
            isOverdue: false, distanceLabel: "", interestFreeDaysToday: 0)
    }

    // MARK: - 下期账单日 / 下期还款日

    @Test("next billing/due dates follow billing day with month-end clamp")
    func nextDatesForCreditCard() throws {
        // 账单日 10 已过(10-23) → 今天刷卡进 11 月账期:出账 11-10,还款 12-25(fixed 25)
        let passed = BillsGrouping.groups(from: [makeItem(billingDay: 10)])[0]
        #expect(dateString(try #require(passed.nextBillingDate(today: day("2026-10-23")))) == "2026-11-10")
        #expect(dateString(try #require(passed.nextDueDate(today: day("2026-10-23")))) == "2026-12-25")

        // 账单日 24 未到 → 本月出账 10-24,还款 11-25
        let upcoming = BillsGrouping.groups(from: [makeItem(billingDay: 24)])[0]
        #expect(dateString(try #require(upcoming.nextBillingDate(today: day("2026-10-23")))) == "2026-10-24")
        #expect(dateString(try #require(upcoming.nextDueDate(today: day("2026-10-23")))) == "2026-11-25")

        // 月末收拢:10 月有 31 天,今天(10-23)还没过账单日 → 本月 10-31 出账,11-25 还款
        let clamped = BillsGrouping.groups(from: [makeItem(billingDay: 31)])[0]
        #expect(dateString(try #require(clamped.nextBillingDate(today: day("2026-10-23")))) == "2026-10-31")
        #expect(dateString(try #require(clamped.nextDueDate(today: day("2026-10-23")))) == "2026-11-25")
        // 过了 10-31 才进入 11 月账期:账单日 31 收拢为 11-30,还款 12-25
        #expect(dateString(try #require(clamped.nextBillingDate(today: day("2026-11-05")))) == "2026-11-30")
        #expect(dateString(try #require(clamped.nextDueDate(today: day("2026-11-05")))) == "2026-12-25")
    }

    @Test("missing product yields nil next dates instead of fabricated today")
    func nextDatesWithoutProduct() {
        let group = BillsGrouping.groups(from: [makeItem(product: nil)])[0]
        #expect(group.nextBillingDate(today: day("2026-10-23")) == nil)
        #expect(group.nextDueDate(today: day("2026-10-23")) == nil)
    }

    @Test("loan cards use loan due day for both dates")
    func nextDatesForLoan() throws {
        let group = BillsGrouping.groups(from: [
            makeItem(cardType: "loan", loanDueDay: 5, product: nil, billMonth: "2026-08")
        ])[0]
        // 本月 5 号已过(10-23) → 下期 11-05;贷款出账日与还款日同一天
        #expect(dateString(try #require(group.nextDueDate(today: day("2026-10-23")))) == "2026-11-05")
        #expect(dateString(try #require(group.nextBillingDate(today: day("2026-10-23")))) == "2026-11-05")

        // 贷款缺 loan_due_day:没有月供日就不编造日期
        let noDueDay = BillsGrouping.groups(from: [
            makeItem(cardType: "loan", loanDueDay: nil, product: nil, billMonth: "2026-08")
        ])[0]
        #expect(noDueDay.nextBillingDate(today: day("2026-10-23")) == nil)
        #expect(noDueDay.nextDueDate(today: day("2026-10-23")) == nil)
    }

    // MARK: - 缺账提醒(纯函数,移植 Web missingStatementDays)

    @Test("no baseline or invalid month never reminds")
    func missingStatementRequiresBaseline() {
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: nil, today: day("2026-10-14")) == nil)
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "abc", today: day("2026-10-14")) == nil)
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-13", today: day("2026-10-14")) == nil)
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026", today: day("2026-10-14")) == nil)
    }

    @Test("reminds only after grace days past the next statement date")
    func missingStatementGraceWindow() {
        // 基线 2026-09 → 下一期出账 2026-10-10
        // 出账当天、容忍期内(第 3 天)都不提醒
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-09", today: day("2026-10-10")) == nil)
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-09", today: day("2026-10-13")) == nil)
        // 第 4 天起提醒,返回已过天数
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-09", today: day("2026-10-14")) == 4)
    }

    @Test("baseline is the next period, catching multi-month gaps")
    func missingStatementMultiMonthGap() {
        // 连续几期没收到:基线 2026-08 → 盯的是 2026-09-10,不能等 10 月账单日
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-08", today: day("2026-10-23")) == 43)
    }

    @Test("cross-year and month-end clamping")
    func missingStatementDateEdges() {
        // 跨年:基线 2026-12 → 下一期 2027-01-10
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-12", today: day("2027-01-14")) == 4)
        // 月末:账单日 31 落在 30 天的月 → 2026-11-30 出账
        #expect(BillsGrouping.missingStatementDays(billingDay: 31, latestBillMonth: "2026-10", today: day("2026-12-05")) == 5)
        // 2 月:账单日 30 → 2027-02-28(平年)
        #expect(BillsGrouping.missingStatementDays(billingDay: 30, latestBillMonth: "2027-01", today: day("2027-03-04")) == 4)
        // 非法账单日(<1)按 1 号算,与 Web 同口径
        #expect(BillsGrouping.missingStatementDays(billingDay: 0, latestBillMonth: "2026-09", today: day("2026-10-05")) == 4)
        // 下一期还没到(基线就是最新一期)不提醒
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-10", today: day("2026-10-14")) == nil)
    }

    // MARK: - 卡组级缺账提醒(基线必须来自全量账单)

    @Test("latestBillMonth baseline must come from unfiltered bills")
    func missingStatementUsesFullListBaseline() throws {
        // 最新一期(2026-10)已还:unpaid 过滤后组里只剩 2026-09
        let paidLatest = makeItem(billId: "b-latest", billMonth: "2026-10", status: "paid", remaining: 0)
        let unpaidOlder = makeItem(billId: "b-older", billMonth: "2026-09", remaining: 200)
        let full: [BillDisplayItem] = [paidLatest, unpaidOlder]
        let filtered: [BillDisplayItem] = [unpaidOlder]

        #expect(BillsGrouping.latestBillMonth(of: []) == nil)
        #expect(BillsGrouping.latestBillMonth(of: full) == "2026-10")
        #expect(BillsGrouping.latestBillMonth(of: filtered) == "2026-09")

        let group = BillsGrouping.groups(from: filtered)[0]
        // 全量基线 2026-10 → 下一期 2026-11-10 还没到:不提醒。
        // 若基线取了过滤组内的 2026-09,会误报 4 天——这就是要防的误报路径。
        #expect(group.missingStatementDays(
            latestBillMonth: BillsGrouping.latestBillMonth(of: full),
            today: day("2026-10-14")) == nil)
        #expect(BillsGrouping.missingStatementDays(billingDay: 10, latestBillMonth: "2026-09", today: day("2026-10-14")) == 4)
    }

    @Test("loans are excluded from missing statement reminders")
    func missingStatementExcludesLoan() {
        let group = BillsGrouping.groups(from: [
            makeItem(cardType: "loan", loanDueDay: 5, product: nil, billMonth: "2026-08")
        ])[0]
        // 按信用卡规则本该提醒 43 天,贷款不参与
        #expect(group.missingStatementDays(latestBillMonth: "2026-08", today: day("2026-10-23")) == nil)
    }

    @Test("group reminder works without product and respects billing-day override")
    func missingStatementWithoutProductAndOverride() {
        // 缺产品:账单日在卡上,提醒不受影响;无基线仍不提醒
        let noProduct = BillsGrouping.groups(from: [makeItem(product: nil, billMonth: "2026-09")])[0]
        #expect(noProduct.missingStatementDays(latestBillMonth: nil, today: day("2026-10-14")) == nil)
        #expect(noProduct.missingStatementDays(latestBillMonth: "2026-09", today: day("2026-10-14")) == 4)

        // override 优先于卡默认:账单日按 20 算 → 期望 2026-10-20,today 10-24 → 4
        let overridden = BillsGrouping.groups(from: [
            makeItem(billingDay: 10, overrideBillingDay: 20, billMonth: "2026-09")
        ])[0]
        #expect(overridden.missingStatementDays(latestBillMonth: "2026-09", today: day("2026-10-24")) == 4)
    }
}
