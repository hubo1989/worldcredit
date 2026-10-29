import SwiftUI
import WorldCreditCore

enum BillFilterScope: String, CaseIterable, Identifiable {
    case all = "全部"
    case holder = "持卡人"
    case bank = "银行"

    var id: String { rawValue }
}

struct BillsFilterDrawerView: View {
    @Binding var isPresented: Bool
    let currentFilter: BillFilter
    let currentHolderId: String?
    let currentBankName: String?
    let holderOptions: [(id: String, name: String)]
    let bankOptions: [String]
    let onApply: (BillFilter, String?, String?) -> Void

    // Local draft states
    @State private var draftFilter: BillFilter
    @State private var draftScope: BillFilterScope
    @State private var draftHolderId: String?
    @State private var draftBankName: String?
    @State private var bankSearchText: String = ""

    init(
        isPresented: Binding<Bool>,
        currentFilter: BillFilter,
        currentHolderId: String?,
        currentBankName: String?,
        holderOptions: [(id: String, name: String)],
        bankOptions: [String],
        onApply: @escaping (BillFilter, String?, String?) -> Void
    ) {
        self._isPresented = isPresented
        self.currentFilter = currentFilter
        self.currentHolderId = currentHolderId
        self.currentBankName = currentBankName
        self.holderOptions = holderOptions
        self.bankOptions = bankOptions
        self.onApply = onApply

        _draftFilter = State(initialValue: currentFilter)
        if currentHolderId != nil {
            _draftScope = State(initialValue: .holder)
        } else if currentBankName != nil {
            _draftScope = State(initialValue: .bank)
        } else {
            _draftScope = State(initialValue: .all)
        }
        _draftHolderId = State(initialValue: currentHolderId)
        _draftBankName = State(initialValue: currentBankName)
    }

