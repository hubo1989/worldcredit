-- 0007: Remove auto-generated placeholder card products.
--
-- 背景：card_products 的 583 行里有 564 行是模板批量生成的，现实世界并不存在——
-- 48 家中国银行各自拥有一模一样的「普卡/金卡/标准白金卡/钻石卡/车主信用卡/
-- 航空联名信用卡/视频会员联名卡/高校校友卡/女性专属卡」九件套，10 家美国银行
-- 也各有「Airline Co-Branded Card / Business Credit Card / ...」七件套。这些卡
-- 无处核对、没有官网可查，留在目录里只会让选卡器出现一堆无法区分的假选项。
--
-- 判定方式：这些占位行的命名一律是「银行名 + 空格 + 模板名」，所以用**后缀精确
-- 匹配**模板名。不用 card_name 全等匹配，也不做模糊包含——「Chase Sapphire
-- Reserve」这类真卡必须原样保留。
--
-- 安全约束（重要）：credit_cards.card_product_id 声明为 ON DELETE RESTRICT，但
-- **sqlite3 CLI 默认不启用外键**（PRAGMA foreign_keys 默认 off），实测它照样会
-- 删掉被引用的行、留下孤儿引用。所以不能依赖数据库替我们拦截：这里显式用
-- NOT EXISTS 排除任何仍被 credit_cards 引用的产品。
--
-- 结果是 583 → 33：19 行真实卡片产品，外加 14 行虽然属于上述模板命名族、但正被
-- 真实卡片使用（如「中国银行 普卡」「Bank of America Cash Back Card」），必须保留。
--
-- benefits / promos / benefit_usages 在执行时均为 0 行，故无级联影响；若将来这些
-- 表有数据，需重新评估依赖。
--
-- 删除前导出过 550 行待删记录做过核对，但那只是临时校验文件，刻意没有入库：
-- 这些行是按模板批量生成的垃圾数据，没有任何回滚价值。本迁移不可逆，需要「还原」
-- 的话应当重新生成占位数据，而不是恢复这批记录。

DELETE FROM card_products
WHERE id NOT IN (SELECT DISTINCT card_product_id FROM credit_cards WHERE card_product_id IS NOT NULL)
  AND substr(card_name, length(bank_name) + 2) IN (
    '普卡','金卡','标准白金卡','钻石卡','车主信用卡',
    '航空联名信用卡','视频会员联名卡','高校校友卡','女性专属卡',
    'Gold Card','Cash Back Card','Travel Rewards Card','Student Card',
    'Business Credit Card','Secured Credit Card','Airline Co-Branded Card',
    'Hotel Co-Branded Card','Classic Card','Platinum Card','Visa Signature',
    'World Mastercard','UnionPay Dual Currency Card'
  );
