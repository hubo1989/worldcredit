import XCTest

@MainActor
final class WorldCreditUITests: XCTestCase {
    override func tearDownWithError() throws {
        if let testRun, testRun.totalFailureCount > 0 {
            let app = XCUIApplication()
            if app.state == .runningForeground {
                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "failure-screen"
                screenshot.lifetime = .keepAlways
                add(screenshot)
                let hierarchy = XCTAttachment(string: app.debugDescription)
                hierarchy.name = "failure-ui-hierarchy"
                hierarchy.lifetime = .keepAlways
                add(hierarchy)
            }
        }
        try super.tearDownWithError()
    }

    func test01BrowseAllTabsWithNotificationsDenied() {
        let app = launchScenario()
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18,230.5")
        attachScreenshot(app, name: "01-overview")

        tab("账单", in: app)
        XCTAssertTrue(app.buttons["bill.row.bill-cmb-202610"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].exists)
        setBillStatus("已还", in: app)
        XCTAssertTrue(app.buttons["bill.row.bill-boc-202609"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "02-bills-paid-filter")

        tab("卡片", in: app)
        XCTAssertTrue(app.buttons["card.row.card-cmb-1"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["card.row.card-icbc-1"].exists)
        attachScreenshot(app, name: "03-cards")

        tab("设置", in: app)
        let databaseRow = app.staticTexts.matching(NSPredicate(
            format: "label == %@ OR label == %@", "SQLite (GRDB)", "本地数据库, SQLite (GRDB)"
        )).firstMatch
        scrollTo(databaseRow, in: app)
        XCTAssertTrue(databaseRow.isHittable)
        attachScreenshot(app, name: "04-settings")
    }

    func test02OfflineFullPaymentUpdatesCurrentDetailAndPersistsAfterRelaunch() {
        let app = launchScenario()
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18,230.5")
        openBill("bill-cmb-202610", in: app)
        app.buttons["bill.detail.pay"].tap()
        XCTAssertTrue(app.buttons["payment.confirm"].waitForExistence(timeout: 5))
        app.segmentedControls["payment.type"].buttons["全额还款"].tap()
        attachScreenshot(app, name: "05-payment-confirmation")
        app.buttons["payment.confirm"].tap()
        XCTAssertTrue(app.buttons["payment.confirm"].waitForNonExistence(timeout: 10), "Payment must finish and dismiss its sheet before checking the detail")

        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥0", field: "剩余应还")
        assertLabel(app.staticTexts["bill.detail.status"], equals: "已结清", field: "状态")
        XCTAssertFalse(app.buttons["bill.detail.pay"].exists, "A paid bill must close its payment entry immediately")
        attachScreenshot(app, name: "06-paid-current-detail")

        tab("概览", in: app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥5,430")
        tab("设置", in: app)
        assertPendingChanges(1, in: app)
        attachScreenshot(app, name: "07-offline-payment-outbox")

        relaunch(app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥5,430")
        tab("账单", in: app)
        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["bill.row.bill-cmb-202610"].exists)
        setBillStatus("已还", in: app)
        let paidBill = app.buttons["bill.row.bill-cmb-202610"]
        XCTAssertTrue(paidBill.waitForExistence(timeout: 5))
        paidBill.tap()
        assertLabel(app.staticTexts["bill.detail.status"], equals: "已结清", field: "状态")
        XCTAssertFalse(app.buttons["bill.detail.pay"].exists)
        attachScreenshot(app, name: "08-paid-after-relaunch")
    }

    func test03OfflineBillAmountEditRefreshesCurrentDetail() {
        let app = launchScenario()
        openBill("bill-icbc-202609", in: app)
        scrollToAndTap(app.buttons["bill.detail.adjust"], in: app)
        let amount = app.textFields["bill.adjust.amount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        replaceText(in: amount, with: "6000")
        app.buttons["bill.adjust.save"].tap()
        XCTAssertTrue(app.buttons["bill.adjust.save"].waitForNonExistence(timeout: 10), "Amount edit must finish and dismiss its sheet before checking the detail")
        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥6,000", field: "剩余应还")
        XCTAssertTrue(app.buttons["bill.detail.pay"].exists)
        attachScreenshot(app, name: "09-adjusted-current-detail")
        tab("概览", in: app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18,800.5")
        tab("设置", in: app)
        assertPendingChanges(1, in: app)

        relaunch(app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18,800.5")
        openBill("bill-icbc-202609", in: app)
        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥6,000", field: "剩余应还")
        attachScreenshot(app, name: "10-adjusted-after-relaunch")
    }

    func test04OfflineCardConfigurationPersistsAfterRelaunch() {
        let app = launchScenario()
        tab("卡片", in: app)
        let card = app.buttons["card.row.card-cmb-1"]
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        card.tap()
        let name = app.textFields["card.edit.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        replaceText(in: name, with: "UI Test Card")
        replaceText(in: app.textFields["card.edit.limit"], with: "65000")
        replaceText(in: app.textFields["card.edit.billingDay"], with: "7")
        // Saving with notification permission denied must still commit the local edit.
        app.buttons["card.edit.save"].tap()
        XCTAssertTrue(app.buttons["card.edit.save"].waitForNonExistence(timeout: 10), "Card edit must finish and dismiss its sheet before switching tabs")
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        let updated = NSPredicate(format: "label CONTAINS %@", "UI Test Card")
        expectation(for: updated, evaluatedWith: card)
        waitForExpectations(timeout: 5)
        attachScreenshot(app, name: "11-edited-card")
        tab("设置", in: app)
        assertPendingChanges(1, in: app)

        relaunch(app)
        tab("卡片", in: app)
        app.buttons["card.row.card-cmb-1"].tap()
        XCTAssertTrue(app.textFields["card.edit.name"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["card.edit.name"].value as? String, "UI Test Card")
        XCTAssertEqual(app.textFields["card.edit.limit"].value as? String, "65000")
        XCTAssertEqual(app.textFields["card.edit.billingDay"].value as? String, "7")
        attachScreenshot(app, name: "12-card-settings-after-relaunch")
    }

    /// 隐私开关切换后金额不再可读。XCTest 只能断言开关状态与金额元素仍占位；
    /// 真实模糊效果由截图人工核验（见 attachment）。
    func test05DashboardPrivacyToggleHidesAmounts() {
        let app = launchScenario()
        let debt = app.staticTexts["dashboard.totalDebt"]
        XCTAssertTrue(debt.waitForExistence(timeout: 5))
        XCTAssertTrue(debt.label.contains("¥"), "汇总金额应以原币符号展示")
        attachScreenshot(app, name: "13-dashboard-privacy-shown")

        let toggle = app.buttons["dashboard.privacy"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        XCTAssertEqual(toggle.label, "隐匿金额")
        toggle.tap()
        XCTAssertTrue(debt.exists, "隐私模式下金额仍占位，不应导致布局塌陷")
        XCTAssertEqual(app.buttons["dashboard.privacy"].label, "显示金额")
        attachScreenshot(app, name: "14-dashboard-privacy-hidden")

        app.buttons["dashboard.privacy"].tap()
        XCTAssertEqual(app.buttons["dashboard.privacy"].label, "隐匿金额")
    }

    /// 首页一键结清逾期：演示数据中 bill-icbc-202609 已逾期 5430，
    /// 结清后总待还只余 bill-cmb-202610 的 12800.5。
    func test06DashboardPayAllOverdueFromHero() {
        let app = launchScenario()
        let payAll = app.buttons["dashboard.payAllOverdue"]
        XCTAssertTrue(payAll.waitForExistence(timeout: 5), "存在逾期时首页应提供一键全部还款")
        attachScreenshot(app, name: "15-dashboard-overdue-banner")
        payAll.tap()

        let confirm = app.buttons["全部结清"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "批量结清必须二次确认，避免误触")
        confirm.tap()

        let debt = app.staticTexts["dashboard.totalDebt"]
        let settled = NSPredicate(format: "label == %@", "¥12,800.5")
        expectation(for: settled, evaluatedWith: debt)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons["dashboard.payAllOverdue"].exists, "逾期结清后不应再显示一键还款入口")
        attachScreenshot(app, name: "16-dashboard-after-pay-all")
    }

    /// 快捷入口打开受限业务页，可正常关闭并回到首页。
    func test07DashboardQuickActionOpensAndClosesWebPage() {
        let app = launchScenario()
        let quick = app.buttons["dashboard.quick.记一笔"]
        XCTAssertTrue(quick.waitForExistence(timeout: 5))
        quick.tap()

        let close = app.buttons["webview.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5), "业务页必须提供显式关闭")
        attachScreenshot(app, name: "17-dashboard-webview")
        close.tap()
        XCTAssertTrue(app.buttons["dashboard.quick.记一笔"].waitForExistence(timeout: 5),
                      "关闭后应回到首页")
    }

    /// 账单页排序双 tab：切到「最大免息期」后行内提示换为免息天数，切回恢复距还款日。
    /// 演示数据的还款日相对当天生成，免息数值随日期漂移，因此只断言提示文案的切换。
    func test08BillsSortTabsSwitchRowCaption() {
        let app = launchScenario()
        tab("账单", in: app)
        let nearest = app.buttons["bills.sort.nearestDue"]
        let maxFree = app.buttons["bills.sort.maxInterestFree"]
        XCTAssertTrue(nearest.waitForExistence(timeout: 5), "排序应为顶部双 tab 而非折叠菜单")
        XCTAssertTrue(maxFree.exists)

        let interestFreeText = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "今日刷卡免息")
        ).firstMatch
        let distanceText = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "还款日")
        ).firstMatch

        // 筛选选项来自全部卡片而非当前 tab 的账单：默认「待还」下，
        // 只有已还账单的持卡人/银行也必须出现在菜单里。
        app.buttons["bills.holderBankFilter"].tap()
        XCTAssertTrue(app.buttons["王五"].waitForExistence(timeout: 5), "无待还账单的持卡人也不应从筛选里消失")
        // 点导航栏标题收起菜单（点"筛选" label 会命中菜单内项、干扰后续排序 tap）
        app.staticTexts["账单"].firstMatch.tap()

        maxFree.tap()
        XCTAssertTrue(interestFreeText.waitForExistence(timeout: 5), "最大免息期模式下行内应展示免息天数")
        XCTAssertFalse(app.staticTexts["固定支出"].exists, "最大免息期是选卡刷卡的排序，固定支出无免息概念不应出现")
        // 免息排序是选卡视角：不受状态筛选限制，已结清卡的账单（默认待还下不可见）也必须展示。
        // List 惰性加载屏外行，滚动后断言。
        scrollTo(app.buttons["bill.row.bill-boc-202609"], in: app)
        XCTAssertFalse(app.buttons["bill.row.bill-boc-202608"].exists,
                       "最大免息期只看当前期，历史账单不应展示")
        attachScreenshot(app, name: "18-bills-sort-max-interest-free")

        nearest.tap()
        XCTAssertTrue(distanceText.waitForExistence(timeout: 5), "最近需还款模式下行内应恢复距还款日")
    }

    /// 账单页逾期横幅一键结清：默认「待还」tab 出现横幅，结清后只剩未逾期账单，
    /// 待提交改动 +1（离线 fixture 只结清逾期那一笔）。
    func test09BillsOverdueBannerPayAll() {
        let app = launchScenario()
        tab("账单", in: app)
        let payAll = app.buttons["bills.payAllOverdue"]
        XCTAssertTrue(payAll.waitForExistence(timeout: 5), "存在逾期时账单页应提供一键结清横幅")

        payAll.tap()
        // dialog 按钮按 label 定位（与首页 test06 同模式），identifier 会匹配到多个元素
        let confirm = app.buttons["一键结清"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "批量结清必须二次确认，避免误触")
        confirm.tap()

        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].waitForNonExistence(timeout: 10), "逾期账单结清后应离开待还列表")
        XCTAssertTrue(app.buttons["bill.row.bill-cmb-202610"].waitForExistence(timeout: 5), "未逾期账单不应被一键结清误伤")
        XCTAssertFalse(app.buttons["bills.payAllOverdue"].exists, "逾期结清后横幅应消失")
        attachScreenshot(app, name: "19-bills-after-banner-pay-all")

        tab("设置", in: app)
        assertPendingChanges(1, in: app)
    }

    /// 账单页行内快捷还款：不进详情直接从列表行发起，全额还款后行离开待还列表。
    func test10BillsQuickPayFromRow() {
        let app = launchScenario()
        tab("账单", in: app)
        let quickPay = app.buttons["bill.row.pay.bill-cmb-202610"]
        XCTAssertTrue(quickPay.waitForExistence(timeout: 5), "未结清账单行内应有快捷还款入口")
        quickPay.tap()

        let confirm = app.buttons["payment.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        app.segmentedControls["payment.type"].buttons["全额还款"].tap()
        confirm.tap()
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 10), "还款提交完成并关闭弹窗")

        XCTAssertTrue(app.buttons["bill.row.bill-cmb-202610"].waitForNonExistence(timeout: 5), "结清账单应离开待还列表")
        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].exists, "其他账单不受影响")

        tab("设置", in: app)
        assertPendingChanges(1, in: app)
    }

