import SwiftUI
import UIKit
import GoogleSignIn
import WorldCreditCore

struct LoginView: View {
    @Environment(AppState.self) private var appState
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var isLoading: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                VStack(spacing: 8) {
                    Image(systemName: "creditcard.circle.fill")
                        .font(.system(size: 72))
                        .foregroundStyle(.tint)

                    Text("WorldCredit")
                        .font(.largeTitle.bold())

                    Text("离线优先 · 信用卡与账单管理")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 16) {
                    TextField("邮箱地址", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    SecureField("密码", text: $password)
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button(action: handleLogin) {
                        HStack {
                            Spacer()
                            if isLoading {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Text("登录")
                                    .bold()
                            }
                            Spacer()
                        }
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isLoading || email.isEmpty || password.isEmpty)

                    HStack {
                        line
                        Text("或")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        line
                    }

                    Button(action: handleGoogleLogin) {
                        HStack(spacing: 8) {
                            Spacer()
                            if isLoading {
                                ProgressView()
                                    .tint(.primary)
                            } else {
                                Image(systemName: "g.circle.fill")
                                    .font(.title3)
                                Text("使用 Google 登录")
                                    .bold()
                            }
                            Spacer()
                        }
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .foregroundStyle(.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(uiColor: .separator), lineWidth: 1)
                        )
                    }
                    .disabled(isLoading)

                    Button("快速体验（演示账单数据）") {
                        Task {
                            await appState.loadDemoData()
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                }
                .padding(.horizontal)

                Spacer()
                Spacer()
            }
            .padding()
            .background(Color(uiColor: .systemGroupedBackground))
        }
    }

    private var line: some View {
        Rectangle()
            .fill(Color(uiColor: .separator))
            .frame(height: 1)
    }

    private func handleLogin() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await appState.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    /// GoogleSignIn 走 ASWebAuthenticationSession，需要一个 presenting view controller。
    private func presentingViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let keyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow)
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    /// 只负责取回 ID token；登录状态迁移与密码登录共用 AppState.loginWithGoogle。
    private func handleGoogleLogin() {
        guard let presenter = presentingViewController() else {
            errorMessage = "无法获取当前窗口，请稍后重试"
            return
        }
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
                guard let idToken = result.user.idToken?.tokenString else {
                    errorMessage = "Google 未返回 ID token，请重试"
                    isLoading = false
                    return
                }
                try await appState.loginWithGoogle(idToken: idToken)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
