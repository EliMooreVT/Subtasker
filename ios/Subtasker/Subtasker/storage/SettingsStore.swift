import Foundation

/// UserDefaults wrapper for non-secret settings.
/// Mirrors the non-sensitive fields in packages/core/store.js.
enum SettingsStore {

    private static let defaults = UserDefaults.standard

    // MARK: - OpenAI context (user-visible system prompt)

    static var openAiContext: String {
        get { defaults.string(forKey: "openai_context") ?? "" }
        set { defaults.set(newValue, forKey: "openai_context") }
    }

    // MARK: - Error log path

    static var errorLogPath: String {
        let dir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("Subtasker", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("subtasker-error.log").path
    }

    // MARK: - Log helper

    static func logError(_ context: String, _ error: Error) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(context): \(error.localizedDescription)\n"
        let path = errorLogPath
        if let data = line.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: path) {
                if let fh = FileHandle(forWritingAtPath: path) {
                    fh.seekToEndOfFile()
                    fh.write(data)
                    fh.closeFile()
                }
            } else {
                try? data.write(to: URL(fileURLWithPath: path))
            }
        }
    }
}
