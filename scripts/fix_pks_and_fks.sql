-- 1. 毫秒级快速去重 (Hash Aggregate)
DELETE FROM public.card_holders WHERE ctid NOT IN (SELECT min(ctid) FROM public.card_holders GROUP BY id);
DELETE FROM public.banks WHERE ctid NOT IN (SELECT min(ctid) FROM public.banks GROUP BY id);
DELETE FROM public.card_products WHERE ctid NOT IN (SELECT min(ctid) FROM public.card_products GROUP BY id);
DELETE FROM public.credit_cards WHERE ctid NOT IN (SELECT min(ctid) FROM public.credit_cards GROUP BY id);
DELETE FROM public.bills WHERE ctid NOT IN (SELECT min(ctid) FROM public.bills GROUP BY id);
DELETE FROM public.benefits WHERE ctid NOT IN (SELECT min(ctid) FROM public.benefits GROUP BY id);
DELETE FROM public.promos WHERE ctid NOT IN (SELECT min(ctid) FROM public.promos GROUP BY id);
DELETE FROM public.payments WHERE ctid NOT IN (SELECT min(ctid) FROM public.payments GROUP BY id);
DELETE FROM public.gmail_ledger_entries WHERE ctid NOT IN (SELECT min(ctid) FROM public.gmail_ledger_entries GROUP BY id);

-- 2. 建立 PRIMARY KEY 主键约束
ALTER TABLE public.banks DROP CONSTRAINT IF EXISTS banks_pkey;
ALTER TABLE public.banks ADD CONSTRAINT banks_pkey PRIMARY KEY (id);

ALTER TABLE public.card_holders DROP CONSTRAINT IF EXISTS card_holders_pkey;
ALTER TABLE public.card_holders ADD CONSTRAINT card_holders_pkey PRIMARY KEY (id);

ALTER TABLE public.card_products DROP CONSTRAINT IF EXISTS card_products_pkey;
ALTER TABLE public.card_products ADD CONSTRAINT card_products_pkey PRIMARY KEY (id);

ALTER TABLE public.credit_cards DROP CONSTRAINT IF EXISTS credit_cards_pkey;
ALTER TABLE public.credit_cards ADD CONSTRAINT credit_cards_pkey PRIMARY KEY (id);

ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_pkey;
ALTER TABLE public.bills ADD CONSTRAINT bills_pkey PRIMARY KEY (id);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_pkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE public.benefits DROP CONSTRAINT IF EXISTS benefits_pkey;
ALTER TABLE public.benefits ADD CONSTRAINT benefits_pkey PRIMARY KEY (id);

ALTER TABLE public.promos DROP CONSTRAINT IF EXISTS promos_pkey;
ALTER TABLE public.promos ADD CONSTRAINT promos_pkey PRIMARY KEY (id);

ALTER TABLE public.gmail_ledger_entries DROP CONSTRAINT IF EXISTS gmail_ledger_entries_pkey;
ALTER TABLE public.gmail_ledger_entries ADD CONSTRAINT gmail_ledger_entries_pkey PRIMARY KEY (id);

-- 3. 清理悬空外键关联
UPDATE public.benefits SET card_product_id = NULL WHERE card_product_id IS NOT NULL AND card_product_id NOT IN (SELECT id FROM public.card_products);
UPDATE public.card_products SET bank_id = NULL WHERE bank_id IS NOT NULL AND bank_id NOT IN (SELECT id FROM public.banks);
UPDATE public.credit_cards SET card_product_id = NULL WHERE card_product_id IS NOT NULL AND card_product_id NOT IN (SELECT id FROM public.card_products);
DELETE FROM public.credit_cards WHERE holder_id IS NOT NULL AND holder_id NOT IN (SELECT id FROM public.card_holders);
DELETE FROM public.bills WHERE card_id IS NOT NULL AND card_id NOT IN (SELECT id FROM public.credit_cards);
DELETE FROM public.payments WHERE bill_id IS NOT NULL AND bill_id NOT IN (SELECT id FROM public.bills);

-- 4. 添加核心 FOREIGN KEY 外键约束
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_card_id_fkey;
ALTER TABLE public.bills ADD CONSTRAINT bills_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.credit_cards(id) ON DELETE CASCADE;

ALTER TABLE public.credit_cards DROP CONSTRAINT IF EXISTS credit_cards_holder_id_fkey;
ALTER TABLE public.credit_cards ADD CONSTRAINT credit_cards_holder_id_fkey FOREIGN KEY (holder_id) REFERENCES public.card_holders(id) ON DELETE CASCADE;

ALTER TABLE public.credit_cards DROP CONSTRAINT IF EXISTS credit_cards_card_product_id_fkey;
ALTER TABLE public.credit_cards ADD CONSTRAINT credit_cards_card_product_id_fkey FOREIGN KEY (card_product_id) REFERENCES public.card_products(id) ON DELETE RESTRICT;

ALTER TABLE public.card_products DROP CONSTRAINT IF EXISTS card_products_bank_id_fkey;
ALTER TABLE public.card_products ADD CONSTRAINT card_products_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.banks(id);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_bill_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;

ALTER TABLE public.benefits DROP CONSTRAINT IF EXISTS benefits_card_product_id_fkey;
ALTER TABLE public.benefits ADD CONSTRAINT benefits_card_product_id_fkey FOREIGN KEY (card_product_id) REFERENCES public.card_products(id) ON DELETE CASCADE;

-- 5. 刷新 schema 缓存
NOTIFY pgrst, 'reload schema';
