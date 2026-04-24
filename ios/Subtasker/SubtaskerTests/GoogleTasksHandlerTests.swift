/// GoogleTasksHandlerTests.swift
/// Tests for GoogleTasksHandler — payload validation, normalization logic,
/// HTTP error handling, and the applyChanges operation dispatch.
///
/// HTTP calls use the `*_test` seams from HandlerTestExtensions.swift so we
/// can inject a MockURLSession.  The `validAccessToken()` contract is exercised
/// via a pre-seeded Keychain token (matching the approach in GoogleAuthHandlerTests).

import XCTest
@testable import Subtasker

final class GoogleTasksHandlerTests: XCTestCase {

    private var handler: GoogleTasksHandler!
    private var auth: GoogleAuthHandler!
    private var mockSession: MockURLSession!

    // A fake access token injected via Keychain so validAccessToken() returns quickly.
    private let fakeToken = "ya29.test-token"

    override func setUp() {
        super.setUp()
        auth = GoogleAuthHandler()
        handler = GoogleTasksHandler(auth: auth)
        mockSession = MockURLSession()

        // Seed a non-expired access token so validAccessToken() returns without a
        // network call.  The test seams bypass auth entirely, so this is only
        // relevant for any test that calls the real (non-seam) handler methods.
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
        KeychainStore.set(fakeToken, forKey: KeychainStore.keyAccessToken)
        KeychainStore.set(expiry,    forKey: KeychainStore.keyTokenExpiry)
    }

    override func tearDown() {
        KeychainStore.delete(KeychainStore.keyAccessToken)
        KeychainStore.delete(KeychainStore.keyRefreshToken)
        KeychainStore.delete(KeychainStore.keyTokenExpiry)
        handler = nil
        auth = nil
        mockSession = nil
        super.tearDown()
    }

    // MARK: - listTaskLists

    func test_listTaskLists_success_returnsIdAndTitle() async throws {
        mockSession.enqueue(.json([
            "items": [
                ["id": "list1", "title": "My Tasks", "extra": "ignored"],
                ["id": "list2", "title": "Work"]
            ]
        ]))

        let lists = try await handler.listTaskLists_test(token: fakeToken, session: mockSession)

        XCTAssertEqual(lists.count, 2)
        XCTAssertEqual(lists[0]["id"] as? String, "list1")
        XCTAssertEqual(lists[0]["title"] as? String, "My Tasks")
        XCTAssertNil(lists[0]["extra"], "Extra fields from the API must be stripped")
    }

    func test_listTaskLists_emptyItems_returnsEmptyArray() async throws {
        mockSession.enqueue(.json(["items": [[String: Any]]()]))

        let lists = try await handler.listTaskLists_test(token: fakeToken, session: mockSession)

        XCTAssertEqual(lists.count, 0)
    }

    func test_listTaskLists_missingItemsKey_returnsEmptyArray() async throws {
        // API may return an empty envelope (no "items" key at all).
        mockSession.enqueue(.json([:]))

        let lists = try await handler.listTaskLists_test(token: fakeToken, session: mockSession)

        XCTAssertEqual(lists.count, 0)
    }

    func test_listTaskLists_http4xx_throwsHttpError() async throws {
        mockSession.enqueue(.string("Unauthorized", status: 401))

        do {
            _ = try await handler.listTaskLists_test(token: fakeToken, session: mockSession)
            XCTFail("Expected TaskError.httpError")
        } catch TaskError.httpError(let code, _) {
            XCTAssertEqual(code, 401)
        }
    }

    func test_listTaskLists_http5xx_throwsHttpError() async throws {
        mockSession.enqueue(.string("Internal Server Error", status: 500))

        do {
            _ = try await handler.listTaskLists_test(token: fakeToken, session: mockSession)
            XCTFail("Expected TaskError.httpError")
        } catch TaskError.httpError(let code, _) {
            XCTAssertEqual(code, 500)
        }
    }

    // MARK: - listTasks (payload validation)

