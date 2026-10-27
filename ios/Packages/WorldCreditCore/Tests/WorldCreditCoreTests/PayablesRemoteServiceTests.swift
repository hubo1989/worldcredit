import Foundation
import Testing
@testable import WorldCreditCore

/// 周期应付 RPC 契约：报文、解码与错误降级，模式照 DashboardRemoteServiceTests。
@Suite("Payables remote service RPC contracts")
struct PayablesRemoteServiceTests {
    private let listEnvelope = #"{"data":[{"id":"p1","created_by":"alice","name":"房贷","category":"loan","amount":3500,"currency":"CNY","due_day":1,"holder_id":null,"note":null,"bank_account":"6222...1234","period":"2026-10","due_date":"2026-10-01","days_until_due":-22,"paid_amount":0,"status":"overdue"},{"id":"p2","created_by":"alice","name":"房租","category":"rent","amount":2200,"currency":"CNY","due_day":5,"holder_id":"h1","note":null,"bank_account":null,"period":"2026-10","due_date":"2026-10-05","days_until_due":12,"paid_amount":2200,"status":"paid"}],"error":null}"#
    private let itemEnvelope = #"{"data":{"id":"p1","created_by":"alice","name":"房贷","category":"loan","amount":3500,"currency":"CNY","due_day":1,"holder_id":null,"note":null,"bank_account":null,"period":"2026-10","due_date":"2026-10-01","days_until_due":-22,"paid_amount":3500,"status":"paid"},"error":null}"#

    private func response(_ request: URLRequest, _ json: String, status: Int = 200) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private func client(_ session: any NetworkSession) -> ApiClient {
        ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
    }

    @Test("fetch sends exact RPC arguments and decodes snake_case status fields")
    func fetchContract() async throws {
        let session = MockNetworkSession { [listEnvelope] request in
            #expect(request.url?.path == "/api/rpc/payables/getRecurringPayables")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            #expect(body["args"] as? [String] == ["alice"])
            return response(request, listEnvelope)
        }
        let items = try await PayablesRemoteService(apiClient: client(session)).fetchPayables(userId: "alice")
        #expect(items.count == 2)
        let loan = try #require(items.first(where: { $0.id == "p1" }))
        #expect(loan.category == .loan)
        #expect(loan.category.label == "贷款")
        #expect(loan.dueDay == 1)
        #expect(loan.daysUntilDue == -22)
        #expect(loan.paidAmount == 0)
        #expect(loan.status == .overdue)
        #expect(!loan.isSettled)
        #expect(loan.distanceLabel == "逾期 22 日")
        #expect(loan.bankAccount == "6222...1234")
        let rent = try #require(items.first(where: { $0.id == "p2" }))
        #expect(rent.isSettled)
        #expect(rent.holderId == "h1")
        #expect(rent.distanceLabel == "本期已付")
    }

    @Test("pay sends payable id and amount, returning the settled item")
    func payContract() async throws {
        let session = MockNetworkSession { [itemEnvelope] request in
            #expect(request.url?.path == "/api/rpc/payables/payRecurringPayable")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            #expect(args.count == 2)
            #expect(args[0] as? String == "p1")
            #expect(args[1] as? Double == 3500.0)
            return response(request, itemEnvelope)
        }
        let item = try await PayablesRemoteService(apiClient: client(session)).pay(payableId: "p1", amount: 3500)
        #expect(item.isSettled)
        #expect(item.status == .paid)
    }

    @Test("create sends created_by alongside the draft fields")
    func createContract() async throws {
        let session = MockNetworkSession { [itemEnvelope] request in
            #expect(request.url?.path == "/api/rpc/payables/createRecurringPayable")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let arg = try #require((body["args"] as? [[String: Any]])?.first)
            #expect(arg["created_by"] as? String == "alice")
            #expect(arg["name"] as? String == "房贷")
            #expect(arg["category"] as? String == "loan")
            #expect(arg["due_day"] as? Int == 1)
            return response(request, itemEnvelope)
        }
        let draft = PayableDraft(name: "房贷", category: .loan, amount: 3500, currency: "CNY", dueDay: 1)
        let item = try await PayablesRemoteService(apiClient: client(session)).create(userId: "alice", draft: draft)
        #expect(item.id == "p1")
    }

    @Test("update sends id then draft; delete accepts null data; errors propagate")
    func updateDeleteAndErrors() async throws {
        let session = MockNetworkSession { [itemEnvelope] request in
            switch request.url?.path {
            case "/api/rpc/payables/updateRecurringPayable":
                let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
                let args = try #require(body["args"] as? [Any])
                #expect(args.first as? String == "p1")
                return response(request, itemEnvelope)
            case "/api/rpc/payables/deleteRecurringPayable":
                return response(request, #"{"data":null,"error":null}"#)
            default:
                return response(request, #"{"data":null,"error":{"message":"金额必须是不小于 0 的数字"}}"#, status: 200)
            }
        }
        let service = PayablesRemoteService(apiClient: client(session))
        let draft = PayableDraft(name: "房贷", category: .loan, amount: 3500, currency: "CNY", dueDay: 1)
        let updated = try await service.update(payableId: "p1", draft: draft)
        #expect(updated.id == "p1")
        try await service.delete(payableId: "p1")

        await #expect(throws: Error.self) {
            _ = try await service.fetchPayables(userId: "alice")
        }
    }
}
