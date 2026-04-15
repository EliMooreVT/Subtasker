import Foundation
import WebKit

/// Routes messages from the JS bridge to the appropriate handler.
/// Mirrors the `registerHandle` pattern in electron/main.js.
class SubtaskerBridge: NSObject, WKScriptMessageHandler {

    weak var webView: WKWebView?

    private lazy var settings = SettingsHandler()
    private lazy var auth = GoogleAuthHandler()
    private lazy var tasks = GoogleTasksHandler(auth: auth)
    private lazy var openai = OpenAIHandler()
    private lazy var appHandler = AppHandler()

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            let body = message.body as? [String: Any],
            let callId = body["id"] as? String,
            let action = body["action"] as? String
        else { return }

        let payload = body["payload"] as? [String: Any] ?? [:]

        Task {
            do {
                let result = try await route(action: action, payload: payload)
                let jsonString = serializeToJSON(result)
                await resolve(id: callId, json: jsonString)
            } catch {
                await reject(id: callId, error: error)
            }
        }
    }

    // MARK: - Routing

    private func route(action: String, payload: [String: Any]) async throws -> Any {
        switch action {
        // Settings
        case "settings_load":           return try await settings.load()
        case "settings_setOpenAiKey":   return try await settings.setOpenAiKey(payload)
        case "settings_getOpenAiContext": return try await settings.getOpenAiContext()
        case "settings_setOpenAiContext": return try await settings.setOpenAiContext(payload)

        // Auth
        case "google_loadClientSecret": return try await auth.loadClientSecret()
        case "google_signIn":
            guard let wv = webView else { throw BridgeError.noWebView }
            return try await auth.signIn(presentingViewController: viewControllerForWebView(wv))
        case "google_signOut":          return try await auth.signOut()

        // Tasks
        case "google_listTaskLists":    return try await tasks.listTaskLists()
        case "google_listTasks":        return try await tasks.listTasks(payload)
        case "google_createTask":       return try await tasks.createTask(payload)
        case "google_updateTask":       return try await tasks.updateTask(payload)
        case "google_deleteTask":       return try await tasks.deleteTask(payload)
        case "google_applyChanges":     return try await tasks.applyChanges(payload)

        // AI
        case "ai_planExpand":           return try await openai.planExpand(payload)
        case "ai_planRefine":           return try await openai.planRefine(payload)
        case "ai_planSplit":            return try await openai.planSplit(payload)
        case "app_getGuidingQuestions": return try await openai.getGuidingQuestions(payload)

        // Diagnostics
        case "app_getClientSecretPath": return try await appHandler.getClientSecretPath()
        case "app_getErrorLogPath":     return try await appHandler.getErrorLogPath()

        default:
            throw BridgeError.unknownAction(action)
        }
    }

    // MARK: - JSON serialization

    /// Serializes any value that a bridge handler might return.
    /// JSONSerialization only accepts top-level dicts/arrays, so we handle
    /// String, Bool, Number, nil/Optional, and arrays/dicts explicitly.
    private func serializeToJSON(_ value: Any) -> String {
        // Unwrap Swift Optionals (they appear as Optional<T> inside Any)
        let mirror = Mirror(reflecting: value)
        if mirror.displayStyle == .optional {
            guard let child = mirror.children.first?.value else { return "null" }
            return serializeToJSON(child)
        }
        if value is NSNull { return "null" }
        // Dict or Array → JSONSerialization handles these
        if value is [String: Any] || value is [Any] {
            if let data = try? JSONSerialization.data(withJSONObject: value),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            return "null"
        }
        // String → JSON-encode manually (JSONSerialization won't write top-level primitives)
        if let str = value as? String {
            let escaped = str
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
            return "\"\(escaped)\""
        }
        // NSNumber — distinguish Bool (CFBoolean) from numeric types
        if let num = value as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() {
                return num.boolValue ? "true" : "false"
            }
            return num.stringValue
        }
        return "null"
    }

    // MARK: - Callback helpers

    @MainActor
    private func resolve(id: String, json: String) {
        let escaped = json.replacingOccurrences(of: "\\", with: "\\\\")
                         .replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.__nativeResolve('\(id)', '\(escaped)')")
    }

    @MainActor
    private func reject(id: String, error: Error) {
        let msg = error.localizedDescription
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.__nativeReject('\(id)', '\(msg)')")
    }

    private func viewControllerForWebView(_ wv: WKWebView) -> UIViewController {
        var responder: UIResponder? = wv
        while let r = responder {
            if let vc = r as? UIViewController { return vc }
            responder = r.next
        }
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return keyWindow?.rootViewController ?? UIViewController()
    }
}

enum BridgeError: LocalizedError {
    case unknownAction(String)
    case noWebView

    var errorDescription: String? {
        switch self {
        case .unknownAction(let a): return "Unknown bridge action: \(a)"
        case .noWebView: return "WebView is not available"
        }
    }
}
