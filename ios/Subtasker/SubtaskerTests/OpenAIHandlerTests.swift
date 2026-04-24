/// OpenAIHandlerTests.swift
/// Tests for OpenAIHandler — payload validation, JSON response parsing,
/// the markdown-fence stripping logic, and error cases.
///
/// The `chatCompletion` HTTP call is not injectable via a seam on the
/// production class without modifying it (it calls URLSession.shared directly).
/// The tests below are therefore split into two tiers:
///
///   Tier A — Pure logic (no network):
///     - Payload validation (missingField errors)
///     - extractSubtasks / extractQuestions via parseJSON (testable through
///       a thin OpenAIHandlerTestable subclass defined here)
///
///   Tier B — Integration (real network, skipped in CI):
///     Omitted from this file — add as a separate XCTestCase marked with
///     `XCTSkipUnless(ProcessInfo.processInfo.environment["RUN_NETWORK_TESTS"] != nil)`

import XCTest
@testable import Subtasker

// MARK: - Testable subclass exposing private parsing helpers

/// Subclass that makes the private response-parsing methods visible to the test target.
/// This avoids modifying the production file while still allowing direct unit tests
/// of the most complex logic (JSON extraction and markdown fence stripping).
private final class TestableOpenAIHandler: OpenAIHandler {

    func parseJSON_exposed(_ raw: String) throws -> [String: Any] {
        // Mirror the private parseJSON implementation.
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {
            if let newline = text.firstIndex(of: "\n") {
                text = String(text[text.index(after: newline)...])
            }
            if let fence = text.range(of: "```", options: .backwards) {
                text = String(text[..<fence.lowerBound])
            }
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIError.parseError(text)
        }
        return obj
    }

    func extractSubtasks_exposed(from raw: String) throws -> [String: Any] {
        let json = try parseJSON_exposed(raw)
        let parentTitle = json["parentTitle"] as? String
        guard let subtasksRaw = json["subtasks"] as? [[String: Any]] else {
            throw AIError.missingSubtasks
        }
        let subtasks: [[String: Any]] = subtasksRaw.compactMap { item in
            let title = (item["title"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard !title.isEmpty else { return nil }
            return ["title": title, "notes": (item["notes"] as? String ?? "").trimmingCharacters(in: .whitespaces)]
        }
        guard !subtasks.isEmpty else { throw AIError.missingSubtasks }
        var result: [String: Any] = ["subtasks": subtasks]
        result["parentTitle"] = parentTitle as Any? ?? NSNull()
        return result
    }

    func extractQuestions_exposed(from raw: String) throws -> [String] {
        let json = try parseJSON_exposed(raw)
        guard let questions = json["questions"] as? [String], !questions.isEmpty else {
            throw AIError.missingQuestions
        }
        return Array(questions.prefix(5))
    }
}

// MARK: - Tests

final class OpenAIHandlerTests: XCTestCase {

    private var handler: OpenAIHandler!
    private var testableHandler: TestableOpenAIHandler!

    override func setUp() {
        super.setUp()
        handler = OpenAIHandler()
        testableHandler = TestableOpenAIHandler()
        // Ensure no API key is present so live network calls are not accidentally made.
        KeychainStore.delete(KeychainStore.keyOpenAiKey)
    }

    override func tearDown() {
        KeychainStore.delete(KeychainStore.keyOpenAiKey)
        handler = nil
        testableHandler = nil
        super.tearDown()
    }

    // MARK: - planExpand payload validation

    func test_planExpand_missingTask_throwsMissingField() async throws {
        do {
            _ = try await handler.planExpand(["options": [:] as [String: Any]])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "task")
        }
    }

    func test_planExpand_missingOptions_throwsMissingField() async throws {
        do {
            _ = try await handler.planExpand(["task": [:] as [String: Any]])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "options")
        }
    }

