import Foundation

extension KeyedDecodingContainer {
    /// Decodes a Bool field that may arrive either as a JSON boolean or as SQLite integer (0/1).
    func decodeFlexibleBoolIfPresent(forKey key: Key) throws -> Bool? {
        guard contains(key) else { return nil }
        if try decodeNil(forKey: key) { return nil }
        if let boolValue = try? decode(Bool.self, forKey: key) {
            return boolValue
        }
        if let intValue = try? decode(Int.self, forKey: key) {
            return intValue != 0
        }
        return try decode(Bool.self, forKey: key)
    }

    /// Decodes a JSON string column that may arrive either as a raw JSON string or as a nested JSON object.
    func decodeJSONStringIfPresent(forKey key: Key) throws -> String? {
        guard contains(key) else { return nil }
        if try decodeNil(forKey: key) { return nil }
        if let rawString = try? decode(String.self, forKey: key) {
            return rawString
        }
        let dict = try decode([String: AnyCodable].self, forKey: key)
        let data = try JSONEncoder().encode(dict)
        return String(decoding: data, as: UTF8.self)
    }
}
