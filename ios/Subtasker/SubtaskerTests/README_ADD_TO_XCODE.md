# Adding the SubtaskerTests target to Xcode

No test target exists in `Subtasker.xcodeproj` yet.  Follow these steps once.

## 1. Add the test target

In Xcode: **File → New → Target → Unit Testing Bundle**

- **Product Name**: `SubtaskerTests`
- **Team**: match the main target (5TA877KL94)
- **Bundle Identifier**: `com.subtasker.SubtaskerTests`
- **Target to be Tested**: `Subtasker`

## 2. Replace the generated test file

Delete the generated `SubtaskerTests.swift` stub.  Add all files from this
directory and `TestHelpers/` to the new target.

## 3. Set @testable import access

In **Build Settings** for the `Subtasker` (app) target:

    ENABLE_TESTABILITY = YES   (set for Debug only)

This allows `@testable import Subtasker` to access `internal` members.

## 4. `HandlerTestExtensions.swift` membership

Add `TestHelpers/HandlerTestExtensions.swift` **only** to `SubtaskerTests` —
not to the `Subtasker` app target.  It imports `@testable import Subtasker`
and cannot be compiled into the app target itself.

## 5. Keychain entitlements (physical device only)

When running on a physical device, `KeychainStoreTests` requires the
**Keychain Sharing** capability on the test target.  In the iOS Simulator no
entitlement is needed — Keychain is fully accessible without signing.

## 6. Run tests

    xcodebuild test \
      -project ios/Subtasker/Subtasker.xcodeproj \
      -scheme Subtasker \
      -destination 'platform=iOS Simulator,name=iPhone 16'