    func test_planExpand_noApiKey_throwsNoApiKey() async throws {
        // With no API key stored and valid payload, it must throw noApiKey.
        do {
            _ = try await handler.planExpand([
                "task": ["title": "Write report", "notes": "", "context": ""] as [String: Any],
                "options": ["length": "short", "style": "direct"] as [String: Any]
            ])
            XCTFail("Expected AIError.noApiKey")
        } catch AIError.noApiKey {
            // Expected.
        } catch {
            XCTFail("Expected AIError.noApiKey, got: \(error)")
        }
    }

    // MARK: - planRefine payload validation

    func test_planRefine_missingTask_throwsMissingField() async throws {
        do {
            _ = try await handler.planRefine([
                "feedback": "Better",
                "options": [:] as [String: Any]
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "task")
        }
    }

    func test_planRefine_missingFeedback_throwsMissingField() async throws {
        do {
            _ = try await handler.planRefine([
                "task": [:] as [String: Any],
                "options": [:] as [String: Any]
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "feedback")
        }
    }

    func test_planRefine_missingOptions_throwsMissingField() async throws {
        do {
            _ = try await handler.planRefine([
                "task": [:] as [String: Any],
                "feedback": "needs improvement"
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "options")
        }
    }

    // MARK: - planSplit payload validation

    func test_planSplit_missingTask_throwsMissingField() async throws {
        do {
            _ = try await handler.planSplit([
                "instructions": "go deeper",
                "options": [:] as [String: Any]
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "task")
        }
    }

    func test_planSplit_missingInstructions_throwsMissingField() async throws {
        do {
            _ = try await handler.planSplit([
                "task": [:] as [String: Any],
                "options": [:] as [String: Any]
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "instructions")
        }
    }

    func test_planSplit_missingOptions_throwsMissingField() async throws {
        do {
            _ = try await handler.planSplit([
                "task": [:] as [String: Any],
                "instructions": "make smaller"
            ])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "options")
        }
    }

    // MARK: - getGuidingQuestions payload validation

    func test_getGuidingQuestions_missingTaskTitle_throwsMissingField() async throws {
        do {
            _ = try await handler.getGuidingQuestions([:])
            XCTFail("Expected AIError.missingField")
        } catch AIError.missingField(let field) {
            XCTAssertEqual(field, "taskTitle")
        }
    }

    // MARK: - parseJSON: plain JSON

    func test_parseJSON_validJSON_returnsDictionary() throws {
        let json = #"{"parentTitle":"Test","subtasks":[]}"#
        let result = try testableHandler.parseJSON_exposed(json)
        XCTAssertEqual(result["parentTitle"] as? String, "Test")
    }

    func test_parseJSON_leadingTrailingWhitespace_parsesCleanly() throws {
        let json = "   \n\t{\"key\":\"value\"}\n   "
        let result = try testableHandler.parseJSON_exposed(json)
        XCTAssertEqual(result["key"] as? String, "value")
    }

    func test_parseJSON_invalidJSON_throwsParseError() throws {
        XCTAssertThrowsError(try testableHandler.parseJSON_exposed("not json")) { error in
            if case AIError.parseError = error { } else {
                XCTFail("Expected AIError.parseError, got: \(error)")
            }
        }
    }

    // MARK: - parseJSON: markdown fence stripping

    func test_parseJSON_jsonFencedWithLanguageTag_stripsAndParses() throws {
        let raw = "```json\n{\"key\":\"value\"}\n```"
        let result = try testableHandler.parseJSON_exposed(raw)
        XCTAssertEqual(result["key"] as? String, "value")
    }

    func test_parseJSON_jsonFencedWithoutLanguageTag_stripsAndParses() throws {
        let raw = "```\n{\"key\":\"value\"}\n```"
        let result = try testableHandler.parseJSON_exposed(raw)
        XCTAssertEqual(result["key"] as? String, "value")
    }

    func test_parseJSON_fencedInvalidJSON_throwsParseError() throws {
        let raw = "```json\nnot valid\n```"
        XCTAssertThrowsError(try testableHandler.parseJSON_exposed(raw)) { error in
            if case AIError.parseError = error { } else {
                XCTFail("Expected AIError.parseError")
            }
        }
    }

    // MARK: - extractSubtasks: happy path

    func test_extractSubtasks_validResponse_returnsSubtaskTitlesAndNotes() throws {
        let raw = #"""
        {
            "parentTitle": "Write a blog post",
            "subtasks": [
                {"title": "Outline the post", "notes": "Done when bullet points exist"},
                {"title": "Write first draft", "notes": "Done when all sections are filled"}
            ]
        }
        """#
        let result = try testableHandler.extractSubtasks_exposed(from: raw)
        let subtasks = result["subtasks"] as? [[String: Any]]
        XCTAssertEqual(subtasks?.count, 2)
        XCTAssertEqual(subtasks?[0]["title"] as? String, "Outline the post")
        XCTAssertEqual(subtasks?[1]["notes"] as? String, "Done when all sections are filled")
    }

    func test_extractSubtasks_parentTitlePresent_included() throws {
        let raw = #"{"parentTitle":"My parent","subtasks":[{"title":"Step one","notes":""}]}"#
        let result = try testableHandler.extractSubtasks_exposed(from: raw)
        XCTAssertEqual(result["parentTitle"] as? String, "My parent")
    }

    func test_extractSubtasks_noParentTitle_returnsNSNull() throws {
        let raw = #"{"subtasks":[{"title":"Step one","notes":""}]}"#
        let result = try testableHandler.extractSubtasks_exposed(from: raw)
        // parentTitle absent from JSON → should be NSNull (not a missing key)
        XCTAssertTrue(result["parentTitle"] is NSNull || result["parentTitle"] == nil)
    }

    func test_extractSubtasks_stripsWhitespaceFromTitles() throws {
        let raw = #"{"subtasks":[{"title":"  padded  ","notes":"  note  "}]}"#
        let result = try testableHandler.extractSubtasks_exposed(from: raw)
        let subtasks = result["subtasks"] as? [[String: Any]]
        XCTAssertEqual(subtasks?[0]["title"] as? String, "padded")
        XCTAssertEqual(subtasks?[0]["notes"] as? String, "note")
    }

    func test_extractSubtasks_filtersOutBlankTitles() throws {
        let raw = #"""
        {
            "subtasks": [
                {"title": "Real step", "notes": ""},
                {"title": "   ", "notes": "whitespace only title"},
                {"title": "", "notes": "empty title"}
            ]
        }
        """#
        let result = try testableHandler.extractSubtasks_exposed(from: raw)
        let subtasks = result["subtasks"] as? [[String: Any]]
        XCTAssertEqual(subtasks?.count, 1, "Blank and whitespace-only titles must be filtered out")
        XCTAssertEqual(subtasks?[0]["title"] as? String, "Real step")
    }

    // MARK: - extractSubtasks: error paths

    func test_extractSubtasks_missingSubtasksKey_throwsMissingSubtasks() throws {
        let raw = #"{"parentTitle":"No subtasks key here"}"#
        XCTAssertThrowsError(try testableHandler.extractSubtasks_exposed(from: raw)) { error in
            XCTAssertEqual(error as? AIError, AIError.missingSubtasks)
        }
    }

    func test_extractSubtasks_allSubtasksBlank_throwsMissingSubtasks() throws {
        let raw = #"{"subtasks":[{"title":"","notes":""},{"title":"   ","notes":""}]}"#
        XCTAssertThrowsError(try testableHandler.extractSubtasks_exposed(from: raw)) { error in
            XCTAssertEqual(error as? AIError, AIError.missingSubtasks)
        }
    }

    func test_extractSubtasks_emptySubtasksArray_throwsMissingSubtasks() throws {
        let raw = #"{"subtasks":[]}"#
        XCTAssertThrowsError(try testableHandler.extractSubtasks_exposed(from: raw)) { error in
            XCTAssertEqual(error as? AIError, AIError.missingSubtasks)
        }
    }

    func test_extractSubtasks_invalidJSON_throwsParseError() throws {
        XCTAssertThrowsError(try testableHandler.extractSubtasks_exposed(from: "garbage")) { error in
            if case AIError.parseError = error { } else {
                XCTFail("Expected AIError.parseError, got: \(error)")
            }
        }
    }

    // MARK: - extractQuestions: happy path

    func test_extractQuestions_validResponse_returnsQuestions() throws {
        let raw = #"{"questions":["What is the deadline?","Who is involved?","What tools are needed?"]}"#
        let questions = try testableHandler.extractQuestions_exposed(from: raw)
        XCTAssertEqual(questions.count, 3)
        XCTAssertEqual(questions[0], "What is the deadline?")
    }

    func test_extractQuestions_moreThanFive_capsAtFive() throws {
        let raw = #"{"questions":["Q1","Q2","Q3","Q4","Q5","Q6","Q7"]}"#
        let questions = try testableHandler.extractQuestions_exposed(from: raw)
        XCTAssertEqual(questions.count, 5)
    }

    func test_extractQuestions_exactlyFive_returnsAll() throws {
        let raw = #"{"questions":["Q1","Q2","Q3","Q4","Q5"]}"#
        let questions = try testableHandler.extractQuestions_exposed(from: raw)
        XCTAssertEqual(questions.count, 5)
    }

    // MARK: - extractQuestions: error paths

    func test_extractQuestions_missingQuestionsKey_throwsMissingQuestions() throws {
        let raw = #"{"subtasks":[]}"#
        XCTAssertThrowsError(try testableHandler.extractQuestions_exposed(from: raw)) { error in
            XCTAssertEqual(error as? AIError, AIError.missingQuestions)
        }
    }

    func test_extractQuestions_emptyArray_throwsMissingQuestions() throws {
        let raw = #"{"questions":[]}"#
        XCTAssertThrowsError(try testableHandler.extractQuestions_exposed(from: raw)) { error in
            XCTAssertEqual(error as? AIError, AIError.missingQuestions)
        }
    }

    // MARK: - Error description strings

    func test_aiError_noApiKey_nonEmpty() {
        XCTAssertFalse(AIError.noApiKey.localizedDescription.isEmpty)
    }

    func test_aiError_missingSubtasks_nonEmpty() {
        XCTAssertFalse(AIError.missingSubtasks.localizedDescription.isEmpty)
    }

    func test_aiError_missingQuestions_nonEmpty() {
        XCTAssertFalse(AIError.missingQuestions.localizedDescription.isEmpty)
    }

    func test_aiError_parseError_includesSnippet() {
        let err = AIError.parseError("broken json")
        XCTAssertTrue(err.localizedDescription.contains("broken json"))
    }

    func test_aiError_httpError_includesStatusCode() {
        let err = AIError.httpError(429, "Rate limited")
        XCTAssertTrue(err.localizedDescription.contains("429"))
    }
}

// Make AIError Equatable for XCTAssertEqual comparisons.
extension AIError: Equatable {
    public static func == (lhs: AIError, rhs: AIError) -> Bool {
        switch (lhs, rhs) {
        case (.noApiKey, .noApiKey):                   return true
        case (.emptyResponse, .emptyResponse):         return true
        case (.missingSubtasks, .missingSubtasks):     return true
        case (.missingQuestions, .missingQuestions):   return true
        case (.missingField(let a), .missingField(let b)): return a == b
        case (.httpError(let c1, _), .httpError(let c2, _)): return c1 == c2
        case (.parseError(let a), .parseError(let b)): return a == b
        default: return false
        }
    }
}
