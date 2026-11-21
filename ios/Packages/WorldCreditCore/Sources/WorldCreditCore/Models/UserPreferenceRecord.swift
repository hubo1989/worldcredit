import Foundation
import GRDB
import OSLog

public struct UserDisplayConfig: Codable, Equatable, Hashable, Sendable {
    public var privacyMode: Bool
    public var showMinPayment: Bool
    public var showStatementDate: Bool
    public var showAnnualFee: Bool
    public var showCardLast4: Bool
    public var defaultCurrency: String

    public init(
        privacyMode: Bool = false,
        showMinPayment: Bool = true,
        showStatementDate: Bool = true,
        showAnnualFee: Bool = true,
        showCardLast4: Bool = true,
        defaultCurrency: String = "CNY"
    ) {
        self.privacyMode = privacyMode
        self.showMinPayment = showMinPayment
        self.showStatementDate = showStatementDate
        self.showAnnualFee = showAnnualFee
        self.showCardLast4 = showCardLast4
        self.defaultCurrency = defaultCurrency
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        privacyMode = try row.decodeFlexibleBoolIfPresent(forKey: .privacyMode) ?? false
        showMinPayment = try row.decodeFlexibleBoolIfPresent(forKey: .showMinPayment) ?? true
        showStatementDate = try row.decodeFlexibleBoolIfPresent(forKey: .showStatementDate) ?? true
        showAnnualFee = try row.decodeFlexibleBoolIfPresent(forKey: .showAnnualFee) ?? true
        showCardLast4 = try row.decodeFlexibleBoolIfPresent(forKey: .showCardLast4) ?? true
        defaultCurrency = try row.decodeIfPresent(String.self, forKey: .defaultCurrency) ?? "CNY"
    }

    public static func decode(fromJsonString json: String) throws -> UserDisplayConfig {
        guard let data = json.data(using: .utf8) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Invalid UTF-8 display_config JSON"))
        }
        return try JSONDecoder().decode(UserDisplayConfig.self, from: data)
    }

    public func toJsonString() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(self)
        return String(decoding: data, as: UTF8.self)
    }

    enum CodingKeys: String, CodingKey {
        case privacyMode = "privacy_mode"
        case showMinPayment = "show_min_payment"
        case showStatementDate = "show_statement_date"
        case showAnnualFee = "show_annual_fee"
        case showCardLast4 = "show_card_last4"
        case defaultCurrency = "default_currency"
    }
}

public struct UserPreferenceRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "user_preferences"

    public static let defaultDisplayConfigJson = #"{"privacy_mode":false,"show_min_payment":true,"show_statement_date":true,"show_annual_fee":true,"show_card_last4":true,"default_currency":"CNY"}"#
    public static let defaultReminderConfigJson = #"{"remind_days_before":[3,1,0],"quiet_hours_start":"22:00","quiet_hours_end":"08:00","enabled_channels":["web_push"]}"#

    public var id: String?
    public var userId: String
    public var displayConfig: String
    public var reminderConfig: String
    public var updatedAt: String

    public init(
        id: String? = nil,
        userId: String,
        displayConfig: String = UserPreferenceRecord.defaultDisplayConfigJson,
        reminderConfig: String = UserPreferenceRecord.defaultReminderConfigJson,
        updatedAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.userId = userId
        self.displayConfig = displayConfig
        self.reminderConfig = reminderConfig
        self.updatedAt = updatedAt
    }

    public init(
        id: String? = nil,
        userId: String,
        displayConfig: UserDisplayConfig,
        reminderConfig: String = UserPreferenceRecord.defaultReminderConfigJson,
        updatedAt: String = ISO8601DateFormatter().string(from: Date())
    ) throws {
        self.id = id
        self.userId = userId
        self.displayConfig = try displayConfig.toJsonString()
        self.reminderConfig = reminderConfig
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decodeIfPresent(String.self, forKey: .id)
        userId = try row.decode(String.self, forKey: .userId)
        displayConfig = try row.decodeJSONStringIfPresent(forKey: .displayConfig) ?? Self.defaultDisplayConfigJson
        reminderConfig = try row.decodeJSONStringIfPresent(forKey: .reminderConfig) ?? Self.defaultReminderConfigJson
        updatedAt = try row.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }

    private static let logger = Logger(subsystem: "com.worldcredit.core", category: "UserPreferenceRecord")

    public func decodedDisplayConfig() -> UserDisplayConfig {
        do {
            return try UserDisplayConfig.decode(fromJsonString: displayConfig)
        } catch {
            Self.logger.error("Failed to decode display_config JSON: \(error.localizedDescription, privacy: .public)")
            // 配置 JSON 损坏时走隐私优先（fail-closed），避免敏感金额与卡号明文暴露
            return UserDisplayConfig(privacyMode: true)
        }
    }

    public mutating func setDisplayConfig(_ config: UserDisplayConfig) throws {
        displayConfig = try config.toJsonString()
    }

    public func decodedReminderConfig() -> UserReminderPreferences {
        guard let data = reminderConfig.data(using: .utf8) else {
            Self.logger.error("Failed to convert reminder_config to UTF-8 data")
            return UserReminderPreferences()
        }
        do {
            return try JSONDecoder().decode(UserReminderPreferences.self, from: data)
        } catch {
            Self.logger.error("Failed to decode reminder_config JSON: \(error.localizedDescription, privacy: .public)")
            return UserReminderPreferences()
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case displayConfig = "display_config"
        case reminderConfig = "reminder_config"
        case updatedAt = "updated_at"
    }
}
