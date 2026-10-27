import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Device unlock fallback")
struct DeviceUnlockPolicyTests {
    @Test("Available biometrics remain the preferred authentication method")
    func prefersBiometrics() {
        #expect(DeviceUnlockPolicy.initialMethod(biometricsAvailable: true) == .biometrics)
        #expect(DeviceUnlockPolicy.initialMethod(biometricsAvailable: false) == .deviceOwner)
    }

    @Test("Locked biometrics fall back to device owner authentication")
    func lockedBiometricsAllowDeviceOwner() {
        #expect(DeviceUnlockPolicy.method(afterBiometricError: DeviceUnlockPolicy.biometryLockout) == .deviceOwner)
    }

    @Test("Cancellation and a failed match do not silently change policy", arguments: [-2, -1, -999])
    func otherBiometricFailuresKeepBiometrics(_ errorCode: Int) {
        #expect(DeviceUnlockPolicy.method(afterBiometricError: errorCode) == .biometrics)
    }
}
