-- 0003: remove the shared-inbox sender allowlist.
-- The public address (bills@20160325.xyz) is no longer supported; bill emails
-- are attributed solely by the per-user dedicated address (bills+{userId}@...),
-- so the sender registration table has no remaining readers.
DROP TABLE IF EXISTS bill_email_sources;
