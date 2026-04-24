/// SerializationTests.swift
/// Tests for SubtaskerBridge.serializeToJSON — the pure serialization logic
/// that converts Swift values to JSON strings for the JS bridge callbacks.
///
/// Access: via the `serializeToJSON_test` wrapper in HandlerTestExtensions.swift
/// (mirrors the private implementation identically so no production source edits
/// are required to gain test coverage).

import XCTest
@testable import Subtasker

final class SerializationTests: XCTestCase {

    private var bridge: SubtaskerBridge!

    override func setUp() {
        super.setUp()
        bridge = SubtaskerBridge()
    }

    override func tearDown() {
        bridge = nil
        super.tearDown()
    }

    // MARK: - Primitive types

    func test_serialize_string_producesQuotedValue() {
        let result = bridge.serializeToJSON_test("hello")
        XCTAssertEqual(result, "\"hello\"")
    }

    func test_serialize_emptyString_producesEmptyQuotedValue() {
        let result = bridge.serializeToJSON_test("")
        XCTAssertEqual(result, "\"\"")
    }

    func test_serialize_boolTrue_producesLiteralTrue() {
        let result = bridge.serializeToJSON_test(NSNumber(value: true))
        XCTAssertEqual(result, "true")
    }

    func test_serialize_boolFalse_producesLiteralFalse() {
        let result = bridge.serializeToJSON_test(NSNumber(value: false))
        XCTAssertEqual(result, "false")
    }

    func test_serialize_integer_producesNumericString() {
        let result = bridge.serializeToJSON_test(NSNumber(value: 42))
        XCTAssertEqual(result, "42")
    }

    func test_serialize_negativeInteger_producesNegativeNumericString() {
        let result = bridge.serializeToJSON_test(NSNumber(value: -7))
        XCTAssertEqual(result, "-7")
    }

    func test_serialize_double_producesDecimalString() {
        let result = bridge.serializeToJSON_test(NSNumber(value: 3.14))
        // NSNumber.stringValue for 3.14 — just check it starts with "3."
        XCTAssertTrue(result.hasPrefix("3."), "Expected decimal representation, got: \(result)")
    }

    func test_serialize_zero_producesZeroString() {
        let result = bridge.serializeToJSON_test(NSNumber(value: 0))
        XCTAssertEqual(result, "0")
    }

    // MARK: - NSNull and nil/Optional

    func test_serialize_NSNull_producesNull() {
        let result = bridge.serializeToJSON_test(NSNull())
        XCTAssertEqual(result, "null")
    }

    func test_serialize_noneOptional_producesNull() {
        let opt: String? = nil
        let result = bridge.serializeToJSON_test(opt as Any)
        XCTAssertEqual(result, "null")
    }

    func test_serialize_someOptional_unwrapsAndSerializesInner() {
        let opt: String? = "wrapped"
        let result = bridge.serializeToJSON_test(opt as Any)
        XCTAssertEqual(result, "\"wrapped\"")
    }

    func test_serialize_nestedOptionalNone_producesNull() {
        let opt: Int? = nil
        let result = bridge.serializeToJSON_test(opt as Any)
        XCTAssertEqual(result, "null")
    }

    // MARK: - String escaping

    func test_serialize_stringWithDoubleQuote_escapesQuote() {
        let result = bridge.serializeToJSON_test("say \"hello\"")
        XCTAssertEqual(result, "\"say \\\"hello\\\"\"")
    }

    func test_serialize_stringWithNewline_escapesNewline() {
        let result = bridge.serializeToJSON_test("line1\nline2")
        XCTAssertEqual(result, "\"line1\\nline2\"")
    }

    func test_serialize_stringWithCarriageReturn_escapesCarriageReturn() {
        let result = bridge.serializeToJSON_test("line1\rline2")
        XCTAssertEqual(result, "\"line1\\rline2\"")
    }

    func test_serialize_stringWithTab_escapesTab() {
        let result = bridge.serializeToJSON_test("col1\tcol2")
        XCTAssertEqual(result, "\"col1\\tcol2\"")
    }

    func test_serialize_stringWithBackslash_escapesBackslash() {
        let result = bridge.serializeToJSON_test("path\\to\\file")
        XCTAssertEqual(result, "\"path\\\\to\\\\file\"")
    }

    func test_serialize_stringWithAllEscapables_escapesAll() {
        let input = "\\\"\n\r\t"
        let result = bridge.serializeToJSON_test(input)
        XCTAssertEqual(result, "\"\\\\\\\"\\n\\r\\t\"")
    }

    // MARK: - Dictionary

    func test_serialize_emptyDict_producesEmptyJsonObject() {
        let result = bridge.serializeToJSON_test([String: Any]())
        XCTAssertEqual(result, "{}")
    }

