import Foundation

/// Handles app_* diagnostic bridge actions.
class AppHandler {

    func getClientSecretPath() async throws -> String? {
        // On iOS there is no client_secret.json file — return nil as Electron does when not loaded
        return nil
    }

    func getErrorLogPath() async throws -> String {
        return SettingsStore.errorLogPath
    }
}
