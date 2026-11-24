import Foundation

// MARK: - 统一智能账单导入、草稿箱、密码本与多 Gmail 模型

public struct ShareCardLite: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var bankName: String
    public var cardName: String
    public var last4: String
    public var currency: String
    public var holderName: String

    public init(
        id: String,
        bankName: String,
        cardName: String,
        last4: String,
        currency: String,
        holderName: String
    ) {
        self.id = id
        self.bankName = bankName
        self.cardName = cardName
        self.last4 = last4
        self.currency = currency
        self.holderName = holderName
    }

    enum CodingKeys: String, CodingKey {
        case id, currency
        case bankName = "bank_name"
        case cardName = "card_name"
        case last4
        case holderName = "holder_name"
    }
}

public enum ShareExtensionCacheStore {
    public static let appGroupId = "group.com.chunfenshijie.worldcredit"
    private static let relativeDirectory = "ShareExtensionCache"
    private static let fileName = "cards_lite.json"

    public static func cacheFileURL(
        fileManager: FileManager = .default
    ) -> URL? {
        guard let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            return nil
        }
        return container
            .appendingPathComponent(relativeDirectory, isDirectory: true)
            .appendingPathComponent(fileName)
    }

    public static func writeCards(_ cards: [ShareCardLite], fileManager: FileManager = .default) {
        guard let fileURL = cacheFileURL(fileManager: fileManager) else { return }
        let dir = fileURL.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(cards) else { return }
        try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public static func clear(fileManager: FileManager = .default) {
        guard let fileURL = cacheFileURL(fileManager: fileManager) else { return }
        try? fileManager.removeItem(at: fileURL)
    }
}

public struct BillDraftSubtotalDTO: Codable, Sendable, Equatable {
    public var cardLast4: String
    public var cardName: String?
    public var amount: Double
    public var currency: String?

    enum CodingKeys: String, CodingKey {
        case cardLast4 = "card_last4"
        case cardName = "card_name"
        case amount, currency
    }
}

public struct BillDraftLegacyLedgerDTO: Codable, Sendable, Equatable {
    public var entryId: String
    public var ledgerId: String
    public var paidAmount: Double
    public var paymentStatus: String
    public var paymentDate: String?
    public var paymentNote: String?

    enum CodingKeys: String, CodingKey {
        case entryId = "entry_id"
        case ledgerId = "ledger_id"
        case paidAmount = "paid_amount"
        case paymentStatus = "payment_status"
        case paymentDate = "payment_date"
        case paymentNote = "payment_note"
    }
}

public struct BillDraftPayloadDTO: Codable, Sendable, Equatable {
    public var isBill: Bool?
    public var emailKind: String?
    public var bankName: String?
    public var cardLast4: String?
    public var holderHint: String?
    public var currency: String?
    public var billMonth: String?
    public var statementStart: String?
    public var statementEnd: String?
    public var statementDate: String?
    public var statementDay: Int?
    public var billAmount: Double?
    public var minPayment: Double?
    public var creditLimit: Double?
    public var dueDate: String?
    public var dueDateStatus: String?
    public var warnings: [String]?
    public var candidateCardIds: [String]?
    public var attachmentIds: [String]?
    public var cardSubtotals: [BillDraftSubtotalDTO]?
    public var legacyLedger: BillDraftLegacyLedgerDTO?
    public var rawText: String?

