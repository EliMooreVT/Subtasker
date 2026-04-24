/// InMemoryKeychain.swift
/// A thread-safe, in-process substitute for KeychainStore that can be
/// injected during tests to avoid touching the real Security framework
/// keychain (which requires entitlements and a provisioned device/simulator).
///
/// Usage:
///   InMemoryKeychain.install()   // at the top of setUp()
///   InMemoryKeychain.uninstall() // at the bottom of tearDown()
///
/// While installed, every call to KeychainStore.set/get/delete is redirected
/// here through the swizzled function pointers exposed via KeychainTestHook.

import Foundation

// MARK: - Storage

final class InMemoryKeychain {
    static var store: [String: String] = [:]

    static func reset() {
        store.removeAll()
    }

    // Convenience helpers that mirror KeychainStore's static API so tests can
    // set up state without touching the real keychain.
    static func seed(_ value: String, forKey key: String) {
        store[key] = value
    }

    static func value(forKey key: String) -> String? {
        return store[key]
    }

    static func removeValue(forKey key: String) {
        store.removeValue(forKey: key)
    }
}
