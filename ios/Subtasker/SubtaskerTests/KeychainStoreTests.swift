/// KeychainStoreTests.swift
/// Tests for KeychainStore.set / get / delete round-trips.
///
/// These tests hit the REAL Security framework keychain, which is available in
/// the iOS Simulator without any entitlement changes.  On a physical device you
/// need a provisioning profile with the Keychain Sharing entitlement, or these
/// tests will fail with errSecMissingEntitlement (-34018).
///
/// To isolate test state each test uses a unique key prefix so concurrent test
/// runs cannot bleed into one another.

import XCTest
@testable import Subtasker

final class KeychainStoreTests: XCTestCase {

    // Each test gets a fresh namespace so we never read stale state left by a
    // previous run.  All keys are cleaned up in tearDown.
    private var testKeyPrefix: String!
    private var allUsedKeys: [String] = []

    override func setUp() {
        super.setUp()
        testKeyPrefix = "test_\(UUID().uuidString)_"
        allUsedKeys = []
    }

    override func tearDown() {
        // Purge every key we touched so Keychain state is clean for the next run.
        allUsedKeys.forEach { KeychainStore.delete($0) }
        // Also purge the four well-known production keys in case any test wrote them.
        [
            KeychainStore.keyAccessToken,
            KeychainStore.keyRefreshToken,
            KeychainStore.keyTokenExpiry,
            KeychainStore.keyOpenAiKey
        ].forEach { KeychainStore.delete($0) }
        super.tearDown()
    }

    // MARK: - Helper

    private func key(_ suffix: String) -> String {
        let k = testKeyPrefix + suffix
        allUsedKeys.append(k)
        return k
    }

    // MARK: - Basic round-trips

    func test_set_get_returnsStoredValue() {
        let k = key("basic")
        KeychainStore.set("hello-world", forKey: k)
        XCTAssertEqual(KeychainStore.get(k), "hello-world")
    }

    func test_get_beforeSet_returnsNil() {
        let k = key("missing")
        XCTAssertNil(KeychainStore.get(k))
    }

    func test_delete_removesStoredValue() {
        let k = key("delete")
        KeychainStore.set("to-be-deleted", forKey: k)
        KeychainStore.delete(k)
        XCTAssertNil(KeychainStore.get(k))
    }

    func test_delete_onNonExistentKey_doesNotCrash() {
        // Calling delete on an absent key must be a no-op (no crash or assert).
        KeychainStore.delete(key("never-existed"))
    }

    // MARK: - Overwrite (update path)

    func test_set_overwriteExistingKey_returnsNewValue() {
        let k = key("overwrite")
        KeychainStore.set("first", forKey: k)
        KeychainStore.set("second", forKey: k)
        XCTAssertEqual(KeychainStore.get(k), "second")
    }

    func test_set_overwrite_doesNotDuplicate() {
        // Repeated sets must still return a single value, not a concatenation.
        let k = key("noduplicate")
        for i in 0..<5 {
            KeychainStore.set("value\(i)", forKey: k)
        }
        XCTAssertEqual(KeychainStore.get(k), "value4")
    }

    // MARK: - Multiple independent keys

    func test_multipleKeys_storeIndependently() {
        let k1 = key("key1")
        let k2 = key("key2")
        KeychainStore.set("alpha", forKey: k1)
        KeychainStore.set("beta",  forKey: k2)
        XCTAssertEqual(KeychainStore.get(k1), "alpha")
        XCTAssertEqual(KeychainStore.get(k2), "beta")
    }

    func test_deleteOneKey_doesNotAffectOtherKeys() {
        let k1 = key("stays")
        let k2 = key("goes")
        KeychainStore.set("keeper", forKey: k1)
        KeychainStore.set("goner",  forKey: k2)
        KeychainStore.delete(k2)
        XCTAssertEqual(KeychainStore.get(k1), "keeper")
        XCTAssertNil(KeychainStore.get(k2))
    }

    // MARK: - Boundary / edge cases

    func test_set_emptyString_roundTrips() {
        let k = key("empty")
        KeychainStore.set("", forKey: k)
        // Empty string should be stored and retrievable as empty string (not nil).
        XCTAssertEqual(KeychainStore.get(k), "")
    }

    func test_set_longValue_roundTrips() {
        let k = key("long")
        let longValue = String(repeating: "x", count: 4096)
        KeychainStore.set(longValue, forKey: k)
        XCTAssertEqual(KeychainStore.get(k), longValue)
    }

    func test_set_unicodeValue_roundTrips() {
        let k = key("unicode")
        let unicode = "日本語テスト 🔑 Ünïcödé"
        KeychainStore.set(unicode, forKey: k)
        XCTAssertEqual(KeychainStore.get(k), unicode)
    }

    func test_set_specialCharsInValue_roundTrips() {
        let k = key("special")
        let special = "token=abc&scope=tasks&expires_in=3600\nnewline"
        KeychainStore.set(special, forKey: k)
        XCTAssertEqual(KeychainStore.get(k), special)
    }

    // MARK: - Named production keys

    func test_namedKeys_accessTokenRoundTrip() {
        KeychainStore.set("ya29.test-token", forKey: KeychainStore.keyAccessToken)
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyAccessToken), "ya29.test-token")
    }

    func test_namedKeys_refreshTokenRoundTrip() {
        KeychainStore.set("1//test-refresh", forKey: KeychainStore.keyRefreshToken)
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyRefreshToken), "1//test-refresh")
    }

    func test_namedKeys_tokenExpiryRoundTrip() {
        let expiry = ISO8601DateFormatter().string(from: Date())
        KeychainStore.set(expiry, forKey: KeychainStore.keyTokenExpiry)
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyTokenExpiry), expiry)
    }

    func test_namedKeys_openAiKeyRoundTrip() {
        KeychainStore.set("sk-proj-abc123", forKey: KeychainStore.keyOpenAiKey)
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyOpenAiKey), "sk-proj-abc123")
    }

    // MARK: - Post-delete / post-signOut state

    func test_deleteAllAuthKeys_allReturnNil() {
        KeychainStore.set("access",  forKey: KeychainStore.keyAccessToken)
        KeychainStore.set("refresh", forKey: KeychainStore.keyRefreshToken)
        KeychainStore.set("2099-01-01T00:00:00Z", forKey: KeychainStore.keyTokenExpiry)

        KeychainStore.delete(KeychainStore.keyAccessToken)
        KeychainStore.delete(KeychainStore.keyRefreshToken)
        KeychainStore.delete(KeychainStore.keyTokenExpiry)

        XCTAssertNil(KeychainStore.get(KeychainStore.keyAccessToken))
        XCTAssertNil(KeychainStore.get(KeychainStore.keyRefreshToken))
        XCTAssertNil(KeychainStore.get(KeychainStore.keyTokenExpiry))
    }
}
