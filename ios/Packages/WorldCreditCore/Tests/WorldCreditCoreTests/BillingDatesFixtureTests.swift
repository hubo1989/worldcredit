import Testing
import Foundation
@testable import WorldCreditCore

struct FixtureFile: Codable {
    struct CaseItem: Codable {
        let id: String
        let description: String
        let card: CardItem
        let cardProduct: CardProductItem
        let billMonth: String
        let expectedBillingDate: String
        let expectedDueDate: String

        enum CodingKeys: String, CodingKey {
            case id, description, card
            case cardProduct = "card_product"
            case billMonth = "bill_month"
            case expectedBillingDate = "expected_billing_date"
            case expectedDueDate = "expected_due_date"
        }
    }

    struct CardItem: Codable {
        let billingDay: Int
        let overrideBillingDay: Int?
        let overrideDueType: PaymentDueType?
        let overrideDueValue: Int?

        enum CodingKeys: String, CodingKey {
            case billingDay = "billing_day"
            case overrideBillingDay = "override_billing_day"
            case overrideDueType = "override_due_type"
            case overrideDueValue = "override_due_value"
        }
    }

    struct CardProductItem: Codable {
        let paymentDueType: PaymentDueType
        let paymentDueValue: Int

        enum CodingKeys: String, CodingKey {
            case paymentDueType = "payment_due_type"
            case paymentDueValue = "payment_due_value"
        }
    }

    struct LoanCaseItem: Codable {
        let id: String
        let loanDueDay: Int
        let today: String
        let expectedNextDue: String

        enum CodingKeys: String, CodingKey {
            case id
            case loanDueDay = "loan_due_day"
            case today
            case expectedNextDue = "expected_next_due"
        }
    }

    struct DiffDaysCaseItem: Codable {
        let target: String
        let today: String
        let expectedDiff: Int
        let expectedLabel: String

        enum CodingKeys: String, CodingKey {
            case target, today
            case expectedDiff = "expected_diff"
            case expectedLabel = "expected_label"
        }
    }

    let cases: [CaseItem]
    let loanCases: [LoanCaseItem]
    let diffDaysCases: [DiffDaysCaseItem]

    enum CodingKeys: String, CodingKey {
        case cases
        case loanCases = "loan_cases"
        case diffDaysCases = "diff_days_cases"
    }
}

private let dateFormatter: DateFormatter = {
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd"
    df.locale = Locale(identifier: "en_US_POSIX")
    df.timeZone = TimeZone.current
    return df
}()

@Suite("Shared Fixtures: Billing and Due Dates")
struct BillingDatesFixtureTests {
    func loadFixtures() throws -> FixtureFile {
        // Resolve path relative to this file
        let currentFile = URL(fileURLWithPath: #filePath)
        let root = currentFile
            .deletingLastPathComponent() // WorldCreditCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // WorldCreditCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // app (workspace root)
        let fixtureUrl = root.appendingPathComponent("shared/fixtures/billing-dates.json")
        let data = try Data(contentsOf: fixtureUrl)
        return try JSONDecoder().decode(FixtureFile.self, from: data)
    }

    @Test("Credit Card Billing & Due Dates match shared fixtures")
    func testCreditCardBillingDates() throws {
        let fixtures = try loadFixtures()
        for item in fixtures.cases {
            let card = CreditCard(
                id: "c-\(item.id)",
                holderId: "h1",
                cardProductId: "cp1",
                billingDay: item.card.billingDay,
                overrideBillingDay: item.card.overrideBillingDay,
                overrideDueType: item.card.overrideDueType,
                overrideDueValue: item.card.overrideDueValue
            )
            let cardProduct = CardProduct(
                id: "cp1",
                cardName: "Test Card",
                paymentDueType: item.cardProduct.paymentDueType,
                paymentDueValue: item.cardProduct.paymentDueValue
            )
            guard let billMonth = dateFormatter.date(from: item.billMonth) else {
                Issue.record("Failed to parse billMonth: \(item.billMonth)")
                continue
            }

            let effectiveBillingDay = BillingDateCalculator.getEffectiveBillingDay(card: card)
            let actualBillingDate = BillingDateCalculator.getActualBillingDate(billingDay: effectiveBillingDay, month: billMonth)
            let calculatedDueDate = BillingDateCalculator.getDueDate(card: card, cardProduct: cardProduct, billMonth: billMonth)

            #expect(dateFormatter.string(from: actualBillingDate) == item.expectedBillingDate, "\(item.id) billing date mismatch")
            #expect(dateFormatter.string(from: calculatedDueDate) == item.expectedDueDate, "\(item.id) due date mismatch")
        }
    }

    @Test("Loan next due dates match shared fixtures")
    func testLoanNextDueDates() throws {
        let fixtures = try loadFixtures()
        for item in fixtures.loanCases {
            guard let today = dateFormatter.date(from: item.today) else {
                Issue.record("Failed to parse today: \(item.today)")
                continue
            }
            let nextDue = BillingDateCalculator.getLoanNextDueDate(loanDueDay: item.loanDueDay, today: today)
            #expect(dateFormatter.string(from: nextDue) == item.expectedNextDue, "\(item.id) loan next due mismatch")
        }
    }

    @Test("Diff days and distance labels match shared fixtures")
    func testDiffDaysAndLabels() throws {
        let fixtures = try loadFixtures()
        for item in fixtures.diffDaysCases {
            guard let target = dateFormatter.date(from: item.target),
                  let today = dateFormatter.date(from: item.today) else {
                Issue.record("Failed to parse dates")
                continue
            }
            let diff = BillingDateCalculator.diffInCalendarDays(target: target, today: today)
            let label = BillingDateCalculator.dueDistanceLabel(days: diff)

            #expect(diff == item.expectedDiff, "Diff mismatch for \(item.target)")
            #expect(label == item.expectedLabel, "Label mismatch for \(item.target)")
        }
    }
}
