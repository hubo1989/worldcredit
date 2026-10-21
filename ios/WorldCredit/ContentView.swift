import SwiftUI
import WorldCreditCore

struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "creditcard.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.tint)
                Text("WorldCredit")
                    .font(.largeTitle.bold())
                Text("离线优先 · 家庭信用卡管理")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle("概览")
        }
    }
}

#Preview {
    ContentView()
}
