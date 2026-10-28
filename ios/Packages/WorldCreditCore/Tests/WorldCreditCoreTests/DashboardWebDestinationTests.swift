import Foundation
import Testing
@testable import WorldCreditCore

/// DashboardWebDestination / DashboardWebRoutePolicy 纯路由约束。
/// 这些断言是 WebView 会话 cookie 只落在同站受限 path 上的唯一自动防线。
@Suite("Dashboard web bridge routing")
struct DashboardWebDestinationTests {
    // MARK: - 入口枚举

    @Test("六个入口的 URL 与产品约定的受限枚举完全一致")
    func destinationURLsMatchAllowlist() {
        #expect(DashboardWebDestination.promos.url().absoluteString == "https://app.all-bill.com/promos")
        #expect(DashboardWebDestination.benefits.url().absoluteString == "https://app.all-bill.com/benefits")
        #expect(DashboardWebDestination.benefitCalendar.url().absoluteString == "https://app.all-bill.com/benefits/calendar")
        #expect(DashboardWebDestination.gmailLedger.url().absoluteString == "https://app.all-bill.com/gmail-ledger")
        #expect(DashboardWebDestination.createBill.url().absoluteString == "https://app.all-bill.com/dashboard?native_action=bill")
        #expect(DashboardWebDestination.createCard.url().absoluteString == "https://app.all-bill.com/dashboard?native_action=card")
    }

    @Test("Identifiable 与 .sheet(item:) 契约：id 稳定且互不相同")
    func identifiableContract() {
        let ids = DashboardWebDestination.allCases.map(\.id)
        #expect(ids.count == 6)
        #expect(Set(ids).count == 6)
        for item in DashboardWebDestination.allCases {
            #expect(item.id == item.rawValue)
        }
    }

    @Test("导航栏标题与 Web 金刚区/表单文案一致")
    func titlesMatchWebCopy() {
        #expect(DashboardWebDestination.promos.title == "优惠")
        #expect(DashboardWebDestination.benefits.title == "权益")
        #expect(DashboardWebDestination.benefitCalendar.title == "权益日历")
        #expect(DashboardWebDestination.gmailLedger.title == "邮箱账单")
        #expect(DashboardWebDestination.createBill.title == "录入账单")
        #expect(DashboardWebDestination.createCard.title == "添加卡片")
    }

    @Test("native_action 仅 bill/card 两种桥接值")
    func nativeActionValues() {
        #expect(DashboardWebDestination.createBill.queryItems.map(\.value) == ["bill"])
        #expect(DashboardWebDestination.createCard.queryItems.map(\.value) == ["card"])
        for item in [DashboardWebDestination.promos, .benefits, .benefitCalendar, .gmailLedger] {
            #expect(item.queryItems.isEmpty)
        }
    }

    @Test("入口 URL 不携带任何令牌")
    func entryURLsNeverCarryToken() {
        let token = "eyJzdWIiOiJ1In0.c2ln"
        for item in DashboardWebDestination.allCases {
            let text = item.url().absoluteString
            #expect(!text.contains(token))
            #expect(text.range(of: "token", options: .caseInsensitive) == nil)
        }
    }

    // MARK: - 导航决策：允许

    @Test("六个入口 URL 均允许在受限 WebView 内加载")
    func entryURLsLoadInWebView() {
        for item in DashboardWebDestination.allCases {
            #expect(DashboardWebRoutePolicy.decision(for: item.url()) == .loadInWebView)
        }
    }

