-- 0026：只归一化已知币种代码和无歧义别名，不改变金额或未知币种。
-- 与 TS/Swift 的 trim 行为对齐常见空白（空格、制表符、CR/LF、全角空格）。
WITH normalized AS (
  SELECT id, CASE upper(trim(currency, ' ' || char(9, 10, 11, 12, 13, 160, 12288)))
    WHEN 'CNY' THEN 'CNY'
    WHEN 'USD' THEN 'USD'
    WHEN 'HKD' THEN 'HKD'
    WHEN '人民币' THEN 'CNY'
    WHEN '美元' THEN 'USD'
    WHEN '港币' THEN 'HKD'
  END AS canonical
  FROM recurring_payables
)
UPDATE recurring_payables
SET currency = (SELECT canonical FROM normalized WHERE normalized.id = recurring_payables.id)
WHERE id IN (SELECT id FROM normalized WHERE canonical IS NOT NULL)
  AND currency != (SELECT canonical FROM normalized WHERE normalized.id = recurring_payables.id);