    func test_serialize_flatDict_producesValidJSON() throws {
        let dict: [String: Any] = ["id": "123", "title": "Buy milk"]
        let result = bridge.serializeToJSON_test(dict)
        // Verify it round-trips — key order is not guaranteed in JSON
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(parsed["id"] as? String, "123")
        XCTAssertEqual(parsed["title"] as? String, "Buy milk")
    }

    func test_serialize_dictWithBoolValue_roundTrips() throws {
        let dict: [String: Any] = ["success": true]
        let result = bridge.serializeToJSON_test(dict)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(parsed["success"] as? Bool, true)
    }

    func test_serialize_nestedDict_roundTrips() throws {
        let dict: [String: Any] = [
            "outer": ["inner": "value"] as [String: Any]
        ]
        let result = bridge.serializeToJSON_test(dict)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let inner = parsed["outer"] as? [String: Any]
        XCTAssertEqual(inner?["inner"] as? String, "value")
    }

    func test_serialize_dictWithNSNull_roundTrips() throws {
        let dict: [String: Any] = ["due": NSNull()]
        let result = bridge.serializeToJSON_test(dict)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        // NSNull round-trips to NSNull after JSONSerialization
        XCTAssertTrue(parsed["due"] is NSNull)
    }

    // MARK: - Array

    func test_serialize_emptyArray_producesEmptyJsonArray() {
        let result = bridge.serializeToJSON_test([Any]())
        XCTAssertEqual(result, "[]")
    }

    func test_serialize_arrayOfStrings_roundTrips() throws {
        let arr: [Any] = ["alpha", "beta", "gamma"]
        let result = bridge.serializeToJSON_test(arr)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String]
        XCTAssertEqual(parsed, ["alpha", "beta", "gamma"])
    }

    func test_serialize_arrayOfDicts_roundTrips() throws {
        let arr: [Any] = [
            ["id": "t1", "title": "Task one"] as [String: Any],
            ["id": "t2", "title": "Task two"] as [String: Any]
        ]
        let result = bridge.serializeToJSON_test(arr)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        XCTAssertEqual(parsed.count, 2)
        XCTAssertEqual(parsed[0]["id"] as? String, "t1")
        XCTAssertEqual(parsed[1]["title"] as? String, "Task two")
    }

    // MARK: - Bool vs NSNumber ambiguity

    /// Swift `true` passed as `Any` must NOT serialize as "1".
    func test_serialize_swiftBoolTrue_distinguishedFromInt() {
        // When Swift Bool is passed as Any, it bridges to NSNumber with CFBoolean type.
        let value: Any = true
        let result = bridge.serializeToJSON_test(value)
        XCTAssertEqual(result, "true", "Swift Bool true must serialize as JSON boolean, not integer 1")
    }

    func test_serialize_swiftBoolFalse_distinguishedFromInt() {
        let value: Any = false
        let result = bridge.serializeToJSON_test(value)
        XCTAssertEqual(result, "false", "Swift Bool false must serialize as JSON boolean, not integer 0")
    }

    func test_serialize_intOne_notConfusedWithBoolTrue() {
        let result = bridge.serializeToJSON_test(NSNumber(value: 1))
        // NSNumber(value: 1) has CFNumber type, not CFBoolean — must be "1"
        XCTAssertEqual(result, "1")
    }

    // MARK: - Real handler return shapes

    /// Verify the shape returned by SettingsHandler.load() serializes cleanly.
    func test_serialize_settingsLoadShape_roundTrips() throws {
        let shape: [String: Any] = [
            "hasClientSecret": true,
            "openAiKey": "sk-test-key"
        ]
        let result = bridge.serializeToJSON_test(shape)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(parsed["hasClientSecret"] as? Bool, true)
        XCTAssertEqual(parsed["openAiKey"] as? String, "sk-test-key")
    }

    /// Verify the shape returned by GoogleAuthHandler.signOut() serializes cleanly.
    func test_serialize_signOutShape_roundTrips() throws {
        let shape: [String: Any] = ["success": true]
        let result = bridge.serializeToJSON_test(shape)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(parsed["success"] as? Bool, true)
    }

    /// Verify task normalization output serializes cleanly (NSNull fields must survive).
    func test_serialize_normalizedTask_roundTrips() throws {
        let task: [String: Any] = [
            "id": "abc",
            "title": "Write tests",
            "notes": "",
            "status": "needsAction",
            "due": NSNull(),
            "parent": NSNull(),
            "position": "00000000001",
            "subtasks": [[String: Any]]()
        ]
        let result = bridge.serializeToJSON_test(task)
        let data = Data(result.utf8)
        let parsed = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(parsed["id"] as? String, "abc")
        XCTAssertTrue(parsed["due"] is NSNull)
        XCTAssertEqual((parsed["subtasks"] as? [Any])?.count, 0)
    }
}
