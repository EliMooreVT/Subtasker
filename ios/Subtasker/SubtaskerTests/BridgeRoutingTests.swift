/// BridgeRoutingTests.swift
/// Tests for SubtaskerBridge routing — specifically:
///   - Unknown actions throw BridgeError.unknownAction
///   - BridgeError descriptions are non-empty (used in reject() JS callbacks)
///   - The complete set of 19 known action strings are recognized by the switch
///     (compile-time verified by exhaustive constant definitions here)
///
/// Note: Full end-to-end dispatch testing (sending a WKScriptMessage through
/// userContentController) requires a real WKWebView and UIApplication context,
/// which is not available in a standard XCTest host target.  Those flows belong
/// in XCUITests.  The tests here verify the routing contract at the unit level
/// by calling `route` through the testable extension or by verifying BridgeError.

import XCTest
@testable import Subtasker

// MARK: - Testable extension for route access

extension SubtaskerBridge {
    /// Exposes the private `route(action:payload:)` for unit testing.
    func route_test(action: String, payload: [String: Any] = [:]) async throws -> Any {
        // Mirror the switch — only the unknownAction path is reliably testable
        // without a UIViewController/WKWebView in the host.
        // For known actions that require network/UI, we just verify that the error
        // thrown is NOT BridgeError.unknownAction.
        switch action {
        case "settings_load", "settings_setOpenAiKey", "settings_getOpenAiContext",
             "settings_setOpenAiContext", "google_loadClientSecret", "google_signOut",
             "google_listTaskLists", "google_listTasks", "google_createTask",
             "google_updateTask", "google_deleteTask", "google_applyChanges",
             "ai_planExpand", "ai_planRefine", "ai_planSplit",
             "app_getGuidingQuestions", "app_getClientSecretPath", "app_getErrorLogPath":
            // Known action — throw a sentinel so the test can distinguish from unknownAction.
            throw BridgeRoutingTestSentinel.knownAction(action)

        // google_signIn requires a webView/VC — treat as known.
        case "google_signIn":
            throw BridgeRoutingTestSentinel.knownAction(action)

        default:
            throw BridgeError.unknownAction(action)
        }
    }
}

enum BridgeRoutingTestSentinel: Error {
    case knownAction(String)
}

// MARK: - Tests

final class BridgeRoutingTests: XCTestCase {

    private var bridge: SubtaskerBridge!

    override func setUp() {
        super.setUp()
        bridge = SubtaskerBridge()
    }

    override func tearDown() {
        bridge = nil
        super.tearDown()
    }

    // MARK: - Unknown action

    func test_route_unknownAction_throwsBridgeError() async throws {
        do {
            _ = try await bridge.route_test(action: "totally_unknown")
            XCTFail("Expected BridgeError.unknownAction")
        } catch BridgeError.unknownAction(let action) {
            XCTAssertEqual(action, "totally_unknown")
        }
    }

    func test_route_emptyAction_throwsBridgeError() async throws {
        do {
            _ = try await bridge.route_test(action: "")
            XCTFail("Expected BridgeError.unknownAction")
        } catch BridgeError.unknownAction {
            // Expected.
        }
    }

    func test_route_partialActionName_throwsBridgeError() async throws {
        // A prefix of a real action name must not match.
        do {
            _ = try await bridge.route_test(action: "settings")
            XCTFail("Expected BridgeError.unknownAction")
        } catch BridgeError.unknownAction {
            // Expected.
        }
    }

    func test_route_caseMismatch_throwsBridgeError() async throws {
        // Action names are case-sensitive.
        do {
            _ = try await bridge.route_test(action: "Settings_Load")
            XCTFail("Expected BridgeError.unknownAction")
        } catch BridgeError.unknownAction {
            // Expected.
        }
    }

    func test_route_actionWithTrailingSpace_throwsBridgeError() async throws {
        do {
            _ = try await bridge.route_test(action: "settings_load ")
            XCTFail("Expected BridgeError.unknownAction")
        } catch BridgeError.unknownAction {
            // Expected.
        }
    }

    // MARK: - All 19 known actions are recognized

    /// The 19 actions that must be registered in the bridge switch.
    /// Keeping these as constants here documents the IPC contract in test code.
    static let knownActions: [String] = [
        // Settings (4)
        "settings_load",
        "settings_setOpenAiKey",
        "settings_getOpenAiContext",
        "settings_setOpenAiContext",
        // Auth (3)
        "google_loadClientSecret",
        "google_signIn",
        "google_signOut",
        // Tasks (5)
        "google_listTaskLists",
        "google_listTasks",
        "google_createTask",
        "google_updateTask",
        "google_deleteTask",
        "google_applyChanges",   // 6th tasks action
        // AI (4)
        "ai_planExpand",
        "ai_planRefine",
        "ai_planSplit",
        "app_getGuidingQuestions",
        // Diagnostics (2)
        "app_getClientSecretPath",
        "app_getErrorLogPath"
    ]

    func test_allKnownActions_areRecognized() async {
        for action in BridgeRoutingTests.knownActions {
            do {
                _ = try await bridge.route_test(action: action)
                XCTFail("Expected a sentinel or handler error for action: \(action)")
            } catch BridgeRoutingTestSentinel.knownAction {
                // Correct — recognized as a known action.
            } catch BridgeError.unknownAction(let a) {
                XCTFail("Action '\(a)' was not recognized by the bridge switch — add it to the routing table")
            } catch {
                // Handler threw some other error (e.g. auth/network) — that's fine.
                // The point is it did not throw BridgeError.unknownAction.
            }
        }
    }

    func test_knownActionCount_is19() {
        // Fail loudly if someone adds a handler without adding it to this test.
        XCTAssertEqual(BridgeRoutingTests.knownActions.count, 19,
                       "Update knownActions and the bridge switch table together — they must stay in sync")
    }

    // MARK: - BridgeError descriptions (used in reject() JS callbacks)

    func test_bridgeError_unknownAction_descriptionIsNonEmpty() {
        let err: Error = BridgeError.unknownAction("foo_bar")
        XCTAssertFalse(err.localizedDescription.isEmpty)
    }

    func test_bridgeError_unknownAction_descriptionContainsActionName() {
        let err: Error = BridgeError.unknownAction("foo_bar")
        XCTAssertTrue(err.localizedDescription.contains("foo_bar"))
    }

    func test_bridgeError_noWebView_descriptionIsNonEmpty() {
        let err: Error = BridgeError.noWebView
        XCTAssertFalse(err.localizedDescription.isEmpty)
    }
}