    public init(
        isBill: Bool? = nil,
        emailKind: String? = nil,
        bankName: String? = nil,
        cardLast4: String? = nil,
        holderHint: String? = nil,
        currency: String? = nil,
        billMonth: String? = nil,
        statementStart: String? = nil,
        statementEnd: String? = nil,
        statementDate: String? = nil,
        statementDay: Int? = nil,
        billAmount: Double? = nil,
        minPayment: Double? = nil,
        creditLimit: Double? = nil,
        dueDate: String? = nil,
        dueDateStatus: String? = nil,
        warnings: [String]? = nil,
        candidateCardIds: [String]? = nil,
        attachmentIds: [String]? = nil,
        cardSubtotals: [BillDraftSubtotalDTO]? = nil,
        legacyLedger: BillDraftLegacyLedgerDTO? = nil,
        rawText: String? = nil
    ) {
        self.isBill = isBill
        self.emailKind = emailKind
        self.bankName = bankName
        self.cardLast4 = cardLast4
        self.holderHint = holderHint
        self.currency = currency
        self.billMonth = billMonth
        self.statementStart = statementStart
        self.statementEnd = statementEnd
        self.statementDate = statementDate
        self.statementDay = statementDay
        self.billAmount = billAmount
        self.minPayment = minPayment
        self.creditLimit = creditLimit
        self.dueDate = dueDate
        self.dueDateStatus = dueDateStatus
        self.warnings = warnings
        self.candidateCardIds = candidateCardIds
        self.attachmentIds = attachmentIds
        self.cardSubtotals = cardSubtotals
        self.legacyLedger = legacyLedger
        self.rawText = rawText
    }

    enum CodingKeys: String, CodingKey {
        case isBill = "is_bill"
        case emailKind = "email_kind"
        case bankName = "bank_name"
        case cardLast4 = "card_last4"
        case holderHint = "holder_hint"
        case currency
        case billMonth = "bill_month"
        case statementStart = "statement_start"
        case statementEnd = "statement_end"
        case statementDate = "statement_date"
        case statementDay = "statement_day"
        case billAmount = "bill_amount"
        case minPayment = "min_payment"
        case creditLimit = "credit_limit"
        case dueDate = "due_date"
        case dueDateStatus = "due_date_status"
        case warnings
        case candidateCardIds = "candidate_card_ids"
        case attachmentIds = "attachment_ids"
        case cardSubtotals = "card_subtotals"
        case legacyLedger = "legacy_ledger"
        case rawText = "raw_text"
    }
}

public struct DuplicateBillPreviewDTO: Codable, Sendable, Equatable {
    public var billId: String
    public var billMonth: String
    public var billAmount: Double
    public var paidAmount: Double
    public var status: String
    public var hasOverride: Bool

    enum CodingKeys: String, CodingKey {
        case billId = "bill_id"
        case billMonth = "bill_month"
        case billAmount = "bill_amount"
        case paidAmount = "paid_amount"
        case status
        case hasOverride = "has_override"
    }
}

