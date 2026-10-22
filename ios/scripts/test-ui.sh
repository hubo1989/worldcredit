#!/usr/bin/env bash
# Use a disposable simulator by default; never erase an existing device.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifacts="${WC_UI_ARTIFACT_DIR:-}"
if [ -z "$artifacts" ]; then
  artifacts="$(mktemp -d "${TMPDIR:-/tmp}/worldcredit-ui.XXXXXX")"
fi
mkdir -p "$artifacts"
artifacts="$(cd "$artifacts" && pwd)"
derived_data="${WC_UI_DERIVED_DATA_DIR:-$artifacts/DerivedData}"

device_id="${WC_UI_DEVICE_ID:-}"
owns_device=false
cleanup() {
  if [ "$owns_device" = true ] && [ -n "$device_id" ]; then
    if ! xcrun simctl shutdown "$device_id" >/dev/null 2>&1; then
      echo "Could not shut down test simulator: $device_id" >&2
    fi
    if ! xcrun simctl delete "$device_id" >/dev/null 2>&1; then
      echo "Could not delete test simulator: $device_id" >&2
    fi
  fi
}
trap cleanup EXIT

cd "$repo_root"
command -v xcodegen >/dev/null
if [ ! -f ios/Packages/GRDB/Package.swift ]; then
  echo 'Missing ios/Packages/GRDB; see docs/runbooks/ios-native-setup.md' >&2
  exit 1
fi
if [ -e "$artifacts/results.xcresult" ]; then
  echo "Refusing to overwrite an existing result bundle: $artifacts/results.xcresult" >&2
  exit 1
fi

xcodegen generate --spec ios/project.yml
if [ -z "$device_id" ]; then
  device_id="$(xcrun simctl create 'WorldCredit UI Verification' \
    com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
    "${WC_UI_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-0}")"
  owns_device=true
fi
printf '%s\n' "$device_id" > "$artifacts/device-id.txt"
echo "Simulator: $device_id"
echo "Artifacts: $artifacts"
xcrun simctl bootstatus "$device_id" -b

xcodebuild test -project ios/WorldCredit.xcodeproj -scheme WorldCredit \
  -destination "platform=iOS Simulator,id=$device_id" \
  -parallel-testing-enabled NO \
  -collect-test-diagnostics never \
  -test-timeouts-enabled YES -maximum-test-execution-time-allowance 120 \
  -derivedDataPath "$derived_data" \
  -resultBundlePath "$artifacts/results.xcresult" \
  "SYMROOT=$derived_data/Build/Products" \
  "OBJROOT=$derived_data/Build/Intermediates.noindex" \
  CODE_SIGN_IDENTITY=- \
  > "$artifacts/xcodebuild.log" 2>&1 || {
    tail -80 "$artifacts/xcodebuild.log" >&2
    exit 1
  }
tail -15 "$artifacts/xcodebuild.log"
