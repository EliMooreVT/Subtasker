import Foundation

/// Handles all google_tasks* bridge actions via the Google Tasks REST API.
/// Mirrors googleTasks.js — no Google SDK, just URLSession.
class GoogleTasksHandler {

    private let auth: GoogleAuthHandler
    private let base = "https://tasks.googleapis.com/tasks/v1"

    init(auth: GoogleAuthHandler) {
        self.auth = auth
    }

    // MARK: - Bridge actions

    func listTaskLists() async throws -> [[String: Any]] {
        let data = try await get("/users/@me/lists?maxResults=100")
        let json = try jsonObject(data)
        let items = json["items"] as? [[String: Any]] ?? []
        return items.map { ["id": $0["id"] ?? "", "title": $0["title"] ?? ""] }
    }

    func listTasks(_ payload: [String: Any]) async throws -> [[String: Any]] {
        guard let listId = payload["listId"] as? String else { throw TaskError.missingField("listId") }
        let data = try await get("/lists/\(listId)/tasks?showCompleted=true&showHidden=true&maxResults=500")
        let json = try jsonObject(data)
        let items = json["items"] as? [[String: Any]] ?? []
        return items.map(normalizeTask)
    }

    func createTask(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let listId = (payload["listId"] as? String) else { throw TaskError.missingField("listId") }
        guard let taskPayload = payload["payload"] as? [String: Any] else { throw TaskError.missingField("payload") }

        var body: [String: Any] = ["title": taskPayload["title"] ?? ""]
        if let notes = taskPayload["notes"] as? String, !notes.isEmpty { body["notes"] = notes }
        if let due   = taskPayload["due"]   as? String, !due.isEmpty   { body["due"] = due }
        if let status = taskPayload["status"] as? String               { body["status"] = status }

        var path = "/lists/\(listId)/tasks"
        if let parentId = taskPayload["parentId"] as? String, !parentId.isEmpty {
            path += "?parent=\(parentId)"
        }

        let data = try await post(path, body: body)
        return normalizeTask(try jsonObject(data))
    }

    func updateTask(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let listId = payload["listId"] as? String else { throw TaskError.missingField("listId") }
        guard let taskId = payload["taskId"] as? String else { throw TaskError.missingField("taskId") }
        guard let updates = payload["payload"] as? [String: Any] else { throw TaskError.missingField("payload") }

        var body: [String: Any] = [:]
        if let title  = updates["title"]  as? String { body["title"]  = title }
        if let notes  = updates["notes"]  as? String { body["notes"]  = notes }
        if let due    = updates["due"]    as? String { body["due"]    = due }
        if let status = updates["status"] as? String { body["status"] = status }

        let data = try await patch("/lists/\(listId)/tasks/\(taskId)", body: body)
        return normalizeTask(try jsonObject(data))
    }

    func deleteTask(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let listId = payload["listId"] as? String else { throw TaskError.missingField("listId") }
        guard let taskId = payload["taskId"] as? String else { throw TaskError.missingField("taskId") }
        try await delete("/lists/\(listId)/tasks/\(taskId)")
        return ["success": true]
    }

    func applyChanges(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let listId = payload["listId"] as? String else { throw TaskError.missingField("listId") }
        guard let operations = payload["operations"] as? [[String: Any]] else { throw TaskError.missingField("operations") }

        var idMap: [String: String] = [:]

        for operation in operations {
            guard let kind = operation["kind"] as? String else { continue }
            switch kind {
            case "create":
                let tempId = operation["taskId"] as? String ?? ""
                var createPayload: [String: Any] = ["title": operation["title"] ?? ""]
                if let notes  = operation["notes"]  as? String { createPayload["notes"]  = notes }
                if let due    = operation["due"]    as? String { createPayload["due"]    = due }
                if let status = operation["status"] as? String { createPayload["status"] = status }
                if let parentId = operation["parentId"] as? String {
                    createPayload["parentId"] = idMap[parentId] ?? parentId
                }
                let created = try await createTask(["listId": listId, "payload": createPayload])
                if let newId = created["id"] as? String {
                    idMap[tempId] = newId
                }

            case "update":
                let rawId   = operation["taskId"] as? String ?? ""
                let actualId = idMap[rawId] ?? rawId
                let updates  = operation["updates"] as? [String: Any] ?? [:]
                _ = try await updateTask(["listId": listId, "taskId": actualId, "payload": updates])

            case "delete":
                let rawId    = operation["taskId"] as? String ?? ""
                let actualId = idMap[rawId] ?? rawId
                _ = try await deleteTask(["listId": listId, "taskId": actualId])

            default:
                break
            }
        }
        return ["success": true]
    }

    // MARK: - HTTP helpers

    private func authorizedRequest(method: String, path: String) async throws -> URLRequest {
        let token = try await auth.validAccessToken()
        var req = URLRequest(url: URL(string: "\(base)\(path)")!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return req
    }

    private func get(_ path: String) async throws -> Data {
        let req = try await authorizedRequest(method: "GET", path: path)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try checkHTTP(resp, data)
        return data
    }

    private func post(_ path: String, body: [String: Any]) async throws -> Data {
        var req = try await authorizedRequest(method: "POST", path: path)
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try checkHTTP(resp, data)
        return data
    }

    private func patch(_ path: String, body: [String: Any]) async throws -> Data {
        var req = try await authorizedRequest(method: "PATCH", path: path)
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try checkHTTP(resp, data)
        return data
    }

    private func delete(_ path: String) async throws {
        let req = try await authorizedRequest(method: "DELETE", path: path)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try checkHTTP(resp, data)
    }

    private func checkHTTP(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw TaskError.httpError(http.statusCode, body)
        }
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TaskError.invalidResponse
        }
        return obj
    }

    // MARK: - Normalization

    private func normalizeTask(_ raw: [String: Any]) -> [String: Any] {
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

enum TaskError: LocalizedError {
    case missingField(String)
    case httpError(Int, String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingField(let f):    return "Missing required field: \(f)"
        case .httpError(let c, let b): return "HTTP \(c): \(b)"
        case .invalidResponse:        return "Unexpected API response format"
        }
    }
}
