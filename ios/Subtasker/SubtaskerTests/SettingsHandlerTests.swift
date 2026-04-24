/// SettingsHandlerTests.swift
/// Tests for SettingsHandler and SettingsStore.
///
/// SettingsHandler is the thinnest handler — it delegates entirely to
/// KeychainStore (for the OpenAI key) and SettingsStore (for openAiContext).
/// Tests verify both the delegation contract and the UserDefaults persistence.

import XCTest
@testable import Subtasker

final class SettingsHandlerTests: XCTestCase {

    private var handler: SettingsHandler!

    // Dedicated UserDefaults suite so we never pollute UserDefaults.standard
    // and tests run in an isolated namespace.
    private let testDefaults = UserDefaults(suiteName: "SettingsHandlerTests")!

    override func setUp() {
        super.setUp()
        handler = SettingsHandler()
        // Clear the well-known UserDefaults key before each test.
        UserDefaults.standard.removeObject(forKey: "openai_context")
        // Clear keychain keys.
        KeychainStore.delete(KeychainStore.keyOpenAiKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "openai_context")
        KeychainStore.delete(KeychainStore.keyOpenAiKey)
        handler = nil
        super.tearDown()
    }

    // MARK: - load()

    func test_load_hasClientSecretAlwaysTrue() async throws {
        let result = try await handler.load()
        XCTAssertEqual(result["hasClientSecret"] as? Bool, true,
                       "iOS always has a bundled client ID so hasClientSecret must always be true")
    }

    func test_load_openAiKey_whenNoKeyStored_returnsEmptyString() async throws {
        let result = try await handler.load()
        XCTAssertEqual(result["openAiKey"] as? String, "")
    }

    func test_load_openAiKey_whenKeyStored_returnsKey() async throws {
        KeychainStore.set("sk-test-abc", forKey: KeychainStore.keyOpenAiKey)
        let result = try await handler.load()
        XCTAssertEqual(result["openAiKey"] as? String, "sk-test-abc")
    }

    // MARK: - setOpenAiKey()

