import SwiftUI
import WorldCreditCore

struct RegisterView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    @State private var name: String = ""
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var confirmPassword: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var validationError: String? {
        if trimmedEmail.isEmpty {
            return "请输入邮箱地址"
        }
        if !trimmedEmail.contains("@") || !trimmedEmail.contains(".") {
            return "请输入有效的邮箱地址"
        }
        if password.count < 6 {
            return "密码长度至少需要 6 位"
        }
        if password != confirmPassword {
            return "两次输入的密码不一致"
        }
        return nil
    }

    private var canSubmit: Bool {
        !isSubmitting
            && !trimmedEmail.isEmpty
            && !password.isEmpty
            && !confirmPassword.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("创建 WorldCredit 账号")
                            .font(.headline)
                        Text("注册后将自动登录并同步您的账单与卡片数据")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section("账号信息") {
                    TextField("姓名 / 昵称（选填）", text: $name)
                        .textContentType(.name)
                        .accessibilityIdentifier("register.name")

                    TextField("邮箱地址", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("register.email")

                    SecureField("设置密码（至少 6 位）", text: $password)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("register.password")

                    SecureField("确认密码", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("register.confirmPassword")
                }

                if !password.isEmpty && password.count < 6 {
                    Section {
                        Label("密码长度不能少于 6 位", systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(WCColors.warningInk)
                    }
                } else if !confirmPassword.isEmpty && password != confirmPassword {
                    Section {
                        Label("两次输入的密码不一致", systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                            .accessibilityIdentifier("register.error")
                    }
                }

                Section {
                    Button(action: handleRegister) {
                        HStack {
                            Spacer()
                            if isSubmitting {
                                ProgressView()
                            } else {
                                Text("立即注册并登录")
                                    .bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(!canSubmit)
                    .accessibilityIdentifier("register.submit")
                }
            }
            .navigationTitle("注册账号")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("register.cancel")
                }
            }
        }
    }

    private func handleRegister() {
        if let localError = validationError {
            errorMessage = localError
            HapticManager.warning()
            return
        }

        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await appState.register(
                    email: trimmedEmail,
                    password: password,
                    name: trimmedName
                )
                HapticManager.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                HapticManager.error()
                isSubmitting = false
            }
        }
    }
}
