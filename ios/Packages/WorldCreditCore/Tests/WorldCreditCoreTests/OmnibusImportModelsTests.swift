import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Omnibus Import & Multi-Gmail Contracts")
struct OmnibusImportModelsTests {
    private func makeClient(
        handler: @escaping @Sendable (URLRequest) throws -> (Data, URLResponse)
    ) -> ApiClient {
        ApiClient(
            baseURL: URL(string: "https://test.local")!,
            session: MockNetworkSession(handler: handler),
            token: "session-token",
            useKeychain: false
        )
    }

    @Test("BillImportDraftDTO 解码支持 subtotals、attachment_ids 与 legacy_ledger")
    func decodesFullDraftDTO() throws {
        let json = """
        {
          "id": "draft-1",
          "created_by": "u-1",
          "source_type": "pdf",
          "status": "draft",
          "parse_status": "needs_password",
          "card_id": null,
          "holder_id": "h-1",
          "source_connection_id": "conn-1",
          "source_label": "HSBC Statement",
          "parsed_payload": {
            "bank_name": "HSBC HK",
            "card_last4": "8848",
            "bill_amount": 12450.5,
            "min_payment": 500,
            "currency": "HKD",
            "bill_month": "2026-10",
            "statement_date": "2026-10-15",
            "due_date": "2026-11-05",
            "attachment_ids": ["att-1", "att-2"],
            "card_subtotals": [
              { "card_last4": "8848", "card_name": "Red", "amount": 8000, "currency": "HKD" },
              { "card_last4": "1122", "card_name": "Pulse", "amount": 4450.5, "currency": "HKD" }
            ],
            "legacy_ledger": {
              "entry_id": "le-1",
              "ledger_id": "gl-1",
              "paid_amount": 300,
              "payment_status": "partial",
              "payment_date": "2026-10-20",
              "payment_note": "已还部分"
            }
          },
          "attribution_source": "connection_default",
          "attribution_trusted": false,
          "password_hint": "身份证后6位",
          "error_message": "需要 PDF 密码",
          "confidence": 0.91,
          "created_at": "2026-10-16T08:00:00Z"
        }
        """
        let dto = try JSONDecoder().decode(BillImportDraftDTO.self, from: Data(json.utf8))
        #expect(dto.id == "draft-1")
        #expect(dto.parseStatus == "needs_password")
        #expect(dto.parsedPayload.attachmentIds == ["att-1", "att-2"])
        #expect(dto.parsedPayload.currency == "HKD")
        #expect(dto.parsedPayload.cardSubtotals?.count == 2)
        #expect(dto.parsedPayload.legacyLedger?.paidAmount == 300)
        #expect(dto.passwordHint == "身份证后6位")
        #expect(dto.attributionSource == "connection_default")
    }

    @Test("GmailConnectionDTO 支持整数 sync_enabled 与缺失默认值")
    func decodesGmailConnectionWithSQLiteBool() throws {
        let json = """
        [
          {
            "id": "conn-1",
            "email": "main@gmail.com",
            "display_label": "家庭主邮箱",
            "default_holder_id": "h-1",
            "attribution_mode": "always_default",
            "sync_enabled": 1,
            "status": "active",
            "created_at": "2026-10-01T00:00:00Z"
          },
          {
            "id": "conn-2",
            "email": "spouse@gmail.com",
            "sync_enabled": 0
          }
        ]
        """
        let list = try JSONDecoder().decode([GmailConnectionDTO].self, from: Data(json.utf8))
        #expect(list.count == 2)
        #expect(list[0].syncEnabled == true)
        #expect(list[0].displayLabel == "家庭主邮箱")
        #expect(list[0].attributionMode == "always_default")
        #expect(list[1].syncEnabled == false)
        #expect(list[1].attributionMode == "auto_then_default")
        #expect(list[1].status == "active")
    }

    @Test("confirmBillImportDraft 遇到 409 CONFLICT DUPLICATE_BILL 时保留现有账单详情")
    func surfacesDuplicateBillConflict409() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/rpc/billDrafts/confirmBillImportDraft")
            let body = """
            {
              "error": "检测到同卡同账期已存在账单",
              "code": "CONFLICT",
              "details": {
                "reason": "DUPLICATE_BILL",
                "existing_bill": {
                  "id": "bill-existing-9",
                  "bill_month": "2026-10",
                  "bill_amount": 5200.0,
                  "paid_amount": 0,
                  "status": "unpaid"
                },
                "draft_bill": {
                  "bill_amount": 5400.0,
                  "due_date": "2026-11-10",
                  "currency": "USD"
                }
              }
            }
            """
            let res = HTTPURLResponse(
                url: request.url!,
                statusCode: 409,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (Data(body.utf8), res)
        }
        let client = ApiClient(
            baseURL: URL(string: "https://test.local")!,
            session: session,
            token: "session-token",
            useKeychain: false
        )

        do {
            _ = try await client.confirmBillImportDraft(draftId: "draft-dup")
            Issue.record("Expected 409 conflict error")
        } catch let error as NSError {
            #expect(error.code == 409)
            #expect((error.userInfo["rpc_code"] as? String) == "CONFLICT")
            let conflict = DuplicateBillConflictDetails.parse(from: error)
            #expect(conflict?.existingBillId == "bill-existing-9")
            #expect(conflict?.currency == "USD")
            #expect(conflict?.existingAmount == 5200.0)
            #expect(conflict?.draftAmount == 5400.0)
        }
    }

    @Test("密码本 CRUD 与导入偏好接口发送正确的 RPC 与路径")
    func callsVaultAndImportPreferenceEndpoints() async throws {
        final class Capture: @unchecked Sendable {
            private let lock = NSLock()
            private var paths: [String] = []
            func append(_ p: String) {
                lock.withLock { paths.append(p) }
            }
            func all() -> [String] {
                lock.withLock { paths }
            }
        }
        let capture = Capture()

        let client = makeClient { request in
            let path = request.url?.path ?? ""
            capture.append(path)

            let url = request.url!
            let res = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if path == "/api/rpc/passwordVault/listPasswordRules" {
                let json = """
                {
                  "data": [
                    {
                      "id": "pw-1",
                      "user_id": "u-1",
                      "label": "招商身份证后6位",
                      "hint": "***4321",
                      "use_count": 3,
                      "created_at": "2026-10-01T00:00:00Z",
                      "updated_at": "2026-10-01T00:00:00Z"
                    }
                  ]
                }
                """
                return (Data(json.utf8), res)
            }
            if path == "/api/rpc/preferences/getUserImportPreferences" {
                return (Data(#"{"data":{"auto_commit_trusted_email":false}}"#.utf8), res)
            }
            if path == "/api/rpc/preferences/updateUserImportPreferences" {
                return (Data(#"{"data":{"auto_commit_trusted_email":true}}"#.utf8), res)
            }
            return (Data(#"{"data":{}}"#.utf8), res)
        }

        let rules = try await client.listPasswordRules()
        #expect(rules.count == 1)
        #expect(rules[0].label == "招商身份证后6位")

        let prefs = try await client.fetchImportPreferences()
        #expect(prefs.autoCommitTrustedEmail == false)

        let updated = try await client.updateImportPreferences(autoCommitTrustedEmail: true)
        #expect(updated.autoCommitTrustedEmail == true)

        let recorded = capture.all()
        #expect(recorded.contains("/api/rpc/passwordVault/listPasswordRules"))
        #expect(recorded.contains("/api/rpc/preferences/getUserImportPreferences"))
        #expect(recorded.contains("/api/rpc/preferences/updateUserImportPreferences"))
    }
}
