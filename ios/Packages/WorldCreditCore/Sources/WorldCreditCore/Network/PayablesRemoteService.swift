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
        let payload = PayableCreatePayload(createdBy: userId, draft: draft)
        return try await apiClient.rpc(
            module: "payables", function: "createRecurringPayable",
            args: [try jsonValue(payload)])
    }

    @discardableResult
    public func update(payableId: String, draft: PayableDraft) async throws -> PayableItem {
        try await apiClient.rpc(
            module: "payables", function: "updateRecurringPayable",
            args: [AnyCodable(payableId), try jsonValue(draft)])
    }

    public func delete(payableId: String) async throws {
        let _: EmptyAck = try await apiClient.rpc(
            module: "payables", function: "deleteRecurringPayable",
            args: [AnyCodable(payableId)])
    }

    /// AnyCodable 只接受 JSON 原生类型；自定义 Encodable 先序列化再还原成字典。
    private func jsonValue<T: Encodable>(_ value: T) throws -> AnyCodable {
        let data = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return AnyCodable(object)
    }
}

/// create 入参：created_by 由客户端带上、服务端按会话覆盖(与 createHolder 同约定)。
private struct PayableCreatePayload: Codable {
    let createdBy: String
    let name: String
    let category: PayableCategory
    let amount: Double
    let currency: String
    let dueDay: Int
    let holderId: String?
    let note: String?
    let bankAccount: String?

    enum CodingKeys: String, CodingKey {
        case createdBy = "created_by"
        case name, category, amount, currency
        case dueDay = "due_day"
        case holderId = "holder_id"
        case note
        case bankAccount = "bank_account"
    }

    init(createdBy: String, draft: PayableDraft) {
        self.createdBy = createdBy
        self.name = draft.name
        self.category = draft.category
        self.amount = draft.amount
        self.currency = draft.currency
        self.dueDay = draft.dueDay
        self.holderId = draft.holderId
        self.note = draft.note
        self.bankAccount = draft.bankAccount
    }
}

/// deleteRecurringPayable 返回 void，RPC envelope 的 data 为 null。
private struct EmptyAck: Decodable {}
