import Foundation

/// Handles ai_plan* and app_getGuidingQuestions bridge actions.
/// Mirrors packages/core/openaiClient.js — same prompts, same JSON shapes.
class OpenAIHandler {

    private let endpoint = URL(string: "https://api.openai.com/v1/chat/completions")!
    private let model = "gpt-4o"

    // MARK: - Bridge actions

    func planExpand(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let task = payload["task"] as? [String: Any] else { throw AIError.missingField("task") }
        guard let options = payload["options"] as? [String: Any] else { throw AIError.missingField("options") }

        let taskTitle    = task["title"]   as? String ?? ""
        let taskNotes    = task["notes"]   as? String ?? ""
        let userContext  = task["context"] as? String ?? ""
        let context      = SettingsStore.openAiContext

        let prompt = buildExpandPrompt(
            taskTitle: taskTitle,
            taskNotes: taskNotes,
            guidingAnswers: "\(context)\n\(userContext)",
            options: options
        )
        let raw = try await chatCompletion(systemPrompt: "You output only JSON that matches the requested format.", userPrompt: prompt, maxTokens: 600)
        return try extractSubtasks(from: raw)
    }

    func planRefine(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let task    = payload["task"]     as? [String: Any] else { throw AIError.missingField("task") }
        guard let feedback = payload["feedback"] as? String        else { throw AIError.missingField("feedback") }
        guard let options  = payload["options"]  as? [String: Any] else { throw AIError.missingField("options") }

        let taskTitle      = task["title"]    as? String         ?? ""
        let currentSubtasks = task["subtasks"] as? [[String: Any]] ?? []
        let context        = SettingsStore.openAiContext

        let prompt = buildRefinePrompt(
            taskTitle: taskTitle,
            currentSubtasks: currentSubtasks,
            feedback: "\(context)\n\(feedback)",
            options: options
        )
        let raw = try await chatCompletion(systemPrompt: "You output only JSON that matches the requested format.", userPrompt: prompt, maxTokens: 600)
        return try extractSubtasks(from: raw)
    }

    func planSplit(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let task         = payload["task"]         as? [String: Any] else { throw AIError.missingField("task") }
        guard let instructions = payload["instructions"] as? String        else { throw AIError.missingField("instructions") }
        guard let options      = payload["options"]      as? [String: Any] else { throw AIError.missingField("options") }

        let taskTitle       = task["title"]    as? String          ?? ""
        let currentSubtasks = task["subtasks"] as? [[String: Any]] ?? []
        let context         = SettingsStore.openAiContext

        let prompt = buildSplitPrompt(
            taskTitle: taskTitle,
            currentSubtasks: currentSubtasks,
            instructions: "\(context)\n\(instructions)",
            options: options
        )
        let raw = try await chatCompletion(systemPrompt: "You output only JSON that matches the requested format.", userPrompt: prompt, maxTokens: 600)
        return try extractSubtasks(from: raw)
    }

    func getGuidingQuestions(_ payload: [String: Any]) async throws -> [String] {
        guard let taskTitle = payload["taskTitle"] as? String else { throw AIError.missingField("taskTitle") }
        let prompt = buildQuestionPrompt(taskTitle: taskTitle)
        let raw = try await chatCompletion(systemPrompt: "You return JSON only.", userPrompt: prompt, maxTokens: 200)
        return try extractQuestions(from: raw)
    }

    // MARK: - Prompt builders (verbatim from openaiClient.js)

