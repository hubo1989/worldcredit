import SwiftUI
import UIKit

public enum AppThemeMode: String, CaseIterable, Identifiable {
    case system = "system"
    case light = "light"
    case dark = "dark"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .system: return "跟随系统"
        case .light: return "浅色"
        case .dark: return "深色"
        }
    }
}

public enum WCColors {
    // MARK: - 背景与卡片
    public static var canvas: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x0A/255.0, green: 0x0F/255.0, blue: 0x1E/255.0, alpha: 1.0) // #0A0F1E
                : UIColor(red: 0xF5/255.0, green: 0xF7/255.0, blue: 0xFA/255.0, alpha: 1.0) // #F5F7FA
        })
    }

    public static var surface: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x13/255.0, green: 0x1A/255.0, blue: 0x2A/255.0, alpha: 1.0) // #131A2A
                : UIColor(red: 0xFF/255.0, green: 0xFF/255.0, blue: 0xFF/255.0, alpha: 1.0) // #FFFFFF
        })
    }

    public static var subtle: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x1A/255.0, green: 0x23/255.0, blue: 0x34/255.0, alpha: 1.0) // #1A2334
                : UIColor(red: 0xEE/255.0, green: 0xF2/255.0, blue: 0xF6/255.0, alpha: 1.0) // #EEF2F6
        })
    }

    public static var border: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x26/255.0, green: 0x30/255.0, blue: 0x4A/255.0, alpha: 1.0) // #26304A
                : UIColor(red: 0xDD/255.0, green: 0xDD/255.0, blue: 0xDD/255.0, alpha: 1.0) // #DDDDDD
        })
    }

    // MARK: - 文字
    public static var textPrimary: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0xF5/255.0, green: 0xF7/255.0, blue: 0xFA/255.0, alpha: 1.0) // #F5F7FA
                : UIColor(red: 0x0A/255.0, green: 0x1F/255.0, blue: 0x44/255.0, alpha: 1.0) // #0A1F44
        })
    }

    public static var textSecondary: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x9A/255.0, green: 0xA6/255.0, blue: 0xBC/255.0, alpha: 1.0) // #9AA6BC
                : UIColor(red: 0x5B/255.0, green: 0x64/255.0, blue: 0x78/255.0, alpha: 1.0) // #5B6478
        })
    }

    public static var primaryAccent: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x3B/255.0, green: 0x6F/255.0, blue: 0xE0/255.0, alpha: 1.0) // #3B6FE0
                : UIColor(red: 0x15/255.0, green: 0x65/255.0, blue: 0xC0/255.0, alpha: 1.0) // #1565C0
        })
    }

    public static var blueLight: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x7A/255.0, green: 0xAD/255.0, blue: 0xFF/255.0, alpha: 1.0) // #7AADFF
                : UIColor(red: 0x15/255.0, green: 0x65/255.0, blue: 0xC0/255.0, alpha: 1.0) // #1565C0
        })
    }

    // MARK: - 状态指示（临期橙、逾期红、已还绿）
    public static var warningInk: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0xFF/255.0, green: 0xC4/255.0, blue: 0x6B/255.0, alpha: 1.0) // #FFC46B
                : UIColor(red: 0x92/255.0, green: 0x40/255.0, blue: 0x0E/255.0, alpha: 1.0) // #92400E
        })
    }

    public static var warningSoft: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x3A/255.0, green: 0x33/255.0, blue: 0x20/255.0, alpha: 1.0) // #3A3320
                : UIColor(red: 0xFE/255.0, green: 0xF2/255.0, blue: 0xD1/255.0, alpha: 1.0) // #FEF2D1
        })
    }

    public static var dangerInk: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0xFF/255.0, green: 0x8A/255.0, blue: 0x8A/255.0, alpha: 1.0) // #FF8A8A
                : UIColor(red: 0xB7/255.0, green: 0x1C/255.0, blue: 0x1C/255.0, alpha: 1.0) // #B71C1C
        })
    }

    public static var dangerSoft: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x3A/255.0, green: 0x22/255.0, blue: 0x2A/255.0, alpha: 1.0) // #3A222A
                : UIColor(red: 0xFA/255.0, green: 0xE6/255.0, blue: 0xE6/255.0, alpha: 1.0) // #FAE6E6
        })
    }

    public static var successInk: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x6E/255.0, green: 0xE7/255.0, blue: 0xA0/255.0, alpha: 1.0) // #6EE7A0
                : UIColor(red: 0x1B/255.0, green: 0x5E/255.0, blue: 0x20/255.0, alpha: 1.0) // #1B5E20
        })
    }

    public static var successSoft: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0x1A/255.0, green: 0x33/255.0, blue: 0x2A/255.0, alpha: 1.0) // #1A332A
                : UIColor(red: 0xE6/255.0, green: 0xEF/255.0, blue: 0xE6/255.0, alpha: 1.0) // #E6EFE6
        })
    }

    public static var onDark: Color {
        Color.white
    }
}
