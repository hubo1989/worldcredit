import SwiftUI
import WorldCreditCore

struct PaymentSheetView: View {
    let item: BillDisplayItem
    let onPay: (Double, String, String, String?) async throws -> Void

    var body: some View {
        RecordPaymentView(item: item, onPay: onPay)
    }
}
