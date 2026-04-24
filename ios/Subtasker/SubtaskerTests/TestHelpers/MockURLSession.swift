/// MockURLSession.swift
/// Protocol-based URLSession stub.  Handlers inject a MockURLSession via a
/// `session` parameter added to their HTTP helpers in the testable extension
/// layer (see HandlerTestExtensions.swift).
///
/// Each registered stub is consumed once (FIFO) so multi-step flows can be
/// tested with a sequence of canned responses.

import Foundation

// MARK: - Protocol

protocol URLSessionProtocol {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: URLSessionProtocol {}

// MARK: - Stub response

struct StubResponse {
    let data: Data
    let statusCode: Int

    static func json(_ dict: [String: Any], status: Int = 200) -> StubResponse {
        let data = try! JSONSerialization.data(withJSONObject: dict)
        return StubResponse(data: data, statusCode: status)
    }

    static func string(_ body: String, status: Int = 200) -> StubResponse {
        return StubResponse(data: Data(body.utf8), statusCode: status)
    }

    static func empty(status: Int = 204) -> StubResponse {
        return StubResponse(data: Data(), statusCode: status)
    }
}

// MARK: - Mock session

final class MockURLSession: URLSessionProtocol {

    // Responses dequeued in FIFO order.  Add via `enqueue(_:)`.
    private var queue: [Result<StubResponse, Error>] = []

    // All requests received, in order — inspect in assertions.
    private(set) var requests: [URLRequest] = []

    func enqueue(_ response: StubResponse) {
        queue.append(.success(response))
    }

    func enqueueError(_ error: Error) {
        queue.append(.failure(error))
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        guard !queue.isEmpty else {
            fatalError("MockURLSession: no stub response queued for \(request.url?.absoluteString ?? "?")")
        }
        let next = queue.removeFirst()
        switch next {
        case .success(let stub):
            let url = request.url ?? URL(string: "https://mock")!
            let response = HTTPURLResponse(
                url: url,
                statusCode: stub.statusCode,
                httpVersion: nil,
                headerFields: nil
            )!
            return (stub.data, response)
        case .failure(let error):
            throw error
        }
    }
}
