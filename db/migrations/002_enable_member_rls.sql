-- Enable member (self-service) RLS policies
-- Members can only access data linked to their own card_holder record via auth_user_id

-- card_holders: member can see their own record
CREATE POLICY "member_self_access" ON card_holders
  FOR SELECT
  USING (auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- credit_cards: member can see cards linked to their holder
CREATE POLICY "member_view_cards" ON credit_cards
  FOR SELECT
  USING (holder_id IN (
    SELECT id FROM card_holders
    WHERE auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- bills: member can view bills for their cards
CREATE POLICY "member_view_bills" ON bills
  FOR SELECT
  USING (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- bill_items: member can view bill items for their bills
CREATE POLICY "member_view_bill_items" ON bill_items
  FOR SELECT
  USING (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- payments: member can view and insert payments for their bills
CREATE POLICY "member_view_payments" ON payments
  FOR SELECT
  USING (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

CREATE POLICY "member_insert_payments" ON payments
  FOR INSERT
  WITH CHECK (bill_id IN (
    SELECT b.id FROM bills b
    JOIN credit_cards cc ON b.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- benefits: member can view benefits for their cards
CREATE POLICY "member_view_benefits" ON benefits
  FOR SELECT
  USING (card_id IN (
    SELECT cc.id FROM credit_cards cc
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- benefit_usages: member can view and insert usage records
CREATE POLICY "member_view_benefit_usages" ON benefit_usages
  FOR SELECT
  USING (benefit_id IN (
    SELECT ben.id FROM benefits ben
    JOIN credit_cards cc ON ben.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

CREATE POLICY "member_insert_benefit_usages" ON benefit_usages
  FOR INSERT
  WITH CHECK (benefit_id IN (
    SELECT ben.id FROM benefits ben
    JOIN credit_cards cc ON ben.card_id = cc.id
    JOIN card_holders ch ON cc.holder_id = ch.id
    WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  ));

-- promos: member can view promos for their cards
CREATE POLICY "member_view_promos" ON promos
  FOR SELECT
  USING (
    card_id IS NULL
    OR card_id IN (
      SELECT cc.id FROM credit_cards cc
      JOIN card_holders ch ON cc.holder_id = ch.id
      WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  );

-- promo_usages: member can view and insert usage records
-- SELECT scoped to member's own cards (consistent with INSERT policy)
CREATE POLICY "member_view_promo_usages" ON promo_usages
  FOR SELECT
  USING (promo_id IN (
    SELECT id FROM promos
    WHERE card_id IS NULL
    OR card_id IN (
      SELECT cc.id FROM credit_cards cc
      JOIN card_holders ch ON cc.holder_id = ch.id
      WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  ));

CREATE POLICY "member_insert_promo_usages" ON promo_usages
  FOR INSERT
  WITH CHECK (
    card_id IS NULL
    OR card_id IN (
      SELECT cc.id FROM credit_cards cc
      JOIN card_holders ch ON cc.holder_id = ch.id
      WHERE ch.auth_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  );
