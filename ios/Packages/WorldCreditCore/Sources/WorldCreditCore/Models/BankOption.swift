import Foundation

/// 公开银行目录项（/api/rpc/banks/getBankNames）。
public struct BankOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}
