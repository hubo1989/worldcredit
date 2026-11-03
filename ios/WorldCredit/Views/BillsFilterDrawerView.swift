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
    let currentEntity: BillsEntityFilter
    let currentStatuses: Set<BillStatusFilter>
    let currentHolderId: String?
    let currentBankName: String?
    let holderOptions: [(id: String, name: String)]
    let bankOptions: [String]
    let onApply: (BillsEntityFilter, Set<BillStatusFilter>, String?, String?) -> Void

    // Local draft states
    @State private var draftEntity: BillsEntityFilter
    @State private var draftStatuses: Set<BillStatusFilter>
    @State private var draftScope: BillFilterScope
    @State private var draftHolderId: String?
    @State private var draftBankName: String?
    @State private var bankSearchText: String = ""

    init(
        isPresented: Binding<Bool>,
        currentEntity: BillsEntityFilter,
        currentStatuses: Set<BillStatusFilter>,
        currentHolderId: String?,
        currentBankName: String?,
        holderOptions: [(id: String, name: String)],
        bankOptions: [String],
        onApply: @escaping (BillsEntityFilter, Set<BillStatusFilter>, String?, String?) -> Void
    ) {
        self._isPresented = isPresented
        self.currentEntity = currentEntity
        self.currentStatuses = currentStatuses
        self.currentHolderId = currentHolderId
        self.currentBankName = currentBankName
        self.holderOptions = holderOptions
        self.bankOptions = bankOptions
        self.onApply = onApply

        _draftEntity = State(initialValue: currentEntity)
        _draftStatuses = State(initialValue: currentStatuses)
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

    /// 状态选项随对象类型变化：未出账只属于信用卡，已还款只属于固定支出。
    private var statusOptions: [BillStatusFilter] {
        switch draftEntity {
        case .cards: return [.unpaid, .overdue, .unissued]
        case .payables: return [.unpaid, .overdue, .paid]
        case .all: return [.unpaid, .overdue, .unissued, .paid]
        }
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .trailing) {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.25)) {
                            isPresented = false
                        }
                    }

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
                            entitySection
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
                Text("状态可多选；持卡人与银行单维度生效")
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
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(WCColors.textSecondary)
                    .padding(8)
                    .background(WCColors.subtle, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("bills.filter.close")
        }
    }

    // MARK: - Entity Section
    private var entitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("对象类型")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WCColors.textPrimary)

            HStack(spacing: 8) {
                ForEach(BillsEntityFilter.allCases) { entity in
                    let isSelected = draftEntity == entity
                    Button(action: {
                        draftEntity = entity
                        // 切到只含一种对象时，剔除该类型不存在的状态
                        let allowed = Set(statusOptions)
                        draftStatuses = draftStatuses.intersection(allowed)
                    }) {
                        Text(entity.rawValue)
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
                    .accessibilityIdentifier("bills.entity.\(entity.rawValue)")
                }
            }
        }
    }

    // MARK: - Status Section (multi-select)
    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("状态（可多选）")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WCColors.textPrimary)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(statusOptions) { status in
                    let isSelected = draftStatuses.contains(status)
                    Button(action: {
                        if isSelected {
                            draftStatuses.remove(status)
                        } else {
                            draftStatuses.insert(status)
                        }
                    }) {
                        Text(status.rawValue)
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
                    .accessibilityIdentifier("bills.status.\(status.rawValue)")
                }
            }

            if !draftStatuses.isEmpty {
                Button("清除状态") { draftStatuses.removeAll() }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(WCColors.primaryAccent)
                    .buttonStyle(.plain)
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
                        holderRow(
                            title: "全部持卡人",
                            isSelected: draftHolderId == nil && draftBankName == nil
                        ) {
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
                        holderRow(
                            title: "全部银行",
                            isSelected: draftBankName == nil && draftHolderId == nil
                        ) {
                            draftBankName = nil
                            draftHolderId = nil
                        }

                        holderRow(
                            title: "非银行（固定支出）",
                            isSelected: draftBankName == BillsPresentationFilter.noBankValue
                        ) {
                            draftBankName = BillsPresentationFilter.noBankValue
                            draftHolderId = nil
                            draftScope = .bank
                        }

                        ForEach(filteredBanks.prefix(6), id: \.self) { bank in
                            holderRow(title: bank, isSelected: draftBankName == bank) {
                                draftBankName = bank
                                draftHolderId = nil
                                draftScope = .bank
                            }
                        }
                        if filteredBanks.count > 6 {
                            Button {
                                draftScope = .bank
                            } label: {
                                HStack {
                                    Text("更多银行（\(filteredBanks.count - 6) 家）…")
                                        .font(.subheadline)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                }
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(WCColors.primaryAccent)
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
            VStack(alignment: .leading, spacing: 10) {
                Text("选择银行")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WCColors.textPrimary)

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(WCColors.textSecondary)
                    TextField("搜索银行", text: $bankSearchText)
                        .font(.subheadline)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 8))

                VStack(spacing: 4) {
                    holderRow(title: "全部银行", isSelected: draftBankName == nil) {
                        draftBankName = nil
                    }

                    holderRow(
                        title: "非银行（固定支出）",
                        isSelected: draftBankName == BillsPresentationFilter.noBankValue
                    ) {
                        draftBankName = BillsPresentationFilter.noBankValue
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
                    .foregroundStyle(WCColors.textPrimary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(WCColors.primaryAccent)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                isSelected ? WCColors.primaryAccent.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Footer
    private var footerView: some View {
        HStack(spacing: 12) {
            Button(action: {
                draftEntity = .all
                draftStatuses.removeAll()
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
                onApply(draftEntity, draftStatuses, draftHolderId, draftBankName)
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
