# WorldCredit 现行设计源（baoyu-design）

> **唯一设计真源**：本项目现行设计工具链为 **baoyu-design**（本机 `claude-design` / `claude-design-system`）。
> 原 `design/openpencil/` 与 `.op` 文件已作为历史存档保留，不再对其进行写操作。

---

## 1. 目录架构

```text
design/baoyu/
├── canvas.json                    # 画布总索引（定义页面、画板坐标尺寸与排序）
├── tokens.json                    # 设计系统令牌真源（暗色 + 亮色 d-* 令牌全集）
├── support.js                     # 交互画板无头/本地预览支持脚本
├── README.md                      # 本说明文档
├── Mobile_Settings_Dark.dc.html   # 移动端 /settings 暗色主视图
├── Mobile_Settings_Light.dc.html  # 移动端 /settings 亮色主视图
├── Mobile_Drawer_Gmail_Dark.dc.html     # 移动端 Gmail 导入抽屉 (暗色)
├── Mobile_Drawer_Gmail_Light.dc.html    # 移动端 Gmail 导入抽屉 (亮色)
├── Mobile_Drawer_Reminders_Dark.dc.html # 移动端 提醒偏好抽屉 (暗色)
├── Mobile_Drawer_Reminders_Light.dc.html# 移动端 提醒偏好抽屉 (亮色)
├── Mobile_Drawer_Display_Dark.dc.html   # 移动端 显示与币种抽屉 (暗色)
├── Mobile_Drawer_Display_Light.dc.html  # 移动端 显示与币种抽屉 (亮色)
├── Admin_Settings_Dark.dc.html    # 管理后台 /admin/settings 桌面端 (暗色)
└── Admin_Settings_Light.dc.html   # 管理后台 /admin/settings 桌面端 (亮色)
```

---

## 2. Token 三方对齐契约

所有 UI 样式均由三方联合约束，禁止单边造色或硬编码：
1. **设计源令牌**：`design/baoyu/tokens.json`（定义 `name`, `value`, `lightValue`, `cssVar`）
2. **基础映射池**：`design/openpencil/vars/foundations.json`（保留同步作为底层 token 字典）
3. **运行时样式**：`app/globals.css`（在 `@theme` 声明 `--color-d-*` 与 `--color-d-light-*`，并在 `.theme-light, [data-theme="light"]` 中动态重载）

---

## 3. 门禁验证命令

门禁检查已无缝迁移至 `design/baoyu/`：
- **门禁入口**：`bash design/openpencil/verify-batch.sh --source-only`（在 CI 与本地均可执行，生成 `design/openpencil/batch-report.json`）
- **独立 Python 脚本**：`python3 design/baoyu/verify-design.py`
