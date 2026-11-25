import SwiftUI
import WorldCreditCore

struct PaymentSheetView: View {
    let item: BillDisplayItem
    let onPay: (Double, String, String, String?) async throws -> Void
    var onPayWithFx: ((Double, String, String, String?, String?, Double?, Double?) async throws -> Void)? = nil

    var body: some View {
        RecordPaymentView(item: item, onPay: onPay, onPayWithFx: onPayWithFx)
    }
}
