import Foundation

/// Handles settings_* bridge actions.
/// Mirrors the settings:* IPC handlers in electron/main.js.
class SettingsHandler {

    func load() async throws -> [String: Any] {
        let hasClientSecret = true  // iOS always has the bundled client ID
        let openAiKey = KeychainStore.get(KeychainStore.keyOpenAiKey) ?? ""
        return [
            "hasClientSecret": hasClientSecret,
            "openAiKey": openAiKey
        ]
    }

    func setOpenAiKey(_ payload: [String: Any]) async throws -> [String: Any] {
        let key = payload["key"] as? String ?? ""
        if key.isEmpty {
            KeychainStore.delete(KeychainStore.keyOpenAiKey)
        } else {
            KeychainStore.set(key, forKey: KeychainStore.keyOpenAiKey)
        }
        return ["success": true]
    }

    func getOpenAiContext() async throws -> String {
        return SettingsStore.openAiContext
    }

    func setOpenAiContext(_ payload: [String: Any]) async throws -> [String: Any] {
        let context = payload["context"] as? String ?? ""
        SettingsStore.openAiContext = context
        return ["success": true]
    }
}
