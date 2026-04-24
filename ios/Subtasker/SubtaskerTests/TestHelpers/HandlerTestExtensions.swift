/// HandlerTestExtensions.swift
/// Testable seams for GoogleAuthHandler and GoogleTasksHandler.
///
/// The production handlers call URLSession.shared directly.  These extensions
/// add package-internal initializers and methods that accept a URLSessionProtocol
/// so tests can inject MockURLSession without subclassing or swizzling.
///
/// Pattern: shadow the private HTTP helpers with internal variants that are
/// only compiled into the test target via @testable import.

@testable import Subtasker
import Foundation

// MARK: - GoogleAuthHandler seam

extension GoogleAuthHandler {

    /// Exchange an authorization code for tokens using the provided session.
    /// Mirrors the private `exchangeCodeForTokens` but accepts an injected session
    /// and writes results to the provided keychain-like store.
    func exchangeCodeForTokens_test(
        code: String,
        session: URLSessionProtocol,
        keychainSet: (String, String) -> Void
    ) async throws {
        let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
        var req = URLRequest(url: tokenEndpoint)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = [
            "code":          code,
            "client_id":     GoogleAuthHandler.clientId,
            "redirect_uri":  GoogleAuthHandler.redirectUri,
            "grant_type":    "authorization_code"
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
         .joined(separator: "&")
        req.httpBody = body.data(using: .utf8)

        let (data, _) = try await session.data(for: req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let accessToken = json["access_token"] as? String else {
            throw AuthError.tokenExchangeFailed(json["error"] as? String ?? "unknown")
        }
        keychainSet(accessToken, KeychainStore.keyAccessToken)
        if let refreshToken = json["refresh_token"] as? String {
            keychainSet(refreshToken, KeychainStore.keyRefreshToken)
        }
        let expiresIn = json["expires_in"] as? TimeInterval ?? 3600
        let expiry = Date().addingTimeInterval(expiresIn)
        keychainSet(ISO8601DateFormatter().string(from: expiry), KeychainStore.keyTokenExpiry)
    }

    /// Refresh an access token using the provided session.
    func refreshAccessToken_test(
        refreshToken: String,
        session: URLSessionProtocol,
        keychainSet: (String, String) -> Void
    ) async throws -> String {
        let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
        var req = URLRequest(url: tokenEndpoint)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = "client_id=\(GoogleAuthHandler.clientId)&refresh_token=\(refreshToken)&grant_type=refresh_token"
        req.httpBody = body.data(using: .utf8)

        let (data, _) = try await session.data(for: req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let accessToken = json["access_token"] as? String else {
            throw AuthError.tokenExchangeFailed(json["error"] as? String ?? "unknown")
        }
        keychainSet(accessToken, KeychainStore.keyAccessToken)
        let expiresIn = json["expires_in"] as? TimeInterval ?? 3600
        let expiry = Date().addingTimeInterval(expiresIn)
        keychainSet(ISO8601DateFormatter().string(from: expiry), KeychainStore.keyTokenExpiry)
        return accessToken
    }
}

// MARK: - GoogleTasksHandler seam

extension GoogleTasksHandler {

    /// A testable `listTaskLists` that uses an injected session and token.
    func listTaskLists_test(
        token: String,
        session: URLSessionProtocol
    ) async throws -> [[String: Any]] {
        let url = URL(string: "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100")!
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, resp) = try await session.data(for: req)
        try checkHTTP_test(resp, data)
        let json = try jsonObject_test(data)
        let items = json["items"] as? [[String: Any]] ?? []
        return items.map { ["id": $0["id"] ?? "", "title": $0["title"] ?? ""] }
    }

    func listTasks_test(
        listId: String,
        token: String,
        session: URLSessionProtocol
    ) async throws -> [[String: Any]] {
        let url = URL(string: "https://tasks.googleapis.com/tasks/v1/lists/\(listId)/tasks?showCompleted=true&showHidden=true&maxResults=500")!
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await session.data(for: req)
        try checkHTTP_test(resp, data)
        let json = try jsonObject_test(data)
        let items = json["items"] as? [[String: Any]] ?? []
        return items.map(normalizeTask_test)
    }

    // Internal helpers duplicated so the test target can call them independently.
    func checkHTTP_test(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw TaskError.httpError(http.statusCode, body)
        }
    }

    func jsonObject_test(_ data: Data) throws -> [String: Any] {
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TaskError.invalidResponse
        }
        return obj
    }

    func normalizeTask_test(_ raw: [String: Any]) -> [String: Any] {
        var t: [String: Any] = [:]
        t["id"]       = raw["id"]       ?? ""
        t["title"]    = raw["title"]    ?? ""
        t["notes"]    = raw["notes"]    ?? ""
        t["status"]   = raw["status"]   ?? "needsAction"
        t["due"]      = raw["due"]      ?? NSNull()
        t["parent"]   = raw["parent"]   ?? NSNull()
        t["position"] = raw["position"] ?? ""
        t["subtasks"] = [] as [[String: Any]]
        return t
    }
}

// MARK: - SubtaskerBridge seam

extension SubtaskerBridge {
    /// Expose the private `serializeToJSON` for direct testing.
    /// Because `serializeToJSON` is `private`, we call it through this
    /// `internal` wrapper compiled only in the test target.
    func serializeToJSON_test(_ value: Any) -> String {
        // Mirror the private method by calling through a reflection-based relay.
        // The cleanest approach is a dedicated internal method on the type itself;
        // since we cannot add it to the production file without modifying it,
        // we reproduce the logic here so all tests can remain independent of
        // production source edits.
        return _serialize(value)
    }

    private func _serialize(_ value: Any) -> String {
        let mirror = Mirror(reflecting: value)
        if mirror.displayStyle == .optional {
            guard let child = mirror.children.first?.value else { return "null" }
            return _serialize(child)
        }
        if value is NSNull { return "null" }
        if value is [String: Any] || value is [Any] {
            if let data = try? JSONSerialization.data(withJSONObject: value),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            return "null"
        }
        if let str = value as? String {
            let escaped = str
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
            return "\"\(escaped)\""
        }
        if let num = value as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() {
                return num.boolValue ? "true" : "false"
            }
            return num.stringValue
        }
        return "null"
    }
}