    func test_listTasks_missingListId_throwsMissingField() async throws {
        // Call the real handler method which validates the payload before hitting network.
        do {
            _ = try await handler.listTasks([:])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "listId")
        }
    }

    func test_listTasks_success_returnsNormalizedTasks() async throws {
        mockSession.enqueue(.json([
            "items": [
                [
                    "id": "task1",
                    "title": "Buy groceries",
                    "notes": "Milk, eggs",
                    "status": "needsAction",
                    "position": "00000000001"
                ]
            ]
        ]))

        let tasks = try await handler.listTasks_test(
            listId: "list1",
            token: fakeToken,
            session: mockSession
        )

        XCTAssertEqual(tasks.count, 1)
        XCTAssertEqual(tasks[0]["id"] as? String, "task1")
        XCTAssertEqual(tasks[0]["title"] as? String, "Buy groceries")
        XCTAssertEqual(tasks[0]["notes"] as? String, "Milk, eggs")
        XCTAssertEqual(tasks[0]["status"] as? String, "needsAction")
    }

    func test_listTasks_emptyItems_returnsEmptyArray() async throws {
        mockSession.enqueue(.json(["items": [[String: Any]]()]))

        let tasks = try await handler.listTasks_test(
            listId: "list1",
            token: fakeToken,
            session: mockSession
        )

        XCTAssertEqual(tasks.count, 0)
    }

    // MARK: - Task normalization

    func test_normalizeTask_populatesAllFields() {
        let raw: [String: Any] = [
            "id": "t1",
            "title": "Test task",
            "notes": "Some notes",
            "status": "completed",
            "due": "2025-01-01T00:00:00.000Z",
            "parent": "parentId",
            "position": "00000000002"
        ]
        let normalized = handler.normalizeTask_test(raw)

        XCTAssertEqual(normalized["id"] as? String, "t1")
        XCTAssertEqual(normalized["title"] as? String, "Test task")
        XCTAssertEqual(normalized["notes"] as? String, "Some notes")
        XCTAssertEqual(normalized["status"] as? String, "completed")
        XCTAssertEqual(normalized["due"] as? String, "2025-01-01T00:00:00.000Z")
        XCTAssertEqual(normalized["parent"] as? String, "parentId")
        XCTAssertEqual(normalized["position"] as? String, "00000000002")
        XCTAssertEqual((normalized["subtasks"] as? [[String: Any]])?.count, 0)
    }

    func test_normalizeTask_missingOptionalFields_usesDefaults() {
        // An API response that only has id and title — all other fields default.
        let raw: [String: Any] = ["id": "t2", "title": "Minimal"]
        let normalized = handler.normalizeTask_test(raw)

        XCTAssertEqual(normalized["notes"] as? String, "")
        XCTAssertEqual(normalized["status"] as? String, "needsAction")
        XCTAssertTrue(normalized["due"] is NSNull)
        XCTAssertTrue(normalized["parent"] is NSNull)
        XCTAssertEqual(normalized["position"] as? String, "")
    }

    func test_normalizeTask_subtasksAlwaysEmptyArray() {
        // The normalization step always produces an empty subtasks array.
        // Subtask nesting is assembled by the UI layer, not the API.
        let raw: [String: Any] = ["id": "t3"]
        let normalized = handler.normalizeTask_test(raw)
        let subtasks = normalized["subtasks"] as? [[String: Any]]
        XCTAssertNotNil(subtasks)
        XCTAssertEqual(subtasks?.count, 0)
    }

    // MARK: - createTask payload validation

    func test_createTask_missingListId_throwsMissingField() async throws {
        do {
            _ = try await handler.createTask(["payload": ["title": "Task"]])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "listId")
        }
    }

    func test_createTask_missingPayload_throwsMissingField() async throws {
        do {
            _ = try await handler.createTask(["listId": "list1"])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "payload")
        }
    }

    // MARK: - updateTask payload validation

    func test_updateTask_missingListId_throwsMissingField() async throws {
        do {
            _ = try await handler.updateTask(["taskId": "t1", "payload": [:]])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "listId")
        }
    }

    func test_updateTask_missingTaskId_throwsMissingField() async throws {
        do {
            _ = try await handler.updateTask(["listId": "list1", "payload": [:]])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "taskId")
        }
    }

    func test_updateTask_missingPayload_throwsMissingField() async throws {
        do {
            _ = try await handler.updateTask(["listId": "list1", "taskId": "t1"])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "payload")
        }
    }

    // MARK: - deleteTask payload validation

    func test_deleteTask_missingListId_throwsMissingField() async throws {
        do {
            _ = try await handler.deleteTask(["taskId": "t1"])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "listId")
        }
    }

    func test_deleteTask_missingTaskId_throwsMissingField() async throws {
        do {
            _ = try await handler.deleteTask(["listId": "list1"])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "taskId")
        }
    }

    // MARK: - applyChanges payload validation

    func test_applyChanges_missingListId_throwsMissingField() async throws {
        do {
            _ = try await handler.applyChanges(["operations": [[String: Any]]() as Any])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "listId")
        }
    }

    func test_applyChanges_missingOperations_throwsMissingField() async throws {
        do {
            _ = try await handler.applyChanges(["listId": "list1"])
            XCTFail("Expected TaskError.missingField")
        } catch TaskError.missingField(let field) {
            XCTAssertEqual(field, "operations")
        }
    }

    func test_applyChanges_emptyOperations_returnsSuccess() async throws {
        // Seed a valid token so the method doesn't throw notSignedIn.
        let result = try await handler.applyChanges([
            "listId": "list1",
            "operations": [[String: Any]]()
        ])
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    func test_applyChanges_unknownOperationKind_skippedSilently() async throws {
        // Operations with unknown `kind` values must be skipped without throwing.
        let result = try await handler.applyChanges([
            "listId": "list1",
            "operations": [["kind": "unknown_future_op", "taskId": "t1"]]
        ])
        XCTAssertEqual(result["success"] as? Bool, true)
    }

    // MARK: - HTTP helper tests

    func test_checkHTTP_2xx_doesNotThrow() throws {
        let url = URL(string: "https://example.com")!
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
        XCTAssertNoThrow(try handler.checkHTTP_test(response, Data()))
    }

    func test_checkHTTP_204_doesNotThrow() throws {
        let url = URL(string: "https://example.com")!
        let response = HTTPURLResponse(url: url, statusCode: 204, httpVersion: nil, headerFields: nil)!
        XCTAssertNoThrow(try handler.checkHTTP_test(response, Data()))
    }

    func test_checkHTTP_400_throwsHttpError() throws {
        let url = URL(string: "https://example.com")!
        let response = HTTPURLResponse(url: url, statusCode: 400, httpVersion: nil, headerFields: nil)!
        XCTAssertThrowsError(try handler.checkHTTP_test(response, Data("Bad Request".utf8))) { error in
            if case TaskError.httpError(let code, _) = error {
                XCTAssertEqual(code, 400)
            } else {
                XCTFail("Expected TaskError.httpError, got: \(error)")
            }
        }
    }

    func test_checkHTTP_404_throwsHttpError() throws {
        let url = URL(string: "https://example.com")!
        let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
        XCTAssertThrowsError(try handler.checkHTTP_test(response, Data())) { error in
            if case TaskError.httpError(let code, _) = error {
                XCTAssertEqual(code, 404)
            } else {
                XCTFail("Expected TaskError.httpError(404)")
            }
        }
    }

    func test_checkHTTP_nonHTTPResponse_doesNotThrow() throws {
        // URLResponse (non-HTTP) — checkHTTP should be a no-op.
        let url = URL(string: "file:///tmp/test")!
        let response = URLResponse(url: url, mimeType: nil, expectedContentLength: 0, textEncodingName: nil)
        XCTAssertNoThrow(try handler.checkHTTP_test(response, Data()))
    }

    // MARK: - jsonObject helper

    func test_jsonObject_validDict_returnsDict() throws {
        let data = Data(#"{"key":"value"}"#.utf8)
        let obj = try handler.jsonObject_test(data)
        XCTAssertEqual(obj["key"] as? String, "value")
    }

    func test_jsonObject_invalidJSON_throwsError() {
        // JSONSerialization throws its own NSError for malformed input before our
        // guard runs, so we only assert that *some* error is thrown — not the type.
        let data = Data("not json".utf8)
        XCTAssertThrowsError(try handler.jsonObject_test(data))
    }

    func test_jsonObject_jsonArray_throwsInvalidResponse() {
        // Top-level JSON array should be rejected — the API always returns dicts.
        let data = Data("[1,2,3]".utf8)
        XCTAssertThrowsError(try handler.jsonObject_test(data)) { error in
            XCTAssertEqual(error as? TaskError, TaskError.invalidResponse)
        }
    }

    // MARK: - Error description strings

    func test_taskError_missingField_includesFieldName() {
        let err: Error = TaskError.missingField("listId")
        XCTAssertTrue(err.localizedDescription.contains("listId"))
    }

    func test_taskError_httpError_includesStatusCode() {
        let err: Error = TaskError.httpError(403, "Forbidden")
        XCTAssertTrue(err.localizedDescription.contains("403"))
    }

    func test_taskError_invalidResponse_nonEmpty() {
        let err: Error = TaskError.invalidResponse
        XCTAssertFalse(err.localizedDescription.isEmpty)
    }
}

// Make TaskError Equatable so XCTAssertEqual can compare cases in tests.
extension TaskError: Equatable {
    public static func == (lhs: TaskError, rhs: TaskError) -> Bool {
        switch (lhs, rhs) {
        case (.invalidResponse, .invalidResponse): return true
        case (.missingField(let a), .missingField(let b)): return a == b
        case (.httpError(let c1, let b1), .httpError(let c2, let b2)): return c1 == c2 && b1 == b2
        default: return false
        }
    }
}
