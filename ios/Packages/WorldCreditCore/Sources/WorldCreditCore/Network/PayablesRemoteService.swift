import Foundation

/// 周期应付的远程服务：走与 Web 相同的 RPC 白名单(`/api/rpc/payables/*`)，
/// 在线读写；失败向上抛，由调用方降级(账单页本地数据不受影响)。
public actor PayablesRemoteService {
    private let apiClient: ApiClient

    public init(apiClient: ApiClient) {
        self.apiClient = apiClient
    }

    /// 当期应付列表(服务端按 due_day 升序返回，含当期状态)。
    public func fetchPayables(userId: String) async throws -> [PayableItem] {
        try await apiClient.rpc(
            module: "payables", function: "getRecurringPayables",
            args: [AnyCodable(userId)])
    }

    /// 登记当期还款；账期由服务端决定，客户端只传金额。
    @discardableResult
    public func pay(payableId: String, amount: Double, note: String? = nil) async throws -> PayableItem {
        var args: [AnyCodable] = [AnyCodable(payableId), AnyCodable(amount)]
        if let note { args.append(AnyCodable(note)) }
        return try await apiClient.rpc(module: "payables", function: "payRecurringPayable", args: args)
    }

    @discardableResult
    public func create(userId: String, draft: PayableDraft) async throws -> PayableItem {
        guard let currency = PayableCurrency.normalize(draft.currency) else {
            throw PayableCurrencyError.unsupported
        }
        var normalizedDraft = draft
        normalizedDraft.currency = currency.rawValue
        let payload = PayableCreatePayload(createdBy: userId, draft: normalizedDraft)
        return try await apiClient.rpc(
            module: "payables", function: "createRecurringPayable",
            args: [try jsonValue(payload)])
    }

    @discardableResult
    public func update(
        payableId: String,
        draft: PayableDraft,
        originalCurrency: String? = nil
    ) async throws -> PayableItem {
        let payload: AnyCodable
        if let currency = PayableCurrency.normalize(draft.currency) {
            var normalizedDraft = draft
            normalizedDraft.currency = currency.rawValue
            payload = try jsonValue(normalizedDraft)
        } else if let originalCurrency, draft.currency == originalCurrency {
            // 只改其他字段时省略历史未知币种，保留服务端原值及其金额单位。
            let data = try JSONEncoder().encode(draft)
            var fields = try JSONDecoder().decode([String: AnyCodable].self, from: data)
            fields.removeValue(forKey: "currency")
            payload = try jsonValue(fields)
        } else {
            throw PayableCurrencyError.unsupported
        }
        return try await apiClient.rpc(
            module: "payables", function: "updateRecurringPayable",
            args: [AnyCodable(payableId), payload])
    }

    /// 某笔固定支出的历史还款（按账期倒序）。
    public func fetchPayments(payableId: String) async throws -> [PayablePaymentRecord] {
        try await apiClient.rpc(
            module: "payables", function: "getPayablePayments",
            args: [AnyCodable(payableId)])
    }

    public func delete(payableId: String) async throws {
        try await apiClient.rpcVoid(
            module: "payables", function: "deleteRecurringPayable",
            args: [AnyCodable(payableId)])
    }

    public func fetchCustomCategories() async throws -> [String] {
        try await apiClient.rpc(
            module: "payables", function: "getPayableCustomCategories",
            args: [AnyCodable("")])
    }

    @discardableResult
    public func saveCustomCategory(name: String) async throws -> [String] {
        try await apiClient.rpc(
            module: "payables", function: "savePayableCustomCategory",
            args: [AnyCodable(""), AnyCodable(name)])
    }

    /// AnyCodable 只接受 JSON 原生类型；自定义 Encodable 先序列化再还原成字典。
    private func jsonValue<T: Encodable>(_ value: T) throws -> AnyCodable {
        let data = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return AnyCodable(object)
    }
}

private enum PayableCurrencyError: LocalizedError {
    case unsupported

    var errorDescription: String? { "币种必须是 CNY / USD / HKD 之一" }
}

/// create 入参：created_by 由客户端带上、服务端按会话覆盖(与 createHolder 同约定)。
private struct PayableCreatePayload: Codable {
    let createdBy: String
    let name: String
    let category: PayableCategory
    let customCategory: String?
    let amount: Double
    let currency: String
    let dueDay: Int
    let cycleType: PayableCycleType?
    let cycleMonths: Int?
    let dueMonth: Int?
    let anchorPeriod: String?
    let holderId: String?
    let bankName: String?
    let note: String?
    let bankAccount: String?

    enum CodingKeys: String, CodingKey {
        case createdBy = "created_by"
        case name, category, amount, currency
        case customCategory = "custom_category"
        case dueDay = "due_day"
        case cycleType = "cycle_type"
        case cycleMonths = "cycle_months"
        case dueMonth = "due_month"
        case anchorPeriod = "anchor_period"
        case holderId = "holder_id"
        case bankName = "bank_name"
        case note
        case bankAccount = "bank_account"
    }

    init(createdBy: String, draft: PayableDraft) {
        self.createdBy = createdBy
        self.name = draft.name
        self.category = draft.category
        self.customCategory = draft.customCategory
        self.amount = draft.amount
        self.currency = draft.currency
        self.dueDay = draft.dueDay
        self.cycleType = draft.cycleType
        self.cycleMonths = draft.cycleMonths
        self.dueMonth = draft.dueMonth
        self.anchorPeriod = draft.anchorPeriod
        self.holderId = draft.holderId
        self.bankName = draft.bankName
        self.note = draft.note
        self.bankAccount = draft.bankAccount
    }
}