    func test_setOpenAiKey_validKey_storesInKeychain() async throws {
        _ = try await handler.setOpenAiKey(["key": "sk-proj-xyz"])
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyOpenAiKey), "sk-proj-xyz")
    }

    func test_setOpenAiKey_validKey_returnsSuccess() async throws {
        let result = try await handler.setOpenAiKey(["key": "sk-proj-xyz"])
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    func test_setOpenAiKey_emptyString_deletesFromKeychain() async throws {
        // Pre-seed a key, then clear it.
        KeychainStore.set("sk-old-key", forKey: KeychainStore.keyOpenAiKey)
        _ = try await handler.setOpenAiKey(["key": ""])
        XCTAssertNil(KeychainStore.get(KeychainStore.keyOpenAiKey))
    }

    func test_setOpenAiKey_missingKey_treatsAsEmpty_deletesFromKeychain() async throws {
        // If the "key" field is absent from the payload, it defaults to "".
        KeychainStore.set("sk-old-key", forKey: KeychainStore.keyOpenAiKey)
        _ = try await handler.setOpenAiKey([:])
        XCTAssertNil(KeychainStore.get(KeychainStore.keyOpenAiKey))
    }

    func test_setOpenAiKey_overwrite_replacesOldKey() async throws {
        _ = try await handler.setOpenAiKey(["key": "sk-first"])
        _ = try await handler.setOpenAiKey(["key": "sk-second"])
        XCTAssertEqual(KeychainStore.get(KeychainStore.keyOpenAiKey), "sk-second")
    }

    // MARK: - getOpenAiContext()

    func test_getOpenAiContext_whenNotSet_returnsEmptyString() async throws {
        let context = try await handler.getOpenAiContext()
        XCTAssertEqual(context, "")
    }

    func test_getOpenAiContext_whenSet_returnsStoredValue() async throws {
        SettingsStore.openAiContext = "I work in healthcare"
        let context = try await handler.getOpenAiContext()
        XCTAssertEqual(context, "I work in healthcare")
    }

    // MARK: - setOpenAiContext()

    func test_setOpenAiContext_storesValue() async throws {
        _ = try await handler.setOpenAiContext(["context": "project management background"])
        XCTAssertEqual(SettingsStore.openAiContext, "project management background")
    }

    func test_setOpenAiContext_returnsSuccess() async throws {
        let result = try await handler.setOpenAiContext(["context": "some context"])
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    func test_setOpenAiContext_emptyString_clearsContext() async throws {
        SettingsStore.openAiContext = "old context"
        _ = try await handler.setOpenAiContext(["context": ""])
        XCTAssertEqual(SettingsStore.openAiContext, "")
    }

    func test_setOpenAiContext_missingContextKey_defaultsToEmpty() async throws {
        SettingsStore.openAiContext = "pre-existing"
        _ = try await handler.setOpenAiContext([:])
        XCTAssertEqual(SettingsStore.openAiContext, "")
    }

    func test_setOpenAiContext_persistsAcrossHandlerInstances() async throws {
        _ = try await handler.setOpenAiContext(["context": "persistent value"])
        let newHandler = SettingsHandler()
        let context = try await newHandler.getOpenAiContext()
        XCTAssertEqual(context, "persistent value")
    }

    // MARK: - SettingsStore.openAiContext (direct)

    func test_settingsStore_openAiContext_defaultIsEmpty() {
        UserDefaults.standard.removeObject(forKey: "openai_context")
        XCTAssertEqual(SettingsStore.openAiContext, "")
    }

    func test_settingsStore_openAiContext_roundTrip() {
        SettingsStore.openAiContext = "test context"
        XCTAssertEqual(SettingsStore.openAiContext, "test context")
    }

    func test_settingsStore_openAiContext_overwrite() {
        SettingsStore.openAiContext = "first"
        SettingsStore.openAiContext = "second"
        XCTAssertEqual(SettingsStore.openAiContext, "second")
    }

    // MARK: - SettingsStore.errorLogPath

    func test_settingsStore_errorLogPath_nonEmpty() {
        XCTAssertFalse(SettingsStore.errorLogPath.isEmpty)
    }

    func test_settingsStore_errorLogPath_endsWithLogFileName() {
        XCTAssertTrue(SettingsStore.errorLogPath.hasSuffix("subtasker-error.log"))
    }

    func test_settingsStore_errorLogPath_containsSubtaskerDirectory() {
        XCTAssertTrue(SettingsStore.errorLogPath.contains("Subtasker"))
    }

    func test_settingsStore_errorLogPath_directoryIsCreated() {
        let path = SettingsStore.errorLogPath
        let dir = (path as NSString).deletingLastPathComponent
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: dir, isDirectory: &isDir)
        XCTAssertTrue(exists && isDir.boolValue, "Application support directory must be created by errorLogPath getter")
    }

    // MARK: - SettingsStore.logError

    func test_settingsStore_logError_writesLineToFile() throws {
        struct TestError: LocalizedError {
            var errorDescription: String? { "unit test error" }
        }
        let logPath = SettingsStore.errorLogPath
        // Remove any pre-existing log so we can assert from scratch.
        try? FileManager.default.removeItem(atPath: logPath)

        SettingsStore.logError("TestContext", TestError())

        let content = try String(contentsOfFile: logPath, encoding: .utf8)
        XCTAssertTrue(content.contains("TestContext"))
        XCTAssertTrue(content.contains("unit test error"))

        // Cleanup.
        try? FileManager.default.removeItem(atPath: logPath)
    }

    func test_settingsStore_logError_appendsToExistingFile() throws {
        struct TestError: LocalizedError {
            let msg: String
            var errorDescription: String? { msg }
        }
        let logPath = SettingsStore.errorLogPath
        try? FileManager.default.removeItem(atPath: logPath)

        SettingsStore.logError("First", TestError(msg: "error one"))
        SettingsStore.logError("Second", TestError(msg: "error two"))

        let content = try String(contentsOfFile: logPath, encoding: .utf8)
        XCTAssertTrue(content.contains("error one"))
        XCTAssertTrue(content.contains("error two"))

        try? FileManager.default.removeItem(atPath: logPath)
    }
}
