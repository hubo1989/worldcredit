import SwiftUI
import WebKit
import WorldCreditCore

/// 尚未原生实现的业务（录入账单 / 添加卡片 / 优惠 / 权益 / 邮箱账单）的同站受限 WebView 桥。
///
/// 安全边界（与 `DashboardWebRoutePolicy` / `DashboardWebSessionCookie` 一并构成防线）：
/// - 会话只以 `wc_user` cookie 注入**非持久化** `WKWebsiteDataStore`；token 不进 URL、JS、localStorage。
/// - 顶层导航只允许受限 path 枚举；站外 http(s) 用系统浏览器打开且不带凭证；
///   非 http(s) scheme、形近/子域 host、内嵌 credentials 一律拒绝。
/// - 关闭或视图消失时删除私有 cookie。
struct DashboardWebView: View {
    let destination: DashboardWebDestination
    let sessionToken: String
    let onClose: () -> Void

    /// 每个呈现周期只建一次私有存储会话（@State 保留首次实例）。
    @State private var session = DashboardWebSession()
    @State private var loadState: LoadState = .loading
    @State private var retryID = 0
    @State private var didClose = false

    enum LoadState: Equatable {
        case loading
        case ready
        case failed
    }

    var body: some View {
        NavigationStack {
            DashboardWebPage(
                destination: destination,
                sessionToken: sessionToken,
                session: session,
                loadState: $loadState,
                retryID: retryID
            )
            .navigationTitle(destination.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { close() }
                        .accessibilityIdentifier("webview.close")
                }
            }
            .overlay { stateOverlay }
        }
        // 下滑关闭等非按钮路径也走清理 + 恰好一次 onClose（供主 agent 刷新）。
        .onDisappear { close() }
    }

    @ViewBuilder
    private var stateOverlay: some View {
        switch loadState {
        case .ready:
            EmptyView()
        case .loading:
            ZStack {
                Color(.systemBackground).opacity(0.35)
                ProgressView("加载中…")
            }
            .accessibilityIdentifier("webview.loading")
        case .failed:
            VStack(spacing: 12) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(.secondary)
                Text("页面加载失败")
                    .font(.headline)
                Text(destination.title + "暂时无法打开，请检查网络后重试")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("重试") {
                    loadState = .loading
                    retryID += 1
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("webview.retry")
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground).opacity(0.9))
            .accessibilityIdentifier("webview.error")
        }
    }

    private func close() {
        guard !didClose else { return }
        didClose = true
        Task { await session.clearSessionCookie() }
        onClose()
    }
}

// MARK: - 私有存储会话

/// 一次呈现专用的非持久化 Web 会话。退出即丢弃，不与 App 内 URLSession 共享任何存储。
@MainActor
final class DashboardWebSession {
    let dataStore = WKWebsiteDataStore.nonPersistent()

    /// 把会话 token 写成 host-only `wc_user` cookie。成功后才允许加载。
    func installSessionCookie(token: String) async -> Bool {
        guard let cookie = DashboardWebSessionCookie.make(token: token) else { return false }
        let store = dataStore.httpCookieStore
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            store.setCookie(cookie) { cont.resume() }
        }
        return true
    }

    /// 删除私有 cookie。调用幂等，可从关闭按钮与 dismantle 两路触发。
    func clearSessionCookie() async {
        let store = dataStore.httpCookieStore
        let cookies = await withCheckedContinuation { (cont: CheckedContinuation<[HTTPCookie], Never>) in
            store.getAllCookies { cont.resume(returning: $0) }
        }
        let mine = cookies.filter { $0.name == DashboardWebSessionCookie.name }
        guard !mine.isEmpty else { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let group = DispatchGroup()
            for cookie in mine {
                group.enter()
                store.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main) { cont.resume() }
        }
    }
}

// MARK: - WKWebView 容器

struct DashboardWebPage: UIViewRepresentable {
    let destination: DashboardWebDestination
    let sessionToken: String
    let session: DashboardWebSession
    @Binding var loadState: DashboardWebView.LoadState
    let retryID: Int

    func makeCoordinator() -> Coordinator {
        Coordinator(destination: destination, sessionToken: sessionToken, session: session)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = session.dataStore
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.attach(webView, loadState: $loadState)
        context.coordinator.loadEntry()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.loadState = $loadState
        if context.coordinator.retryID != retryID {
            context.coordinator.retryID = retryID
            context.coordinator.loadEntry()
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // 视图拆除（含下滑关闭）时清理私有 cookie。
        let session = coordinator.session
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        Task { await session.clearSessionCookie() }
    }

    @MainActor
    final class Coordinator: NSObject {
        let destination: DashboardWebDestination
        let sessionToken: String
        let session: DashboardWebSession
        var loadState: Binding<DashboardWebView.LoadState>?
        var retryID = 0
        private weak var webView: WKWebView?
        private var isInstalling = false

        init(destination: DashboardWebDestination, sessionToken: String, session: DashboardWebSession) {
            self.destination = destination
            self.sessionToken = sessionToken
            self.session = session
        }

        func attach(_ webView: WKWebView, loadState: Binding<DashboardWebView.LoadState>) {
            self.webView = webView
            self.loadState = loadState
        }

        /// 装载入口 URL。先写 cookie（token 只进 cookie），失败即报错，绝不把 token 拼进 URL。
        func loadEntry() {
            guard webView != nil, !isInstalling else { return }
            isInstalling = true
            loadState?.wrappedValue = .loading
            Task { @MainActor in
                let ok = await session.installSessionCookie(token: sessionToken)
                guard let webView = self.webView else { return }
                self.isInstalling = false
                guard ok else {
                    self.loadState?.wrappedValue = .failed
                    return
                }
                webView.load(URLRequest(url: self.destination.url()))
            }
        }

        private func openExternally(_ url: URL) {
            // 站外打开不带任何凭证：只交出 URL 本身。
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - 导航策略

extension DashboardWebPage.Coordinator: WKNavigationDelegate, WKUIDelegate {
    /// 每次导航（含重定向、target=_blank）都重新裁决；未知顶层永不允许带 cookie 进入。
    /// 用 async 变体：现代 SDK 的可选要求是 `webView(_:decidePolicyFor:) async`，
    /// 完成回调写法不会命中该要求，策略会静默失效。
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        switch DashboardWebRoutePolicy.decision(for: url) {
        case .loadInWebView:
            return .allow
        case .openInSystemBrowser:
            // 仅顶层交给系统浏览器；子窗体的站外请求直接取消，避免隐形 iframe 拉起浏览器。
            if isMainFrame { openExternally(url) }
            return .cancel
        case .reject:
            return .cancel
        }
    }

    /// 响应阶段对主文档再验一次最终 URL，兜住重定向链的落点。
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
        if navigationResponse.isForMainFrame,
           let url = navigationResponse.response.url,
           DashboardWebRoutePolicy.decision(for: url) != .loadInWebView {
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loadState?.wrappedValue = .loading
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadState?.wrappedValue = .ready
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    /// target=_blank / window.open：不另起 WebView（避免复制出会话存储），按同一策略分流。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        switch DashboardWebRoutePolicy.decision(for: url) {
        case .loadInWebView:
            webView.load(URLRequest(url: url))
        case .openInSystemBrowser:
            openExternally(url)
        case .reject:
            break
        }
        return nil
    }

    private func handleLoadFailure(_ error: Error) {
        let nsError = error as NSError
        // 用户主动取消（跳系统浏览器/新窗体）不算加载失败。
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return
        }
        loadState?.wrappedValue = .failed
    }
}
