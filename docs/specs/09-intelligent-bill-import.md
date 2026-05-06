# Spec: 智能识别导入账单草稿

**状态**: 路线图规划  
**日期**: 2026-04-29  
**相关模块**: 账单导入、草稿、LLM/OCR、文件追溯

## 目标

支持用户通过截图、PDF、邮件或短信文本导入账单，系统识别账单总额、最低还款额、还款日、账单周期和交易明细。识别结果必须先进入草稿，用户确认后才写入正式账单，避免错误污染数据。

## 用户故事

作为管理员，我希望上传账单截图或 PDF 后生成账单草稿，以便减少手动录入。

作为管理员，我希望查看识别置信度和原始文本，以便判断是否需要修正。

作为管理员，我希望确认草稿后再创建正式账单，以便识别错误不会直接入库。

作为管理员，我希望保留原始文件或文本引用，以便后续追溯识别来源。

## 范围

MVP 包含：

- 支持粘贴邮件/短信文本。
- 支持上传图片或 PDF。
- 生成账单草稿。
- 草稿可编辑。
- 用户确认后创建 `bills` 和 `bill_items`。
- 保存原始文本、来源类型和识别置信度。

不包含：

- 自动读取邮箱。
- 银行账号授权。
- 无人工确认的自动入库。
- 跨银行模板长期维护平台。

## 导入流程

1. 用户选择卡片。
2. 用户选择导入类型：文本、图片、PDF。
3. 系统提取文本。
4. 系统识别结构化字段。
5. 显示草稿预览。
6. 用户编辑错误字段。
7. 用户确认入库。
8. 系统创建正式账单和明细。

## 草稿字段

账单草稿包含：

- `card_id`
- `bill_month`
- `statement_start`
- `statement_end`
- `statement_date`
- `bill_amount`
- `min_payment`
- `due_date`
- `items`
- `raw_text`
- `source_type`
- `confidence`
- `warnings`

明细草稿包含：

- `transaction_date`
- `post_date`
- `description`
- `merchant_name`
- `category`
- `amount`
- `currency`
- `item_type`
- `confidence`
- `raw_text`

## 数据设计

建议新增草稿表：

```sql
CREATE TABLE bill_import_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'image', 'pdf', 'email', 'sms')),
  raw_text TEXT,
  file_ref TEXT,
  parsed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'discarded')),
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);
```

正式入库时：

- `bill_items.source = 'llm'` 或 `import`。
- `bill_items.confidence` 保存明细级置信度。
- `bill_items.raw_text` 保存对应原文片段。
- `bill_items.metadata` 保存识别模型、来源和草稿 ID。

## 权限

- 管理员可创建和确认账单草稿。
- 成员第一版不可创建账单草稿。
- 草稿只能由创建者或管理员管理范围访问。

## 边界情况

- 识别不到卡片时要求用户手动选择。
- 识别到账单已存在时提示重复，不直接覆盖。
- 明细合计和账单金额不一致时必须高亮。
- 置信度低于阈值时要求用户逐项确认。
- 文件解析失败时保留原文件并提示重新上传或改用文本。
- PDF 多页需要展示页码来源。

## 验收标准

- 用户可以从文本、图片或 PDF 创建账单草稿。
- 草稿确认前不会写入正式账单。
- 草稿可编辑并展示识别警告。
- 确认后创建账单和明细。
- 原始文本或文件引用可追溯。
- 重复账单有明确提示。