    /// 状态筛选收进菜单：打开筛选菜单 → 选状态 → 断言列表切换完成。
    private func setBillStatus(_ status: String, in app: XCUIApplication) {
        app.buttons["bills.holderBankFilter"].tap()
        let item = app.buttons[status].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "筛选菜单里应提供状态项「\(status)」")
        item.tap()
    }

    private func launchScenario() -> XCUIApplication {        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-test-request-notifications", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launchEnvironment["WORLDCREDIT_UI_TEST_ID"] = UUID().uuidString
        app.launch()
        denyNotificationPermissionIfPresented()
        XCTAssertTrue(app.tabBars.buttons["概览"].waitForExistence(timeout: 10))
        return app
    }

    private func relaunch(_ app: XCUIApplication) {
        app.terminate()
        app.launch()
        denyNotificationPermissionIfPresented()
        XCTAssertTrue(app.tabBars.buttons["概览"].waitForExistence(timeout: 10))
    }

    private func denyNotificationPermissionIfPresented() {
        // 系统权限弹窗可能晚于启动出现；单次短等待会漏掉，残留的 Springboard Alert
        // 会阻塞后续所有 UI 查询。但轮询预算必须克制：每条用例都会跑一次，
        // 过长会把整套用例拖过单测试执行时限。
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        for _ in 0..<10 {
            guard alert.waitForExistence(timeout: 0.5) else { continue }
            let deny = alert.buttons.matching(
                NSPredicate(format: "label IN %@", ["不允许", "Don't Allow", "Don’t Allow"])
            ).firstMatch
            if deny.exists {
                deny.tap()
            }
            XCTAssertTrue(alert.waitForNonExistence(timeout: 2), "System alert did not dismiss: \(alert.debugDescription)")
        }
    }

    private func tab(_ title: String, in app: XCUIApplication) {
        let button = app.tabBars.buttons[title]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 5), .completed, "Tab \(title) must be reachable")
        button.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed, "Tab \(title) must be selected before querying its contents")
    }

    private func openBill(_ id: String, in app: XCUIApplication) {
        tab("账单", in: app)
        let row = app.buttons["bill.row.\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.buttons["bill.detail.pay"].waitForExistence(timeout: 5))
    }

    private func assertLabel(_ element: XCUIElement, equals expected: String, field: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), file: file, line: line)
        let combinedLabel = field.map { "\($0), \(expected)" } ?? expected
        let predicate = NSPredicate(format: "label == %@ OR label == %@", expected, combinedLabel)
        let match = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [match], timeout: 5), .completed, "Expected \(expected), received \(element.label)", file: file, line: line)
    }

    private func assertPendingChanges(_ count: Int, in app: XCUIApplication) {
        let row = app.descendants(matching: .any).matching(identifier: "settings.pendingChanges").firstMatch
        scrollTo(row, in: app)
        assertLabel(row, equals: "\(count) 条待提交", field: "待提交改动")
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTFail("Could not reach element: \(element)")
    }

    private func scrollToAndTap(_ element: XCUIElement, in app: XCUIApplication) {
        scrollTo(element, in: app)
        element.tap()
    }

    private func replaceText(in field: XCUIElement, with text: String) {
        XCTAssertTrue(field.exists)
        let oldValue = field.value as? String ?? ""
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: oldValue.count) + text)
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