    @Test("受限 path 允许大小写不敏感 host、显式 443、尾斜杠与 SPA 查询串")
    func allowlistTolerances() {
        let allowed = [
            "https://app.all-bill.com/promos",
            "https://app.all-bill.com/promos/",
            "https://APP.ALL-BILL.COM/promos",
            "https://app.all-bill.com:443/promos",
            "https://app.all-bill.com/promos?kind=bank&q=x",
            "https://app.all-bill.com/benefits",
            "https://app.all-bill.com/benefits/calendar",
            "https://app.all-bill.com/gmail-ledger",
            "https://app.all-bill.com/dashboard",
            "https://app.all-bill.com/dashboard?native_action=bill",
            "https://app.all-bill.com/dashboard?native_action=card",
        ]
        for text in allowed {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .loadInWebView, Comment(rawValue: text))
        }
    }

    // MARK: - 导航决策：拒绝（不得加载、也不得开系统浏览器）

    @Test("URL 内嵌 credentials 一律拒绝")
    func rejectsEmbeddedCredentials() {
        let texts = [
            "https://user:pass@app.all-bill.com/promos",
            "https://app.all-bill.com@evil.example/promos",
            "https://user@app.all-bill.com/promos",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .reject, Comment(rawValue: text))
        }
    }

    @Test("目标站子域、apex 与形近 host 一律拒绝")
    func rejectsSubdomainAndLookalikeHosts() {
        let texts = [
            "https://evil.app.all-bill.com/promos",
            "https://app.all-bill.com.evil.com/promos",
            "https://all-bill.com/promos",
            "https://www.all-bill.com/promos",
            "https://all-bill.com.example.org/promos",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .reject, Comment(rawValue: text))
        }
    }

    @Test("目标站非法形态拒绝：http、非 443 端口")
    func rejectsInsecureTargetForms() {
        let texts = [
            "http://app.all-bill.com/promos",
            "https://app.all-bill.com:8443/promos",
            "https://app.all-bill.com:80/promos",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .reject, Comment(rawValue: text))
        }
    }

    @Test("目标站非枚举 path 拒绝（含未知顶层与路径穿越）")
    func rejectsUnknownTopLevelPaths() {
        let texts = [
            "https://app.all-bill.com/",
            "https://app.all-bill.com/bills",
            "https://app.all-bill.com/settings",
            "https://app.all-bill.com/benefits/tasks",
            "https://app.all-bill.com/admin",
            "https://app.all-bill.com/promos/../admin",
            "https://app.all-bill.com/api/rpc/bills/getUnpaidBills",
            "https://app.all-bill.com/dashboard?native_action=evil",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .reject, Comment(rawValue: text))
        }
    }

    @Test("非 http(s) scheme 拒绝")
    func rejectsNonHTTPSchemes() {
        let texts = [
            "javascript:alert(1)",
            "data:text/html,hi",
            "file:///etc/passwd",
            "about:blank",
            "com.googleusercontent.apps.752531640450:/oauth2redirect",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            #expect(DashboardWebRoutePolicy.decision(for: url) == .reject, Comment(rawValue: text))
        }
    }

    // MARK: - 导航决策：站外 http(s) → 系统浏览器（不带凭证）

    @Test("站外 http(s) 交给系统浏览器打开")
    func externalizesOffSiteHTTPS() {
        let texts = [
            "https://www.example.com/promos",
            "http://example.com/x",
            "https://pay.cmbchina.com/entry",
            "https://example.com/app.all-bill.com",
        ]
        for text in texts {
            let url = try! #require(URL(string: text))
            guard case .openInSystemBrowser(let external) = DashboardWebRoutePolicy.decision(for: url) else {
                Issue.record("expected openInSystemBrowser for \(text)")
                continue
            }
            #expect(external == url)
        }
    }

    // MARK: - 会话 cookie

    @Test("wc_user 会话 cookie：Secure/HttpOnly/SameSite=Lax、host-only、7 天")
    func sessionCookieAttributes() throws {
        let token = "eyJzdWIiOiJ1In0.c2ln"
        let cookie = try #require(DashboardWebSessionCookie.make(token: token))
        #expect(cookie.name == "wc_user")
        #expect(cookie.value == token)
        #expect(cookie.isSecure)
        #expect(cookie.isHTTPOnly)
        #expect(cookie.sameSitePolicy?.rawValue == "lax")
        #expect(cookie.path == "/")
        #expect(cookie.domain == "app.all-bill.com")
        #expect(cookie.domain.hasPrefix(".") == false)
        if let expires = cookie.expiresDate {
            let expected = Date().addingTimeInterval(7 * 24 * 3600)
            #expect(abs(expires.timeIntervalSince(expected)) < 30)
        } else {
            Issue.record("session cookie should carry a 7-day expiry")
        }
    }

    @Test("空 token 或带分隔符的 token 不会产出 cookie")
    func rejectsUnsafeTokenValues() {
        #expect(DashboardWebSessionCookie.make(token: "") == nil)
        #expect(DashboardWebSessionCookie.make(token: "a; Domain=evil.com") == nil)
        #expect(DashboardWebSessionCookie.make(token: "a b") == nil)
    }
}
