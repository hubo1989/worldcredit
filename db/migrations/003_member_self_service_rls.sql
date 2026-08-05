-- Member self-service RLS: INSERT on payments, benefit_usages, promo_usages
-- Members can record usage for their own data but cannot modify base records

-- payments: member can INSERT for their own bills
-- (SELECT policy already exists in 002_enable_member_rls.sql)

-- benefit_usages: member can INSERT for benefits on their cards
-- (SELECT policy already exists in 002_enable_member_rls.sql)

-- promo_usages: member can INSERT for promos on their cards
-- (SELECT policy already exists in 002_enable_member_rls.sql)
-- Note: INSERT policies for these three tables are already included
-- in 002_enable_member_rls.sql for simplicity. This migration file
-- exists for documentation purposes and future expansion.

-- If you ran 002_enable_member_rls.sql which already includes INSERT
-- policies, this file is a no-op. If you need to add them separately,
-- uncomment the policies below:

/*
-- Re-verify member cannot UPDATE/DELETE any records (these should fail)
-- payments: member cannot update or delete
CREATE POLICY "member_no_update_payments" ON payments
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY "member_no_delete_payments" ON payments
  FOR DELETE
  USING (false);

-- benefit_usages: member cannot update or delete
CREATE POLICY "member_no_update_benefit_usages" ON benefit_usages
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY "member_no_delete_benefit_usages" ON benefit_usages
  FOR DELETE
  USING (false);

-- promo_usages: member cannot update or delete
CREATE POLICY "member_no_update_promo_usages" ON promo_usages
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY "member_no_delete_promo_usages" ON promo_usages
  FOR DELETE
  USING (false);
*/
