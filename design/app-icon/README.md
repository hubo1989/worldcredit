# WorldCredit iOS App 图标设计规范与交付文档

## 1. 核心设计理念

本图标针对 **WorldCredit（信用卡与账单智能管理工具）** 定制设计，严格遵循 Apple HIG（Human Interface Guidelines）图标规范，并在视觉上深度贯彻项目的 **ObsidianUI 暗色调与专业金融工具质感**：

- **实体信用卡（Credit Card）**：采用精密倒角与黑曜石钛金拉丝表面，配合经典黄金 EMV 微雕芯片与 NFC 感应弧线，在手机桌面极小尺寸下一眼建立“信用卡”认知。
- **账单凭条（Bill / Statement Ledger）**：卡片斜后方升起一叠半透明账单，具备真实的打孔锯齿撕裂边、装订圆孔与明细数据柱，鲜明体现“账单归集、对账明细”属性，区别于普通的支付钱包或银行单卡。
- **工具属性强化（Precision Utility Instrument）**：
  - **激光对账光带（Smart Scan Beam）**：卡片与账单交接处横贯一条带有外发光的蓝色激光条，象征全自动智能抓取账单与实时对账。
  - **账期仪表与额度进度条（Due Date & Progress Gauge）**：卡身右下角配备微型工具仪表模块，包含账单还款日告警日历（金黄高亮指示）与信用额度使用游标，直接传达“提醒、计算、控制与管理”的工具心智。

---

## 2. 色彩与设计语言（对齐项目 ObsidianUI）

| 视觉元素 | 颜色值 | 设计语义 |
| :--- | :--- | :--- |
| **画布背景** | `#04070F` ~ `#0E1626` | 深邃夜空黑曜石底色，带顶部聚光漫射 |
| **卡片主体** | `#0A101A` ~ `#24334A` | 黑钛金金属拉丝，CNC 刀锋倒角高光 |
| **EMV 芯片** | `#F2C94C` ~ `#D9A027` | 黄金微雕电路，提供高对比第一视觉焦点 |
| **智能扫描光束** | `#3B6FE0` ~ `#7AADFF` | 核心品牌电光蓝，自动化工具属性 |
| **账期告警/总额** | `#F0C75E` | 账单日到期提醒与还款高亮 |

---

## 3. 文件清单与规格

所有资源均已保存在 `design/app-icon/` 目录下：

| 文件名 | 格式 / 尺寸 | 适用场景 / 平台 |
| :--- | :--- | :--- |
| `worldcredit-app-icon.svg` | **SVG (1024×1024 矢量母版)** | 无损缩放，支持无限分辨率渲染 |
| `preview.html` | **HTML (交互式桌面预览器)** | 包含真机主屏环境、各尺寸阶梯与一键 PNG 导出 |
| `generate-icons.mjs` | **Node 脚本（依赖 `sharp`）** | 从 SVG 生成各尺寸 PNG，并把 1024 主图标同步进 Xcode 资产目录 |
| `README.md` | **Markdown** | 本设计与集成规范文档 |

---

## 4. 预览与使用方法

1. **浏览器直接预览**：
   在浏览器中直接打开 `design/app-icon/preview.html`，即可查看：
   - 1024×1024 官方母版；
   - iPhone 桌面主屏（带连续超椭圆 Squircle 自动遮罩与深色壁纸模拟）；
   - 多尺寸阶梯可识别度验证（180px @3x、120px @2x、87px 设置项、60px Spotlight 等）；
   - PNG 导出需通过 HTTP 打开：在仓库根目录执行 `python3 -m http.server 8000 --bind 127.0.0.1`，访问 `http://127.0.0.1:8000/design/app-icon/preview.html`；`file://` 仅用于预览，点击导出会提示切换 HTTP。
   - 180/120/167/152 PNG 是保留的设计交付副本，不参与 Xcode 构建。页面的 87/60/40 阶梯直接缩放 SVG 供识别度检查，不表示有对应 PNG 文件。

2. **iOS 工程集成（已落地）**：

   ```sh
   node design/app-icon/generate-icons.mjs
   ```

   该脚本把 1024×1024 主图标同时写入 `design/app-icon/AppIcon-1024.png`（供预览）
   与 `ios/WorldCredit/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`（构建输入），
   两边内容逐字节一致，避免副本漂移。Xcode 资产目录使用 Xcode 14+ 的单一
   `1024×1024` 通用 iOS 图标格式，由系统自动下采样，不需要再列 180/120/87/60 等槽位。

   工程侧绑定在 `ios/project.yml` 的 `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon`。

   > **注意**：`ios/project.yml` 通过 `info.properties` 生成 Info.plist，`xcodegen generate`
   > 会覆盖 `ios/WorldCredit/Info.plist`。图标走 `Assets.xcassets`，不受影响；但其它
   > Info.plist 键必须写在 `project.yml` 的 `properties` 里，不能直接改 plist 文件。

## 5. 小尺寸可识别度

实测 60 / 87 / 120 / 180 四档：180px 全要素可读；120px 芯片与蓝光带仍是主锚点；
87px 与 60px 下账单凭条并成浅色块、仪表模块退为小亮点，但**金色 EMV 芯片**与
**蓝色扫描光带**两个最强识别锚点在 60px 仍可辨，符合桌面图标优先级。

## 6. 待办

- `WorldCreditWatch` 尚无 watchOS 图标（`WKAppIcon`），当前构建无告警但上架前需补。