public struct BillImportDraftDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var createdBy: String
    public var cardId: String?
    public var holderId: String?
    public var matchedAccountId: String?
    public var sourceType: String
    public var sourceConnectionId: String?
    public var sourceLabel: String?
    public var rawText: String?
    public var fileRef: String?
    public var parsedPayload: BillDraftPayloadDTO
    public var status: String
    public var parseStatus: String
    public var attributionSource: String?
    public var attributionTrusted: Bool
    public var batchId: String?
    public var passwordHint: String?
    public var errorMessage: String?
    public var confidence: Double?
    public var duplicateBillPreview: DuplicateBillPreviewDTO?
    public var createdAt: String
    public var confirmedAt: String?
    public var confirmedBillId: String?

    public init(
        id: String,
        createdBy: String = "",
        cardId: String? = nil,
        holderId: String? = nil,
        matchedAccountId: String? = nil,
        sourceType: String = "email",
        sourceConnectionId: String? = nil,
        sourceLabel: String? = nil,
        rawText: String? = nil,
        fileRef: String? = nil,
        parsedPayload: BillDraftPayloadDTO = BillDraftPayloadDTO(),
        status: String = "draft",
        parseStatus: String = "ready",
        attributionSource: String? = nil,
        attributionTrusted: Bool = false,
        batchId: String? = nil,
        passwordHint: String? = nil,
        errorMessage: String? = nil,
        confidence: Double? = nil,
        duplicateBillPreview: DuplicateBillPreviewDTO? = nil,
        createdAt: String = "",
        confirmedAt: String? = nil,
        confirmedBillId: String? = nil
    ) {
        self.id = id
        self.createdBy = createdBy
        self.cardId = cardId
        self.holderId = holderId
        self.matchedAccountId = matchedAccountId
        self.sourceType = sourceType
        self.sourceConnectionId = sourceConnectionId
        self.sourceLabel = sourceLabel
        self.rawText = rawText
        self.fileRef = fileRef
        self.parsedPayload = parsedPayload
        self.status = status
        self.parseStatus = parseStatus
        self.attributionSource = attributionSource
        self.attributionTrusted = attributionTrusted
        self.batchId = batchId
        self.passwordHint = passwordHint
        self.errorMessage = errorMessage
        self.confidence = confidence
        self.duplicateBillPreview = duplicateBillPreview
        self.createdAt = createdAt
        self.confirmedAt = confirmedAt
        self.confirmedBillId = confirmedBillId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        cardId = try c.decodeIfPresent(String.self, forKey: .cardId)
        holderId = try c.decodeIfPresent(String.self, forKey: .holderId)
        matchedAccountId = try c.decodeIfPresent(String.self, forKey: .matchedAccountId)
        sourceType = try c.decodeIfPresent(String.self, forKey: .sourceType) ?? "email"
        sourceConnectionId = try c.decodeIfPresent(String.self, forKey: .sourceConnectionId)
        sourceLabel = try c.decodeIfPresent(String.self, forKey: .sourceLabel)
        rawText = try c.decodeIfPresent(String.self, forKey: .rawText)
        fileRef = try c.decodeIfPresent(String.self, forKey: .fileRef)
        parsedPayload = try c.decodeIfPresent(BillDraftPayloadDTO.self, forKey: .parsedPayload) ?? BillDraftPayloadDTO()
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "draft"
        parseStatus = try c.decodeIfPresent(String.self, forKey: .parseStatus) ?? "ready"
        attributionSource = try c.decodeIfPresent(String.self, forKey: .attributionSource)
        attributionTrusted = try c.decodeIfPresent(Bool.self, forKey: .attributionTrusted) ?? false
        batchId = try c.decodeIfPresent(String.self, forKey: .batchId)
        passwordHint = try c.decodeIfPresent(String.self, forKey: .passwordHint)
        errorMessage = try c.decodeIfPresent(String.self, forKey: .errorMessage)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        duplicateBillPreview = try c.decodeIfPresent(DuplicateBillPreviewDTO.self, forKey: .duplicateBillPreview)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        confirmedAt = try c.decodeIfPresent(String.self, forKey: .confirmedAt)
        confirmedBillId = try c.decodeIfPresent(String.self, forKey: .confirmedBillId)
    }

    enum CodingKeys: String, CodingKey {
        case id, status, confidence
        case createdBy = "created_by"
        case cardId = "card_id"
        case holderId = "holder_id"
        case matchedAccountId = "matched_account_id"
        case sourceType = "source_type"
        case sourceConnectionId = "source_connection_id"
        case sourceLabel = "source_label"
        case rawText = "raw_text"
        case fileRef = "file_ref"
        case parsedPayload = "parsed_payload"
        case parseStatus = "parse_status"
        case attributionSource = "attribution_source"
        case attributionTrusted = "attribution_trusted"
        case batchId = "batch_id"
        case passwordHint = "password_hint"
        case errorMessage = "error_message"
        case duplicateBillPreview = "duplicate_bill_preview"
        case createdAt = "created_at"
        case confirmedAt = "confirmed_at"
        case confirmedBillId = "confirmed_bill_id"
    }
}

public struct ImportAndParseBillRequest: Encodable, Sendable {
    public var sourceType: String
    public var rawText: String?
    public var attachmentIds: [String]?
    public var cardId: String?
    public var holderId: String?
    public var pdfPassword: String?
    public var savePasswordToVault: Bool?
    public var passwordLabel: String?
    public var passwordHint: String?
    public var forceSaveNonBill: Bool?
    public var clientRequestId: String?

