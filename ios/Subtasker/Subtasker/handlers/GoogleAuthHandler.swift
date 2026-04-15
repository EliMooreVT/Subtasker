import Foundation
import AuthenticationServices

/// Handles google_signIn / google_signOut / google_loadClientSecret.
/// Uses ASWebAuthenticationSession for the OAuth flow (no Google SDK needed).
class GoogleAuthHandler: NSObject {

    // iOS OAuth client registered in Google Cloud Console
    static let clientId = "514536573811-ktgpuer9uneuo32jgib1l84h2m5kbtfu.apps.googleusercontent.com"
    static let redirectScheme = "com.googleusercontent.apps.514536573811-ktgpuer9uneuo32jgib1l84h2m5kbtfu"
    static let redirectUri = "\(redirectScheme):/oauth2redirect/google"

    private let scopes = "https://www.googleapis.com/auth/tasks"
    private let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
    private let revokeEndpoint = URL(string: "https://oauth2.googleapis.com/revoke")!

    // MARK: - Bridge actions

    func loadClientSecret() async throws -> [String: Any] {
        // On iOS there is no client_secret.json file — we expose the iOS client ID directly.
        return [
            "clientId": Self.clientId,
            "redirectUris": [Self.redirectUri],
            "filePath": "bundled"
        ]
    }

    func signIn(presentingViewController vc: UIViewController) async throws -> [String: Any] {
        let code = try await performAuthFlow(presentingViewController: vc)
        try await exchangeCodeForTokens(code: code)
        return ["success": true]
    }

    func signOut() async throws -> [String: Any] {
        if let token = KeychainStore.get(KeychainStore.keyAccessToken) {
            // Best-effort revoke — ignore network errors
            var req = URLRequest(url: revokeEndpoint)
            req.httpMethod = "POST"
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            req.httpBody = "token=\(token)".data(using: .utf8)
            try? await URLSession.shared.data(for: req)
        }
        KeychainStore.delete(KeychainStore.keyAccessToken)
        KeychainStore.delete(KeychainStore.keyRefreshToken)
        KeychainStore.delete(KeychainStore.keyTokenExpiry)
        return ["success": true]
    }

    // MARK: - Token access (used by task/AI handlers)

    /// Returns a valid access token, refreshing if needed.
    func validAccessToken() async throws -> String {
        if let token = KeychainStore.get(KeychainStore.keyAccessToken),
           let expiryStr = KeychainStore.get(KeychainStore.keyTokenExpiry),
           let expiry = ISO8601DateFormatter().date(from: expiryStr),
           expiry.timeIntervalSinceNow > 60 {
            return token
        }
        // Need to refresh
        guard let refreshToken = KeychainStore.get(KeychainStore.keyRefreshToken) else {
            throw AuthError.notSignedIn
        }
        return try await refreshAccessToken(refreshToken: refreshToken)
    }

    // MARK: - Private helpers

    @MainActor
    private func performAuthFlow(presentingViewController vc: UIViewController) async throws -> String {
        let state = UUID().uuidString
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id",     value: Self.clientId),
            URLQueryItem(name: "redirect_uri",  value: Self.redirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope",         value: scopes),
            URLQueryItem(name: "state",         value: state),
            URLQueryItem(name: "access_type",   value: "offline"),
            URLQueryItem(name: "prompt",        value: "consent")
        ]
        let authURL = components.url!

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: Self.redirectScheme
            ) { callbackURL, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let callbackURL = callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      let code = components.queryItems?.first(where: { $0.name == "code" })?.value
                else {
                    continuation.resume(throwing: AuthError.noCodeInCallback)
                    return
                }
                continuation.resume(returning: code)
            }
            session.presentationContextProvider = vc as? ASWebAuthenticationPresentationContextProviding
                ?? DefaultPresentationContext(vc: vc)
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }
    }

    private func exchangeCodeForTokens(code: String) async throws {
        var req = URLRequest(url: tokenEndpoint)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = [
            "code":          code,
            "client_id":     Self.clientId,
            "redirect_uri":  Self.redirectUri,
            "grant_type":    "authorization_code"
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
         .joined(separator: "&")
        req.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let accessToken = json["access_token"] as? String else {
            throw AuthError.tokenExchangeFailed(json["error"] as? String ?? "unknown")
        }
        KeychainStore.set(accessToken, forKey: KeychainStore.keyAccessToken)
        if let refreshToken = json["refresh_token"] as? String {
            KeychainStore.set(refreshToken, forKey: KeychainStore.keyRefreshToken)
        }
        let expiresIn = json["expires_in"] as? TimeInterval ?? 3600
        let expiry = Date().addingTimeInterval(expiresIn)
        KeychainStore.set(ISO8601DateFormatter().string(from: expiry), forKey: KeychainStore.keyTokenExpiry)
    }

    private func refreshAccessToken(refreshToken: String) async throws -> String {
        var req = URLRequest(url: tokenEndpoint)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = "client_id=\(Self.clientId)&refresh_token=\(refreshToken)&grant_type=refresh_token"
        req.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let accessToken = json["access_token"] as? String else {
            throw AuthError.tokenExchangeFailed(json["error"] as? String ?? "unknown")
        }
        KeychainStore.set(accessToken, forKey: KeychainStore.keyAccessToken)
        let expiresIn = json["expires_in"] as? TimeInterval ?? 3600
        let expiry = Date().addingTimeInterval(expiresIn)
        KeychainStore.set(ISO8601DateFormatter().string(from: expiry), forKey: KeychainStore.keyTokenExpiry)
        return accessToken
    }
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case notSignedIn
    case noCodeInCallback
    case tokenExchangeFailed(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn:              return "Not signed in — please sign in first"
        case .noCodeInCallback:         return "OAuth callback did not contain an auth code"
        case .tokenExchangeFailed(let e): return "Token exchange failed: \(e)"
        }
    }
}

// MARK: - Presentation context helper

private class DefaultPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    let vc: UIViewController
    init(vc: UIViewController) { self.vc = vc }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = vc.view.window { return window }
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return keyWindow ?? ASPresentationAnchor()
    }
}
