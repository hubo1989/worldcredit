import Foundation

public enum DeviceUnlockPolicy: Sendable {
    public enum Method: Equatable, Sendable {
        case biometrics
        case deviceOwner
    }

    /// LAError.Code.biometryLockout raw value on Apple platforms.
    public static let biometryLockout = -8

    public static func initialMethod(biometricsAvailable: Bool) -> Method {
        biometricsAvailable ? .biometrics : .deviceOwner
    }

    public static func method(afterBiometricError errorCode: Int?) -> Method {
        errorCode == biometryLockout ? .deviceOwner : .biometrics
    }
}