    public init(
        sourceType: String,
        rawText: String? = nil,
        attachmentIds: [String]? = nil,
        cardId: String? = nil,
        holderId: String? = nil,
        pdfPassword: String? = nil,
        savePasswordToVault: Bool? = nil,
        passwordLabel: String? = nil,
        passwordHint: String? = nil,
        forceSaveNonBill: Bool? = nil,
        clientRequestId: String? = nil
    ) {
        self.sourceType = sourceType
        self.rawText = rawText
        self.attachmentIds = attachmentIds
        self.cardId = cardId
        self.holderId = holderId
        self.pdfPassword = pdfPassword
        self.savePasswordToVault = savePasswordToVault
        self.passwordLabel = passwordLabel
        self.passwordHint = passwordHint
        self.forceSaveNonBill = forceSaveNonBill
        self.clientRequestId = clientRequestId
    }

    enum CodingKeys: String, CodingKey {
        case sourceType = "source_type"
        case rawText = "raw_text"
        case attachmentIds = "attachment_ids"
        case cardId = "card_id"
        case holderId = "holder_id"
        case pdfPassword = "pdf_password"
        case savePasswordToVault = "save_password_to_vault"
        case passwordLabel = "password_label"
        case passwordHint = "password_hint"
        case forceSaveNonBill = "force_save_non_bill"
        case clientRequestId = "client_request_id"
    }
}

public struct ImportAndParseBillResponse: Decodable, Sendable {
    public var outcome: String
    public var drafts: [BillImportDraftDTO]
    public var message: String?
    public var deduplicated: Bool?
}

public struct UnlockDraftRequest: Encodable, Sendable {
    public var password: String
    public var saveToVault: Bool?
    public var vaultLabel: String?
    public var vaultHolderId: String?
    public var vaultBankId: String?
    public var vaultBankKeyword: String?
    public var vaultHint: String?

    public init(
        password: String,
        saveToVault: Bool? = nil,
        vaultLabel: String? = nil,
        vaultHolderId: String? = nil,
        vaultBankId: String? = nil,
        vaultBankKeyword: String? = nil,
        vaultHint: String? = nil
    ) {
        self.password = password
        self.saveToVault = saveToVault
        self.vaultLabel = vaultLabel
        self.vaultHolderId = vaultHolderId
        self.vaultBankId = vaultBankId
        self.vaultBankKeyword = vaultBankKeyword
        self.vaultHint = vaultHint
    }

    enum CodingKeys: String, CodingKey {
        case password
        case saveToVault = "save_to_vault"
        case vaultLabel = "vault_label"
        case vaultHolderId = "vault_holder_id"
        case vaultBankId = "vault_bank_id"
        case vaultBankKeyword = "vault_bank_keyword"
        case vaultHint = "vault_hint"
    }
}

public struct UnlockDraftResponse: Decodable, Sendable {
    public var drafts: [BillImportDraftDTO]
    public var vaultRuleSaved: Bool

    enum CodingKeys: String, CodingKey {
        case drafts
        case vaultRuleSaved = "vault_rule_saved"
    }
}

public struct UploadedAttachmentDTO: Decodable, Sendable {
    public var id: String
    public var fileName: String
    public var fileType: String?
    public var fileSize: Int?
    public var sha256: String?

    enum CodingKeys: String, CodingKey {
        case id, sha256
        case fileName = "file_name"
        case fileType = "file_type"
        case fileSize = "file_size"
    }
}

public struct DuplicateBillConflictDetails: Sendable, Equatable {
    public var existingBillId: String
    public var billMonth: String
    public var existingAmount: Double
    public var existingPaidAmount: Double
    public var existingStatus: String
    public var draftAmount: Double
    public var draftDueDate: String?
    public var currency: String

