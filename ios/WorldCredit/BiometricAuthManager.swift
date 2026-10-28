import Foundation
import LocalAuthentication
import WorldCreditCore

@MainActor
public final class BiometricAuthManager {
    public static let shared = BiometricAuthManager()

    private init() {}

    public enum BiometryKind {
        case none
        case touchID
        case faceID
        case opticID
    }

    public var isAvailable: Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) ||
            context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    public var biometryKind: BiometryKind {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .none
        }
        switch context.biometryType {
        case .faceID:
            return .faceID
        case .touchID:
            return .touchID
        case .opticID:
            return .opticID
        case .none:
            return .none
        @unknown default:
            return .none
        }
    }

    public var biometryName: String {
        switch biometryKind {
        case .faceID:
            return "Face ID"
        case .touchID:
            return "Touch ID"
        case .opticID:
            return "Optic ID"
        case .none:
            return "设备密码"
        }
    }

    public func authenticate(reason: String = "验证身份以解锁 WorldCredit") async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "取消"

        var error: NSError?
        let biometricsAvailable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let initial = DeviceUnlockPolicy.initialMethod(biometricsAvailable: biometricsAvailable)
        if initial == .biometrics {
            let (success, evalError) = await evaluate(.deviceOwnerAuthenticationWithBiometrics, on: context, reason: reason)
            if success { return true }
            guard DeviceUnlockPolicy.method(afterBiometricError: evalError?.code) == .deviceOwner else {
                return false
            }
        } else if DeviceUnlockPolicy.method(afterBiometricError: error?.code) == .biometrics &&
                    error?.code != LAError.biometryNotAvailable.rawValue &&
                    error?.code != LAError.biometryNotEnrolled.rawValue {
            return false
        }

        let fallbackContext = LAContext()
        fallbackContext.localizedCancelTitle = "取消"
        guard fallbackContext.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        let (success, _) = await evaluate(.deviceOwnerAuthentication, on: fallbackContext, reason: reason)
        return success
    }

    private func evaluate(_ policy: LAPolicy, on context: LAContext, reason: String) async -> (Bool, NSError?) {
        await withCheckedContinuation { continuation in
            context.evaluatePolicy(policy, localizedReason: reason) { success, error in
                continuation.resume(returning: (success, error as NSError?))
            }
        }
    }
}
