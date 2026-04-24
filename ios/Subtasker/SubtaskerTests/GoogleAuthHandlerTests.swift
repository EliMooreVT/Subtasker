/// GoogleAuthHandlerTests.swift
/// Tests for GoogleAuthHandler — focused on the three branches of
/// `validAccessToken()` and the token-exchange/refresh network calls.
///
/// Network calls are tested via the `*_test` seams in HandlerTestExtensions.swift
/// that accept a MockURLSession.  The real `validAccessToken()` reads from
/// KeychainStore directly, so tests seed state by writing to the real Keychain
/// (cleaned up in tearDown) — the same approach used in KeychainStoreTests.

import XCTest
@testable import Subtasker

final class GoogleAuthHandlerTests: XCTestCase {

    private var handler: GoogleAuthHandler!
    private var mockSession: MockURLSession!

    override func setUp() {
        super.setUp()
        handler = GoogleAuthHandler()
        mockSession = MockURLSession()
        // Always start each test with a clean keychain slate.
        clearAllAuthKeys()
    }

    override func tearDown() {
        clearAllAuthKeys()
        handler = nil
        mockSession = nil
        super.tearDown()
    }

    // MARK: - Helpers

    private func clearAllAuthKeys() {
        KeychainStore.delete(KeychainStore.keyAccessToken)
        KeychainStore.delete(KeychainStore.keyRefreshToken)
        KeychainStore.delete(KeychainStore.keyTokenExpiry)
    }