    public static func parse(from error: Error) -> DuplicateBillConflictDetails? {
        let nsError = error as NSError
        guard nsError.code == 409 || (nsError.userInfo["rpc_code"] as? String) == "CONFLICT" else {
            return nil
        }
        guard let rawDetails = nsError.userInfo["rpc_details"] as? [String: Any],
              (rawDetails["reason"] as? String) == "DUPLICATE_BILL",
              let existing = rawDetails["existing_bill"] as? [String: Any] else {
            return nil
        }
        let draft = rawDetails["draft_bill"] as? [String: Any]
        return DuplicateBillConflictDetails(
            existingBillId: (existing["id"] as? String) ?? "",
            billMonth: (existing["bill_month"] as? String) ?? (draft?["bill_month"] as? String) ?? "",
            existingAmount: (existing["bill_amount"] as? NSNumber)?.doubleValue ?? 0,
            existingPaidAmount: (existing["paid_amount"] as? NSNumber)?.doubleValue ?? 0,
            existingStatus: (existing["status"] as? String) ?? "unpaid",
            draftAmount: (draft?["bill_amount"] as? NSNumber)?.doubleValue ?? 0,
            draftDueDate: draft?["due_date"] as? String,
            currency: (draft?["currency"] as? String) ?? "CNY"
        )
    }
}

public struct StatementPasswordRuleDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var userId: String
    public var label: String
    public var holderId: String?
    public var bankId: String?
    public var bankKeyword: String?
    public var hint: String?
    public var useCount: Int
    public var lastUsedAt: String?
    public var createdAt: String
    public var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, label, hint
        case userId = "user_id"
        case holderId = "holder_id"
        case bankId = "bank_id"
        case bankKeyword = "bank_keyword"
        case useCount = "use_count"
        case lastUsedAt = "last_used_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct GmailConnectionDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var email: String
    public var displayLabel: String?
    public var defaultHolderId: String?
    public var attributionMode: String
    public var syncEnabled: Bool
    public var status: String
    public var lastSyncAt: String?
    public var lastSyncSummary: String?
    public var lastError: String?
    public var createdAt: String

    public init(
        id: String,
        email: String,
        displayLabel: String? = nil,
        defaultHolderId: String? = nil,
        attributionMode: String = "auto_then_default",
        syncEnabled: Bool = true,
        status: String = "active",
        lastSyncAt: String? = nil,
        lastSyncSummary: String? = nil,
        lastError: String? = nil,
        createdAt: String = ""
    ) {
        self.id = id
        self.email = email
        self.displayLabel = displayLabel
        self.defaultHolderId = defaultHolderId
        self.attributionMode = attributionMode
        self.syncEnabled = syncEnabled
        self.status = status
        self.lastSyncAt = lastSyncAt
        self.lastSyncSummary = lastSyncSummary
        self.lastError = lastError
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        displayLabel = try c.decodeIfPresent(String.self, forKey: .displayLabel)
        defaultHolderId = try c.decodeIfPresent(String.self, forKey: .defaultHolderId)
        attributionMode = try c.decodeIfPresent(String.self, forKey: .attributionMode) ?? "auto_then_default"
        if let boolVal = try? c.decode(Bool.self, forKey: .syncEnabled) {
            syncEnabled = boolVal
        } else if let intVal = try? c.decode(Int.self, forKey: .syncEnabled) {
            syncEnabled = intVal != 0
        } else {
            syncEnabled = true
        }
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        lastSyncAt = try c.decodeIfPresent(String.self, forKey: .lastSyncAt)
        lastSyncSummary = try c.decodeIfPresent(String.self, forKey: .lastSyncSummary)
        lastError = try c.decodeIfPresent(String.self, forKey: .lastError)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, email, status
        case displayLabel = "display_label"
        case defaultHolderId = "default_holder_id"
        case attributionMode = "attribution_mode"
        case syncEnabled = "sync_enabled"
        case lastSyncAt = "last_sync_at"
        case lastSyncSummary = "last_sync_summary"
        case lastError = "last_error"
        case createdAt = "created_at"
    }
}

public struct UserImportPreferencesDTO: Codable, Sendable, Equatable {
    public var autoCommitTrustedEmail: Bool

    public init(autoCommitTrustedEmail: Bool = true) {
        self.autoCommitTrustedEmail = autoCommitTrustedEmail
    }

    enum CodingKeys: String, CodingKey {
        case autoCommitTrustedEmail = "auto_commit_trusted_email"
    }
}
