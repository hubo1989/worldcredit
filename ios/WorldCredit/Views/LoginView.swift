import SwiftUI
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
                }
                .padding(.horizontal)

                Spacer()
                Spacer()
            }
            .padding()
            .background(Color(uiColor: .systemGroupedBackground))
        }
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
}