    private func buildExpandPrompt(taskTitle: String, taskNotes: String, guidingAnswers: String, options: [String: Any]) -> String {
        let length = options["length"] as? String ?? "short"
        let style  = options["style"]  as? String ?? "direct"
        let lengthLine = length == "long"
            ? "Return roughly 10 subtasks so the user can plan a longer sequence. "
            : "Return roughly 5 subtasks to keep the plan short. "
        let styleLine = style == "comprehensive"
            ? "Steps should include context or review checkpoints when helpful."
            : "Keep every step direct and action-oriented without extra commentary."

        return "\(lengthLine)\(styleLine) Respond with JSON shaped as { \"parentTitle\": string, \"subtasks\": [ { \"title\": string, \"notes\": string } ... ] }. " +
            "Only update parentTitle if you can make it clearer; otherwise keep the original. " +
            "Each subtask must take 2-8 minutes, include a \"done when\" statement in notes, avoid vague verbs, and stay practical. " +
            "If information is missing, begin with a confirm/check step under three minutes.\n" +
            "Parent task: \(taskTitle).\n" +
            "Task notes: \(taskNotes.isEmpty ? "None provided." : taskNotes)\n" +
            "User context: \(guidingAnswers.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No extra context." : guidingAnswers)"
    }

    private func buildRefinePrompt(taskTitle: String, currentSubtasks: [[String: Any]], feedback: String, options: [String: Any]) -> String {
        let length = options["length"] as? String ?? "short"
        let style  = options["style"]  as? String ?? "direct"
        let subtasksText = currentSubtasks.enumerated()
            .map { "\($0.offset + 1). \($0.element["title"] ?? "") (notes: \($0.element["notes"] ?? "n/a"))" }
            .joined(separator: "\n")
        let lengthLine = length == "long"
            ? "Aim for up to 10 focused subtasks after refinement. "
            : "Aim for about 5 focused subtasks after refinement. "
        let styleLine = style == "comprehensive"
            ? "Feel free to layer in quick reviews or double-checks when it helps."
            : "Keep every step direct and to-the-point."

        return "\(lengthLine)\(styleLine) Refine the provided subtasks according to the feedback while keeping the plan concise and minimally changed. " +
            "Every subtask must retain a \"done when\" statement and remain within the 2-8 minute window. " +
            "Respond with JSON shaped as { \"parentTitle\": string, \"subtasks\": [ { \"title\": string, \"notes\": string } ... ] }. " +
            "Only adjust parentTitle if it improves clarity for the revised plan.\n" +
            "Parent task: \(taskTitle).\nCurrent subtasks:\n\(subtasksText.isEmpty ? "None provided." : subtasksText)\nFeedback: \(feedback)."
    }

    private func buildSplitPrompt(taskTitle: String, currentSubtasks: [[String: Any]], instructions: String, options: [String: Any]) -> String {
        let length = options["length"] as? String ?? "short"
        let style  = options["style"]  as? String ?? "direct"
        let subtasksText = currentSubtasks.enumerated()
            .map { "\($0.offset + 1). \($0.element["title"] ?? "") (notes: \($0.element["notes"] ?? "n/a"))" }
            .joined(separator: "\n")
        let lengthLine = length == "long"
            ? "Split the tasks so the final list has around 10 micro-steps."
            : "Split the tasks so the final list has around 5 micro-steps."
        let styleLine = style == "comprehensive"
            ? "It is okay to add quick review/check-in steps where helpful."
            : "Keep every new step crisp and action-oriented."

        return "\(lengthLine) \(styleLine) Respond with JSON shaped as { \"parentTitle\": string, \"subtasks\": [ { \"title\": string, \"notes\": string } ... ] }. " +
            "Each resulting step should take 2-5 minutes and include a \"done when\" note. " +
            "Split or extend the provided subtasks rather than inventing unrelated work." +
            "\nParent task: \(taskTitle)." +
            "\nExisting subtasks:\n\(subtasksText.isEmpty ? "None provided." : subtasksText)" +
            "\nAdditional guidance: \(instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "None" : instructions)."
    }

    private func buildQuestionPrompt(taskTitle: String) -> String {
        let context = SettingsStore.openAiContext
        let contextSnippet = context.isEmpty ? "" : "Use this background context: \(context). "
        return "\(contextSnippet)You are assisting a user in preparing to break down a task. " +
            "Generate three short guiding questions that will help gather context before expanding the task into subtasks. " +
            "Provide output as JSON: { \"questions\": [string, string, string] }. Each question should be concise, actionable, and focused on details that clarify the task \"\(taskTitle)\"."
    }

    // MARK: - HTTP

    private func chatCompletion(systemPrompt: String, userPrompt: String, maxTokens: Int) async throws -> String {
        guard let apiKey = KeychainStore.get(KeychainStore.keyOpenAiKey), !apiKey.isEmpty else {
            throw AIError.noApiKey
        }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": systemPrompt],
                ["role": "user",   "content": userPrompt]
            ],
            "response_format": ["type": "json_object"],
            "max_tokens": maxTokens
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw AIError.httpError(http.statusCode, msg)
        }

        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let choices = json["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String else {
            throw AIError.emptyResponse
        }
        return content
    }

    // MARK: - Response parsing

    private func extractSubtasks(from raw: String) throws -> [String: Any] {
        let json = try parseJSON(raw)
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

    private func extractQuestions(from raw: String) throws -> [String] {
        let json = try parseJSON(raw)
        guard let questions = json["questions"] as? [String], !questions.isEmpty else {
            throw AIError.missingQuestions
        }
        return Array(questions.prefix(3))
    }

    private func parseJSON(_ raw: String) throws -> [String: Any] {
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
}

enum AIError: LocalizedError {
    case noApiKey
    case httpError(Int, String)
    case emptyResponse
    case missingSubtasks
    case missingQuestions
    case missingField(String)
    case parseError(String)

    var errorDescription: String? {
        switch self {
        case .noApiKey:            return "Add an OpenAI API key to use AI features."
        case .httpError(let c, let b): return "OpenAI HTTP \(c): \(b)"
        case .emptyResponse:       return "Empty response from AI"
        case .missingSubtasks:     return "AI response did not contain any subtasks"
        case .missingQuestions:    return "AI response did not contain questions"
        case .missingField(let f): return "Missing required field: \(f)"
        case .parseError(let s):   return "Failed to parse AI response: \(s)"
        }
    }
}