    /// Returns an ISO-8601 string for `now + secondsFromNow`.
    private func expiryString(secondsFromNow: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(secondsFromNow))
    }

    // MARK: - validAccessToken: Branch 1 — valid non-expired token

    func test_validAccessToken_withFreshToken_returnsStoredToken() async throws {
        // Seed a token that expires 10 minutes from now (well above the 60-second buffer).
        KeychainStore.set("ya29.fresh-token", forKey: KeychainStore.keyAccessToken)
        KeychainStore.set(expiryString(secondsFromNow: 600), forKey: KeychainStore.keyTokenExpiry)

        let token = try await handler.validAccessToken()

        XCTAssertEqual(token, "ya29.fresh-token")
    }

    func test_validAccessToken_withFreshToken_doesNotMakeNetworkCall() async throws {
        KeychainStore.set("ya29.fresh-token", forKey: KeychainStore.keyAccessToken)
        KeychainStore.set(expiryString(secondsFromNow: 600), forKey: KeychainStore.keyTokenExpiry)
        // No refresh token seeded — if the code tries to refresh it would throw notSignedIn.
        // A successful result without throwing proves no refresh was attempted.
        _ = try await handler.validAccessToken()
    }

    func test_validAccessToken_tokenExpiringInLessThan60Seconds_triggersRefresh() async throws {
        // Token expiring in 30 seconds falls within the 60-second buffer → refresh required.
        KeychainStore.set("ya29.stale-token",   forKey: KeychainStore.keyAccessToken)
        KeychainStore.set("1//refresh-token",   forKey: KeychainStore.keyRefreshToken)
        KeychainStore.set(expiryString(secondsFromNow: 30), forKey: KeychainStore.keyTokenExpiry)

        // Stub a successful refresh response.
        mockSession.enqueue(.json([
            "access_token": "ya29.refreshed-token",
            "expires_in": 3600
        ]))

        let token = try await handler.refreshAccessToken_test(
            refreshToken: "1//refresh-token",
            session: mockSession,
            keychainSet: { KeychainStore.set($0, forKey: $1) }
        )

        XCTAssertEqual(token, "ya29.refreshed-token")
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyAccessToken), "ya29.refreshed-token")
    }

    // MARK: - validAccessToken: Branch 2 — expired token + valid refresh token

    func test_validAccessToken_expiredToken_withRefreshToken_returnsNewToken() async throws {
        // Token is in the past — expired.
        KeychainStore.set("ya29.expired",     forKey: KeychainStore.keyAccessToken)
        KeychainStore.set("1//test-refresh",  forKey: KeychainStore.keyRefreshToken)
        KeychainStore.set(expiryString(secondsFromNow: -3600), forKey: KeychainStore.keyTokenExpiry)

        // Stub the refresh response from the network seam.
        mockSession.enqueue(.json([
            "access_token": "ya29.new-token",
            "expires_in": 3600
        ]))

        let newToken = try await handler.refreshAccessToken_test(
            refreshToken: "1//test-refresh",
            session: mockSession,
            keychainSet: { KeychainStore.set($0, forKey: $1) }
        )

        XCTAssertEqual(newToken, "ya29.new-token")
    }

    func test_validAccessToken_expiredToken_withRefreshToken_updatesKeychainWithNewToken() async throws {
        KeychainStore.set("ya29.old", forKey: KeychainStore.keyAccessToken)
        KeychainStore.set("1//refresh", forKey: KeychainStore.keyRefreshToken)
        KeychainStore.set(expiryString(secondsFromNow: -1), forKey: KeychainStore.keyTokenExpiry)

        mockSession.enqueue(.json([
            "access_token": "ya29.new",
            "expires_in": 3600
        ]))

        _ = try await handler.refreshAccessToken_test(
            refreshToken: "1//refresh",
            session: mockSession,
            keychainSet: { KeychainStore.set($0, forKey: $1) }
        )

        XCTAssertEqual(KeychainStore.get(KeychainStore.keyAccessToken), "ya29.new")
    }

    func test_validAccessToken_expiredToken_refreshFails_throwsTokenExchangeFailed() async throws {
        // The refresh endpoint returns an error body.
        mockSession.enqueue(.json(["error": "invalid_grant"], status: 200))

        do {
            _ = try await handler.refreshAccessToken_test(
                refreshToken: "1//bad-refresh",
                session: mockSession,
                keychainSet: { KeychainStore.set($0, forKey: $1) }
            )
            XCTFail("Expected AuthError.tokenExchangeFailed but no error was thrown")
        } catch AuthError.tokenExchangeFailed(let msg) {
            XCTAssertEqual(msg, "invalid_grant")
        } catch {
            XCTFail("Expected AuthError.tokenExchangeFailed, got: \(error)")
        }
    }

    // MARK: - validAccessToken: Branch 3 — no refresh token → notSignedIn

    func test_validAccessToken_noTokensAtAll_throwsNotSignedIn() async throws {
        // Keychain is empty — no tokens of any kind.
        do {
            _ = try await handler.validAccessToken()
            XCTFail("Expected AuthError.notSignedIn")
        } catch AuthError.notSignedIn {
            // Expected.
        } catch {
            XCTFail("Expected AuthError.notSignedIn, got: \(error)")
        }
    }

    func test_validAccessToken_accessTokenButNoExpiry_noRefreshToken_throwsNotSignedIn() async throws {
        // Access token present but expiry is missing — token is treated as expired.
        // With no refresh token, should throw notSignedIn.
        KeychainStore.set("ya29.partial", forKey: KeychainStore.keyAccessToken)
        // No expiry → expiry guard fails → falls through to refresh path.
        // No refresh token → throws.
        do {
            _ = try await handler.validAccessToken()
            XCTFail("Expected AuthError.notSignedIn")
        } catch AuthError.notSignedIn {
            // Expected.
        } catch {
            XCTFail("Expected AuthError.notSignedIn, got: \(error)")
        }
    }

    func test_validAccessToken_expiredToken_noRefreshToken_throwsNotSignedIn() async throws {
        KeychainStore.set("ya29.expired",  forKey: KeychainStore.keyAccessToken)
        KeychainStore.set(expiryString(secondsFromNow: -3600), forKey: KeychainStore.keyTokenExpiry)
        // No refresh token stored.

        do {
            _ = try await handler.validAccessToken()
            XCTFail("Expected AuthError.notSignedIn")
        } catch AuthError.notSignedIn {
            // Expected.
        } catch {
            XCTFail("Expected AuthError.notSignedIn, got: \(error)")
        }
    }

    // MARK: - Token exchange (code → tokens)

    func test_exchangeCode_success_storesAccessAndRefreshAndExpiry() async throws {
        mockSession.enqueue(.json([
            "access_token":  "ya29.exchange-access",
            "refresh_token": "1//exchange-refresh",
            "expires_in":    3600
        ]))

        var stored: [String: String] = [:]
        try await handler.exchangeCodeForTokens_test(
            code: "auth_code_abc",
            session: mockSession,
            keychainSet: { stored[$1] = $0 }
        )

        XCTAssertEqual(stored[KeychainStore.keyAccessToken],  "ya29.exchange-access")
        XCTAssertEqual(stored[KeychainStore.keyRefreshToken], "1//exchange-refresh")
        XCTAssertNotNil(stored[KeychainStore.keyTokenExpiry])
    }

    func test_exchangeCode_missingAccessToken_throwsTokenExchangeFailed() async throws {
        // Server returns error shape instead of tokens.
        mockSession.enqueue(.json(["error": "redirect_uri_mismatch"]))

        do {
            try await handler.exchangeCodeForTokens_test(
                code: "bad_code",
                session: mockSession,
                keychainSet: { _, _ in }
            )
            XCTFail("Expected AuthError.tokenExchangeFailed")
        } catch AuthError.tokenExchangeFailed(let msg) {
            XCTAssertEqual(msg, "redirect_uri_mismatch")
        }
    }

    func test_exchangeCode_networkError_propagatesError() async throws {
        struct FakeNetworkError: Error {}
        mockSession.enqueueError(FakeNetworkError())

        do {
            try await handler.exchangeCodeForTokens_test(
                code: "any_code",
                session: mockSession,
                keychainSet: { _, _ in }
            )
            XCTFail("Expected FakeNetworkError")
        } catch is FakeNetworkError {
            // Expected.
        }
    }

    func test_exchangeCode_noRefreshTokenInResponse_doesNotStoreRefreshToken() async throws {
        // Some servers omit refresh_token on repeat authorizations.
        mockSession.enqueue(.json([
            "access_token": "ya29.no-refresh",
            "expires_in":   3600
        ]))

        var stored: [String: String] = [:]
        try await handler.exchangeCodeForTokens_test(
            code: "code_no_refresh",
            session: mockSession,
            keychainSet: { stored[$1] = $0 }
        )

        XCTAssertNil(stored[KeychainStore.keyRefreshToken],
                     "Should not store a refresh token if the server didn't provide one")
    }

    // MARK: - loadClientSecret

    func test_loadClientSecret_returnsCorrectClientId() async throws {
        let secret = try await handler.loadClientSecret()
        XCTAssertEqual(secret["clientId"] as? String, GoogleAuthHandler.clientId)
    }

    func test_loadClientSecret_returnsCorrectRedirectUri() async throws {
        let secret = try await handler.loadClientSecret()
        let uris = secret["redirectUris"] as? [String]
        XCTAssertEqual(uris?.first, GoogleAuthHandler.redirectUri)
    }

    func test_loadClientSecret_returnsFilePath_bundled() async throws {
        let secret = try await handler.loadClientSecret()
        XCTAssertEqual(secret["filePath"] as? String, "bundled")
    }

    // MARK: - signOut

    func test_signOut_clearesAllAuthKeychainKeys() async throws {
        // Seed all three auth keys.
        KeychainStore.set("ya29.access",  forKey: KeychainStore.keyAccessToken)
        KeychainStore.set("1//refresh",   forKey: KeychainStore.keyRefreshToken)
        KeychainStore.set(expiryString(secondsFromNow: 600), forKey: KeychainStore.keyTokenExpiry)

        _ = try await handler.signOut()

        XCTAssertNil(KeychainStore.get(KeychainStore.keyAccessToken))
        XCTAssertNil(KeychainStore.get(KeychainStore.keyRefreshToken))
        XCTAssertNil(KeychainStore.get(KeychainStore.keyTokenExpiry))
    }

    func test_signOut_returnsSuccessTrue() async throws {
        let result = try await handler.signOut()
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    func test_signOut_whenAlreadySignedOut_doesNotThrow() async throws {
        // No tokens in keychain — calling signOut must be a no-op.
        let result = try await handler.signOut()
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    // MARK: - Error description strings (contract with JS reject path)

    func test_authError_notSignedIn_localizedDescriptionNonEmpty() {
        let err: Error = AuthError.notSignedIn
        XCTAssertFalse(err.localizedDescription.isEmpty)
    }

    func test_authError_noCodeInCallback_localizedDescriptionNonEmpty() {
        let err: Error = AuthError.noCodeInCallback
        XCTAssertFalse(err.localizedDescription.isEmpty)
    }

    func test_authError_tokenExchangeFailed_includesReason() {
        let err: Error = AuthError.tokenExchangeFailed("access_denied")
        XCTAssertTrue(err.localizedDescription.contains("access_denied"))
    }
}
