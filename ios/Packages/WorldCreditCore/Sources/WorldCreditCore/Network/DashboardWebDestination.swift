import Foundation

// MARK: - 入口枚举（DashboardView 用 `.sheet(item:)` 呈现）

/// 原生首页 → 尚未原生实现的 Web 业务入口。
///
/// 六个 case 与产品约定的受限 path 一一对应；`createBill` / `createCard` 通过
/// `?native_action=` 打开 Web `QuickActionSheet` 的录入账单 / 添加卡片子动作。
/// 纯值类型，不依赖 WebKit / SwiftUI，便于路由约束单测。
public enum DashboardWebDestination: String, CaseIterable, Identifiable, Sendable {
    case promos
    case benefits
    case benefitCalendar
    case gmailLedger
    case createBill
    case createCard

    public var id: String { rawValue }

    /// 导航栏标题（与 Web 页面/表单文案一致，供 DashboardWebView 的 NavigationStack 使用）。
    public var title: String {
        switch self {
        case .promos: return "优惠"
        case .benefits: return "权益"
        case .benefitCalendar: return "权益日历"
        case .gmailLedger: return "邮箱账单"
        case .createBill: return "录入账单"
        case .createCard: return "添加卡片"
        }
    }

    /// 受限 path（不含 query）。
    public var path: String {
        switch self {
        case .promos: return "/promos"
        case .benefits: return "/benefits"
        case .benefitCalendar: return "/benefits/calendar"
        case .gmailLedger: return "/gmail-ledger"
        case .createBill, .createCard: return "/dashboard"
        }
    }

    /// Web 快捷动作参数。仅 `createBill`/`createCard` 产生 `native_action=bill|card`。
    public var queryItems: [URLQueryItem] {
        switch self {
        case .createBill: return [URLQueryItem(name: "native_action", value: "bill")]
        case .createCard: return [URLQueryItem(name: "native_action", value: "card")]
        case .promos, .benefits, .benefitCalendar, .gmailLedger: return []
        }
    }

    /// 生产 host 固定为 app.all-bill.com；cookie 与 URL 均不接受入参拼 host。
    public static let webHost = "app.all-bill.com"

    /// 入口 URL。只由枚举常量拼装，永不携带 token。
    public func url(host: String = DashboardWebDestination.webHost) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
            preconditionFailure("unreachable: static destination \(rawValue) must build a URL")
        }
        return url
    }
}

// MARK: - 导航决策

/// WKWebView 顶层/子导航决策。会话 cookie 只随 `.loadInWebView` 的请求发出。
public enum DashboardWebNavigationDecision: Equatable, Sendable {
    /// 允许在带会话 cookie 的受限 WebView 内加载。
    case loadInWebView
    /// 站外 http(s)：交给系统浏览器打开，不携带任何本应用凭证。
    case openInSystemBrowser(URL)
    /// 拒绝：内嵌 credentials、非 http(s) scheme、形近/子域 host、目标站非法形态、未知顶层 path。
    case reject
}

/// 纯路由约束：决定一个 URL 以何种方式打开。无副作用，可自动测试。
public enum DashboardWebRoutePolicy: Sendable {
    /// 会话 WebView 只认这一个 host。
    public static let allowedHost = DashboardWebDestination.webHost

    /// 受限顶层 path 枚举，与 `DashboardWebDestination` 保持一一对应。
    public static var allowedPaths: Set<String> {
        Set(DashboardWebDestination.allCases.map(\.path))
    }

    /// 允许进入受限 WebView 的 native_action 值（Web QuickActionSheet 桥）。
    public static let allowedNativeActions: Set<String> = ["bill", "card"]

    public static func decision(for url: URL) -> DashboardWebNavigationDecision {
        // 1) URL 内嵌 credentials（user[:pass]@host）一律拒绝，防 host 混淆与凭据泄漏。
        if url.user != nil || url.password != nil {
            return .reject
        }

        // 2) 仅 http(s)；其余 scheme（javascript:/data:/file:/自定义 OAuth scheme）拒绝。
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            return .reject
        }
        guard let host = url.host?.lowercased(), !host.isEmpty else {
            return .reject
        }

        // 3) 目标站：精确 host + https + 443 + 受限 path。
        if host == allowedHost {
            guard scheme == "https" else { return .reject }
            if let port = url.port, port != 443 { return .reject }
            guard let path = normalizedPath(of: url), allowedPaths.contains(path) else {
                return .reject
            }
            // /dashboard 仅接受 native_action=bill|card（缺省亦可，供 SPA 清理 query 后重载）。
            if path == "/dashboard", let action = queryValue("native_action", in: url),
               !allowedNativeActions.contains(action) {
                return .reject
            }
            return .loadInWebView
        }

        // 4) 形近 host / 子域 / apex：含 all-bill.com 字样但不是精确 host → 拒绝，不开系统浏览器。
        if host.contains("all-bill.com") {
            return .reject
        }

        // 5) 其余站外 http(s)：系统浏览器打开（不带凭证）。
        return .openInSystemBrowser(url)
    }

    /// 归一化 path：percent 解码后折叠 `.`/`..`，去掉尾斜杠。穿越后逃出枚举即拒绝。
    static func normalizedPath(of url: URL) -> String? {
        let raw = url.path(percentEncoded: false)
        var segments: [String] = []
        for part in raw.split(separator: "/", omittingEmptySubsequences: true) {
            let segment = String(part)
            switch segment {
            case ".":
                continue
            case "..":
                if segments.isEmpty { return nil }
                segments.removeLast()
            default:
                segments.append(segment)
            }
        }
        return "/" + segments.joined(separator: "/")
    }

    static func queryValue(_ name: String, in url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == name })?
            .value
    }
}

// MARK: - 会话 cookie

/// `wc_user` 会话 cookie 构造。token 只进 cookie，不进 URL / JS / localStorage。
public enum DashboardWebSessionCookie: Sendable {
    /// 与 `lib/session.ts` 的 SESSION_COOKIE 同名。
    public static let name = "wc_user"

    /// 会话有效期：与服务端 `MAX_AGE_SECONDS`（7 天）一致。
    public static let maxAgeSeconds: TimeInterval = 7 * 24 * 3600

    /// 构造 host-only 会话 cookie：Secure、HttpOnly、SameSite=Lax、Path=/。
    /// 域固定 `app.all-bill.com`（不设 Domain 属性，避免子域共享）。
    public static func make(token: String) -> HTTPCookie? {
        guard isSafeCookieValue(token) else { return nil }
        guard let origin = URL(string: "https://\(DashboardWebDestination.webHost)") else {
            return nil
        }
        let header = "\(name)=\(token); Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=\(Int(maxAgeSeconds))"
        return HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: origin).first
    }

    /// RFC 6265 cookie-octet 白名单，拒绝分隔符/空白/控制字符，防 Set-Cookie 注入。
    static func isSafeCookieValue(_ value: String) -> Bool {
        guard !value.isEmpty else { return false }
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x21, 0x23...0x2B, 0x2D...0x3A, 0x3C...0x5B, 0x5D...0x7E:
                continue
            default:
                return false
            }
        }
        return true
    }
}
