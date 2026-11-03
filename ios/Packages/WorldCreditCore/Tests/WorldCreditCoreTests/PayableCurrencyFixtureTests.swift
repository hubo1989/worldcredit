import Foundation
import Testing
@testable import WorldCreditCore

private struct PayableCurrencyFixtureFile: Codable {
    struct CurrencyItem: Codable {
        let code: String
        let label: String
        let symbol: String
        let aliases: [String]
    }

    struct NormalizationCase: Codable {
        let id: String
        let raw: String
        let expected: String?
    }

    let paymentHistoryLimit: Int

    let currencies: [CurrencyItem]
    let normalizationCases: [NormalizationCase]

    enum CodingKeys: String, CodingKey {
        case currencies
        case normalizationCases = "normalization_cases"
        case paymentHistoryLimit = "payment_history_limit"
    }
}

@Suite("Shared Fixtures: Payable Currency & Legacy Compatibility")
struct PayableCurrencyFixtureTests {
    private func loadFixtures() throws -> PayableCurrencyFixtureFile {
        let currentFile = URL(fileURLWithPath: #filePath)
        let root = currentFile
            .deletingLastPathComponent() // WorldCreditCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // WorldCreditCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // workspace root
        let fixtureUrl = root.appendingPathComponent("shared/fixtures/payable-currencies.json")
        let data = try Data(contentsOf: fixtureUrl)
        return try JSONDecoder().decode(PayableCurrencyFixtureFile.self, from: data)
    }

    @Test("Payable payment history limit matches shared fixture")
    func testPaymentHistoryLimitMatchesFixture() throws {
        let fixtures = try loadFixtures()
        #expect(PayablePaymentHistory.limit == fixtures.paymentHistoryLimit)
    }

    @Test("PayableCurrency cases, labels, and symbols match shared TS/Swift fixture")
    func testClosedCurrencySetMatchesFixture() throws {
        let fixtures = try loadFixtures()
        #expect(PayableCurrency.allCases.map(\.rawValue) == fixtures.currencies.map(\.code))
        for item in fixtures.currencies {
            let currency = try #require(PayableCurrency(rawValue: item.code))
            #expect(currency.label == item.label, "\(item.code) label mismatch")
            #expect(currency.symbol == item.symbol, "\(item.code) symbol mismatch")
        }
    }

    @Test("PayableCurrency.normalize handles trim/uppercase/Chinese aliases and preserves unknown as nil")
    func testNormalizationCasesMatchFixture() throws {
        let fixtures = try loadFixtures()
        for item in fixtures.normalizationCases {
            #expect(
                PayableCurrency.normalize(item.raw)?.rawValue == item.expected,
                "\(item.id) normalization mismatch"
            )
        }
    }

    @Test("Form selection & draft encoding keep legacy unknown currency visible and require explicit CNY/USD/HKD when changing currency")
    func testLegacyUnknownCurrencySelectionAndDraft() throws {
        let legacySelection = PayableCurrencySelection(persistedCurrency: " EUR ")
        #expect(legacySelection == .legacy(" EUR "))
        #expect(legacySelection.legacyCode == " EUR ")
        #expect(legacySelection.draftCurrency == " EUR ")
        let emptySelection = PayableCurrencySelection(persistedCurrency: "  ")
        #expect(emptySelection == .legacy("  "))

        let aliasSelection = PayableCurrencySelection(persistedCurrency: " 人民币 ")
        #expect(aliasSelection == .supported(.cny))
        #expect(aliasSelection.draftCurrency == "CNY")

        let switchedSelection = PayableCurrencySelection.supported(.usd)
        let switchedDraft = PayableDraft(
            name: "欧洲订阅",
            category: .other,
            amount: 88,
            currency: switchedSelection.draftCurrency,
            dueDay: 12
        )
        let switchedData = try JSONEncoder().encode(switchedDraft)
        let switchedJson = try #require(JSONSerialization.jsonObject(with: switchedData) as? [String: Any])
        #expect(switchedJson["currency"] as? String == "USD")
    }
}
