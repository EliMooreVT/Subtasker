import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!
    private var bridge: SubtaskerBridge!

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        loadApp()
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()

        // Capture JS console output so errors surface in Xcode console
        let consoleCapture = """
        (function() {
            function send(level, args) {
                var msg = Array.prototype.slice.call(args).map(function(a) {
                    try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                    catch(e) { return String(a); }
                }).join(' ');
                window.webkit.messageHandlers.console.postMessage({ level: level, msg: msg });
            }
            window.onerror = function(msg, src, line, col, err) {
                send('error', ['[onerror] ' + msg + ' (' + src + ':' + line + ')']);
            };
            window.onunhandledrejection = function(e) {
                send('error', ['[unhandledrejection] ' + (e.reason && e.reason.stack || e.reason)]);
            };
            ['log','warn','error','info'].forEach(function(m) {
                var orig = console[m];
                console[m] = function() { send(m, arguments); if(orig) orig.apply(console, arguments); };
            });
        })();
        """
        let consoleScript = WKUserScript(source: consoleCapture, injectionTime: .atDocumentStart, forMainFrameOnly: true)

        // Inject BridgeShim.js before the page document is parsed
        if let shimURL = Bundle.main.url(forResource: "BridgeShim", withExtension: "js"),
           let shimSource = try? String(contentsOf: shimURL, encoding: .utf8) {
            let userScript = WKUserScript(
                source: shimSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            config.userContentController.addUserScript(userScript)
        }

        config.userContentController.addUserScript(consoleScript)
        config.userContentController.add(self, name: "console")

        // Register the message handler — bridge holds a reference
        bridge = SubtaskerBridge()
        config.userContentController.add(bridge, name: "subtasker")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        bridge.webView = webView
    }

    private func loadApp() {
        guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dist") else {
            showLoadError("Could not find dist/index.html in app bundle.\nRun `npm run build` and add the dist/ folder to the Xcode target.")
            return
        }
        // Allow WebView to read sibling assets (JS, CSS) from dist/
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    private func showLoadError(_ message: String) {
        let html = """
        <html><body style="font-family:sans-serif;padding:40px;color:#c00">
        <h2>Build required</h2><pre>\(message)</pre>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - WKScriptMessageHandler (console capture)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "console",
              let body = message.body as? [String: Any],
              let level = body["level"] as? String,
              let msg = body["msg"] as? String else { return }
        print("[JS:\(level.uppercased())] \(msg)")
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Dump DOM state to help diagnose blank-screen issues
        webView.evaluateJavaScript("""
            JSON.stringify({
                rootHTML: document.getElementById('root')?.innerHTML?.slice(0, 500) || '(empty)',
                subtaskerDefined: typeof window.subtasker !== 'undefined',
                webkitBridge: typeof window.webkit?.messageHandlers?.subtasker !== 'undefined',
                bodyBg: document.body.style.backgroundColor,
                scriptCount: document.scripts.length,
                readyState: document.readyState
            })
        """) { result, error in
            if let json = result as? String {
                print("[DOM-DUMP] \(json)")
            } else if let error = error {
                print("[DOM-DUMP-ERROR] \(error.localizedDescription)")
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error.localizedDescription)
    }
}
