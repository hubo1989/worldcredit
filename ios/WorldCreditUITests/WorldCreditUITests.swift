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
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18230.50")
        attachScreenshot(app, name: "01-overview")

        tab("账单", in: app)
        XCTAssertTrue(app.buttons["bill.row.bill-cmb-202610"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].exists)
        app.segmentedControls["bills.filter"].buttons["已还"].tap()
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
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18230.50")
        openBill("bill-cmb-202610", in: app)
        app.buttons["bill.detail.pay"].tap()
        XCTAssertTrue(app.buttons["payment.confirm"].waitForExistence(timeout: 5))
        app.segmentedControls["payment.type"].buttons["全额还款"].tap()
        attachScreenshot(app, name: "05-payment-confirmation")
        app.buttons["payment.confirm"].tap()
        XCTAssertTrue(app.buttons["payment.confirm"].waitForNonExistence(timeout: 10), "Payment must finish and dismiss its sheet before checking the detail")

        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥0.00", field: "剩余应还")
        assertLabel(app.staticTexts["bill.detail.status"], equals: "已结清", field: "状态")
        XCTAssertFalse(app.buttons["bill.detail.pay"].exists, "A paid bill must close its payment entry immediately")
        attachScreenshot(app, name: "06-paid-current-detail")

        tab("概览", in: app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥5430.00")
        tab("设置", in: app)
        assertPendingChanges(1, in: app)
        attachScreenshot(app, name: "07-offline-payment-outbox")

        relaunch(app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥5430.00")
        tab("账单", in: app)
        XCTAssertTrue(app.buttons["bill.row.bill-icbc-202609"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["bill.row.bill-cmb-202610"].exists)
        app.segmentedControls["bills.filter"].buttons["已还"].tap()
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
        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥6000.00", field: "剩余应还")
        XCTAssertTrue(app.buttons["bill.detail.pay"].exists)
        attachScreenshot(app, name: "09-adjusted-current-detail")
        tab("概览", in: app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18800.50")
        tab("设置", in: app)
        assertPendingChanges(1, in: app)

        relaunch(app)
        assertLabel(app.staticTexts["dashboard.totalDebt"], equals: "¥18800.50")
        openBill("bill-icbc-202609", in: app)
        assertLabel(app.staticTexts["bill.detail.remaining"], equals: "¥6000.00", field: "剩余应还")
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

    private func launchScenario() -> XCUIApplication {
        continueAfterFailure = false
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
        let alert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        guard alert.waitForExistence(timeout: 3) else { return }
        let deny = alert.buttons.matching(NSPredicate(format: "label IN %@", ["不允许", "Don't Allow", "Don’t Allow"])).firstMatch
        XCTAssertTrue(deny.exists, "Unexpected system alert: \(alert.debugDescription)")
        deny.tap()
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
