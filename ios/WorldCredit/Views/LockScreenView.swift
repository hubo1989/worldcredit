import SwiftUI

public struct LockScreenView: View {
    @Environment(AppState.self) private var appState
    @State private var showingLogoutConfirm = false

    public init() {}

    public var body: some View {
        ZStack {
            // Obsidian 深黑背景
            Color(red: 0.05, green: 0.06, blue: 0.08)
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // 锁屏品牌与图标
                VStack(spacing: 16) {
                    ZStack {
                        Circle()
                            .fill(Color(red: 0.12, green: 0.14, blue: 0.18))
                            .frame(width: 88, height: 88)

                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(Color(red: 0.85, green: 0.65, blue: 0.25)) // 琥珀金
                    }

                    Text("WorldCredit")
                        .font(.title2.bold())
                        .foregroundStyle(.white)

                    Text("财务数据已受生物识别保护")
                        .font(.footnote)
                        .foregroundStyle(Color(red: 0.55, green: 0.58, blue: 0.65))
                }

                Spacer()

                // 解锁按钮
                VStack(spacing: 16) {
                    Button {
                        Task {
                            await appState.unlockWithBiometrics()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: BiometricAuthManager.shared.biometryKind == .touchID ? "touchid" : "faceid")
                            Text("点击使用 \(BiometricAuthManager.shared.biometryName) 解锁")
                        }
                        .font(.body.weight(.medium))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.16, green: 0.18, blue: 0.24))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(red: 0.25, green: 0.28, blue: 0.35), lineWidth: 1)
                        )
                    }

                    Button("退出当前账号", role: .destructive) {
                        showingLogoutConfirm = true
                    }
                    .font(.footnote)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
            }
        }
        .confirmationDialog("退出当前账号？", isPresented: $showingLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                // 清库失败时抛错：保持锁屏可见，避免带着旧账号数据进入登录页。
                Task { try? await appState.logout() }
            }
            Button("取消", role: .cancel) {}
        }
        .task {
            // 视图出现时自动发起一次认证
            await appState.unlockWithBiometrics()
        }
    }
}