    private var filteredBanks: [String] {
        if bankSearchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return bankOptions
        }
        return bankOptions.filter { $0.localizedCaseInsensitiveContains(bankSearchText) }
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .trailing) {
                // Dimmed backdrop (left 84pt equivalent or covers background)
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.25)) {
                            isPresented = false
                        }
                    }

                // Drawer (356pt width on regular screens, or min(356, geometry.size.width - 40))
                let drawerWidth = min(356.0, geometry.size.width)

                VStack(spacing: 0) {
                    headerView
                        .padding(.horizontal, 20)
                        .padding(.top, 16)
                        .padding(.bottom, 12)

                    Divider()
                        .background(WCColors.border)

                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            statusSection
                            scopeSection
                            optionsSection
                        }
                        .padding(20)
                    }

                    Divider()
                        .background(WCColors.border)

                    footerView
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                }
                .frame(width: drawerWidth)
                .background(WCColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: Color.black.opacity(0.2), radius: 16, x: -4, y: 0)
                .ignoresSafeArea(.keyboard, edges: .bottom)
                .gesture(
                    DragGesture()
                        .onEnded { value in
                            if value.translation.width > 50 {
                                withAnimation(.easeOut(duration: 0.25)) {
                                    isPresented = false
                                }
                            }
                        }
                )
            }
        }
    }

    // MARK: - Header
    private var headerView: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("筛选")
                    .font(.title2.bold())
                    .foregroundStyle(WCColors.textPrimary)
                Text("单维度生效：持卡人与银行互斥")
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
            }
            Spacer()
            Button(action: {
                withAnimation(.easeOut(duration: 0.25)) {
                    isPresented = false
                }
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WCColors.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(WCColors.subtle)
                    .clipShape(Circle())
            }
            .accessibilityIdentifier("bills.filter.close")
        }
    }

    // MARK: - Status Section
    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("账单状态")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WCColors.textPrimary)

            HStack(spacing: 8) {
                ForEach(BillFilter.allCases) { filter in
                    let isSelected = draftFilter == filter
                    Button(action: {
                        draftFilter = filter
                    }) {
                        Text(filter.rawValue)
                            .font(.footnote.weight(isSelected ? .bold : .medium))
                            .foregroundStyle(isSelected ? Color.white : WCColors.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                isSelected ? WCColors.primaryAccent : WCColors.subtle,
                                in: RoundedRectangle(cornerRadius: 8)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(filter.rawValue)
                }
            }
        }
    }

    // MARK: - Scope Section
    private var scopeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("筛选维度")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WCColors.textPrimary)

            HStack(spacing: 8) {
                ForEach(BillFilterScope.allCases) { scope in
                    let isSelected = draftScope == scope
                    Button(action: {
                        draftScope = scope
                        if scope == .all {
                            draftHolderId = nil
                            draftBankName = nil
                        } else if scope == .holder {
                            draftBankName = nil
                        } else if scope == .bank {
                            draftHolderId = nil
                        }
                    }) {
                        Text(scope.rawValue)
                            .font(.footnote.weight(isSelected ? .bold : .medium))
                            .foregroundStyle(isSelected ? Color.white : WCColors.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                isSelected ? WCColors.primaryAccent : WCColors.subtle,
                                in: RoundedRectangle(cornerRadius: 8)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("bills.scope.\(scope.rawValue)")
                }
            }
        }
    }

    // MARK: - Options Section (Holder or Bank)
    @ViewBuilder
    private var optionsSection: some View {
        switch draftScope {
        case .all:
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("持卡人")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WCColors.textPrimary)

                    VStack(spacing: 4) {
                        holderRow(title: "全部持卡人", isSelected: draftHolderId == nil && draftBankName == nil) {
                            draftHolderId = nil
                            draftBankName = nil
                        }

                        ForEach(holderOptions, id: \.id) { holder in
                            holderRow(title: holder.name, isSelected: draftHolderId == holder.id) {
                                draftHolderId = holder.id
                                draftBankName = nil
                                draftScope = .holder
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("银行")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WCColors.textPrimary)

                    VStack(spacing: 4) {
                        holderRow(title: "全部银行", isSelected: draftBankName == nil && draftHolderId == nil) {
                            draftBankName = nil
                            draftHolderId = nil
                        }

                        ForEach(filteredBanks.prefix(6), id: \.self) { bank in
                            holderRow(title: bank, isSelected: draftBankName == bank) {
                                draftBankName = bank
                                draftHolderId = nil
                                draftScope = .bank
                            }
                        }
                    }
                }
            }

        case .holder:
            VStack(alignment: .leading, spacing: 10) {
                Text("选择持卡人")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WCColors.textPrimary)

                VStack(spacing: 4) {
                    holderRow(title: "全部持卡人", isSelected: draftHolderId == nil) {
                        draftHolderId = nil
                    }

                    ForEach(holderOptions, id: \.id) { holder in
                        holderRow(title: holder.name, isSelected: draftHolderId == holder.id) {
                            draftHolderId = holder.id
                        }
                    }
                }
            }

        case .bank:
            VStack(alignment: .leading, spacing: 12) {
                Text("选择银行")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WCColors.textPrimary)

                // Search field
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.footnote)
                        .foregroundStyle(WCColors.textSecondary)
                    TextField("搜索银行...", text: $bankSearchText)
                        .font(.subheadline)
                        .foregroundStyle(WCColors.textPrimary)
                    if !bankSearchText.isEmpty {
                        Button(action: { bankSearchText = "" }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.footnote)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }
                }
                .padding(10)
                .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("bank.search")

                VStack(spacing: 4) {
                    holderRow(title: "全部银行", isSelected: draftBankName == nil) {
                        draftBankName = nil
                    }

                    ForEach(filteredBanks, id: \.self) { bank in
                        holderRow(title: bank, isSelected: draftBankName == bank) {
                            draftBankName = bank
                        }
                    }
                }
            }
        }
    }

    private func holderRow(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(isSelected ? WCColors.primaryAccent : WCColors.textPrimary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(WCColors.primaryAccent)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                isSelected ? WCColors.subtle : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(title)
    }

    // MARK: - Footer
    private var footerView: some View {
        HStack(spacing: 12) {
            Button(action: {
                draftFilter = .unpaid
                draftScope = .all
                draftHolderId = nil
                draftBankName = nil
                bankSearchText = ""
            }) {
                Text("重置")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(WCColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 10))
            }
            .accessibilityIdentifier("bills.filter.reset")

            Button(action: {
                onApply(draftFilter, draftHolderId, draftBankName)
                withAnimation(.easeOut(duration: 0.25)) {
                    isPresented = false
                }
            }) {
                Text("查看账单")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(WCColors.primaryAccent, in: RoundedRectangle(cornerRadius: 10))
            }
            .accessibilityIdentifier("bills.filter.apply")
        }
    }
}
