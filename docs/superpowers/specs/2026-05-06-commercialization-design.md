# WorldCredit Commercialization Design

Date: 2026-05-06
Status: Draft for user review

## Summary

WorldCredit should commercialize first as a Chinese-first, region-light subscription product for families who manage multiple credit cards together. The first paid version should not try to become a full personal finance platform. Its commercial promise is narrower: keep household credit card data in one place, reduce bill entry work, make repayment responsibility visible, prevent missed repayments, and provide monthly review/export.

The target validation path is small-scale paid use before broad market expansion. Product decisions should favor fast subscription validation, strong data trust, and a clear family workflow over bank integrations, investment features, native app store subscriptions, or heavy enterprise controls.

## Product Positioning

The product category is a family credit card bill manager. It sits between a spreadsheet and a full personal finance app. Compared with spreadsheets, it should be safer, easier to update, and better at reminders. Compared with large finance apps, it should stay focused on credit cards, household responsibility, and semi-automatic bill organization.

The first commercial audience is Chinese-speaking early adopters who are willing to pay for a useful household tool. The design should avoid assumptions that block future overseas use, but the first release does not need full English localization, bank syncing, App Store subscription flow, or country-specific financial compliance beyond normal consumer app privacy and data handling obligations.

## Commercial Goals

The first commercial release is successful when a real user can complete this end-to-end path:

1. Register an account.
2. Create a household workspace.
3. Add household members and credit cards.
4. Import a bill draft from pasted text.
5. Review validation warnings and confirm the bill.
6. Assign or record repayment.
7. Receive reliable repayment reminders.
8. Review the monthly household credit card picture.
9. Export data.
10. Upgrade to Pro when Free limits are reached.

This flow is the minimum commercial spine. Features outside it should be deferred unless they directly increase trust, conversion, or retention.

## Subscription Model

The first pricing model should be Free plus Pro.

Free should allow a user to understand the product without turning it into a complete free substitute. Recommended Free limits are a small number of card holders, cards, monthly bill imports, and export attempts. Pro should unlock household collaboration, higher card and import limits, advanced reminders, report export, and deeper history.

The subscription system needs these capabilities:

- Plan definition for Free and Pro.
- Trial state with start and end dates.
- User or household-level entitlement check.
- Feature limits for card count, holder count, import count, export count, and advanced reminder settings.
- Graceful locked states when a user exceeds a limit.
- Manual Pro override for early customers, testing, and support.
- Upgrade prompts at natural friction points, such as adding more cards or confirming more imports.

The entitlement check must be enforced outside the UI. Frontend gating is useful for messaging, but the API layer must prevent over-limit writes.

## Household Collaboration

Household collaboration is the main paid value. The application should introduce a household workspace as the top-level commercial boundary. A household contains users, card holders, credit cards, bills, reminders, imports, and reports.

Roles should remain simple:

- Owner: manages subscription, household settings, members, cards, bills, and exports.
- Admin: manages household data but cannot change subscription ownership unless explicitly granted later.
- Member: sees only assigned card holder data and can record self-service actions.

The existing `users.role`, `card_holders.auth_user_id`, and RLS direction are a useful starting point, but the commercial product needs clearer household-level boundaries. The current admin/member model should evolve into household membership rather than relying only on one admin's managed card holders.

Required collaboration features:

- Create household during onboarding.
- Invite member by email.
- Bind invited user to a card holder profile.
- Show invitation status: pending, accepted, expired, revoked.
- Let members record repayment, benefit usage, and promo usage for their own data.
- Prevent members from changing base credit card and bill definitions.
- Let owners/admins see a household-wide view.
- Explain permission boundaries in the UI when actions are unavailable.

## Bill Import And Validation

Bill import is the second main paid value. The first release should focus on pasted bill text, email text, or SMS text. Image, PDF, and OCR import should remain future work until the text import flow is trusted.

The import flow should use drafts:

1. User pastes bill text.
2. Parser extracts bill month, amount, due date, minimum payment, statement period, transactions, bank/card hints, and confidence.
3. System suggests a matching card when possible.
4. Draft view shows extracted fields, transaction list, confidence, and warnings.
5. User fixes fields.
6. System checks duplicate bills, amount consistency, missing due date, invalid dates, negative totals, and unsupported currency.
7. User confirms the draft.
8. Confirmed data creates or updates the official bill and bill items.

Imported data must never skip confirmation. Recognition output should keep source text and confidence metadata so mistakes can be traced.

## Repayment And Reminders

The commercial version must make repayment responsibility explicit. A bill should have enough state to answer: who owns it, who has paid it, what amount remains, and when action is needed.

Required reminder capabilities:

- Due soon reminder.
- Due today reminder.
- Overdue reminder.
- Minimum payment risk hint.
- Household owner view across all members.
- Member view for personal bills only.
- User-level notification preferences.
- Read, dismissed, and history states.
- Deduplication by bill and reminder day.

The first paid version can start with in-app reminders and browser/PWA notifications. It does not need native push infrastructure if PWA notification reliability is acceptable for the test group. Reminder logic should be deterministic and auditable.

## Reports And Export

Reports should focus on household credit card review, not broad financial planning.

Required report views:

- Household monthly bill total.
- Pending repayment total.
- Paid amount.
- Overdue count.
- Card-level and member-level split.
- Credit limit utilization.
- Category trend when bill items have categories.
- Import and repayment completeness indicators.

Export should support CSV first. Excel can follow if users ask for it. Export filters should include month range, member, card, bank, bills, payments, bill items, benefit usages, and promo usages.

## Benefits And Promo Opportunities

Benefits and promos should support retention but should not dominate the first paid proposition.

The commercial release should include:

- Available benefits and promos by card.
- Remaining quota and usage history.
- Expiring soon indicators.
- Simple opportunity priority based on expiry, quota, and usage.
- Card detail aggregation.

The recommendation engine should remain rule-based in the first release. It can answer "which card should I use for this purchase" with transparent reasons, but it should not make financial advice claims or rely on opaque AI decisions.

## Commercial Operations

Small-scale paid use still needs a minimal operations surface. Without it, support and trust degrade quickly.

The first operations console should include:

- User list.
- Household list.
- Subscription and trial status.
- Manual Pro override.
- Card, holder, bill, and import counts.
- Recent import failures.
- Recent notification failures.
- Feedback messages.
- Basic support notes.

This console can be restricted to internal admin users and does not need complex role management in the first version.

## Trust, Privacy, And Account Controls

Because WorldCredit stores household financial data, commercial readiness requires visible trust controls.

Required trust features:

- Privacy policy.
- Terms of service.
- Clear statement that the app does not move money or initiate repayments.
- Account deletion request or self-service deletion.
- Household export before deletion.
- Sensitive error handling that does not leak other household data.
- Audit trail for important changes: member invite, card creation, bill confirmation, repayment record, export, subscription change, and account deletion.
- Backup and restore process for production data.

The product should avoid storing full card numbers. Existing last-four storage should remain the default.

## Architecture

The current application can continue using the existing mobile-first React pages, `lib/api/*` access layer, database migrations, and RLS-backed data protection. Commercialization should add bounded modules rather than spreading payment and household logic through existing feature files.

Recommended modules:

- `subscription`: plan definitions, entitlement checks, usage counters, trial state, manual overrides.
- `household`: workspace, membership, invitations, role checks, member binding.
- `imports`: bill draft creation, validation, confirmation, import history.
- `notifications`: reminder generation, delivery preferences, delivery history, deduplication.
- `reports`: household summary, export filters, CSV generation.
- `ops`: internal operations console APIs and pages.
- `audit`: append-only event recording for sensitive actions.

The most important boundary is entitlement enforcement. Any API that creates holders, cards, bill imports, exports, or advanced reminders must call the entitlement layer before writing data.

## Data Model Changes

Expected new or expanded data areas:

- `households`: owner, name, created_at.
- `household_members`: household_id, user_id, role, status, invited_email, accepted_at.
- `subscriptions`: household_id, plan, trial_start, trial_end, status, provider, provider_customer_id, current_period_end.
- `entitlement_overrides`: household_id, reason, expires_at, created_by.
- `usage_counters`: household_id, metric, period, value.
- `member_invites`: household_id, email, token hash, status, expires_at.
- `audit_events`: household_id, actor_user_id, event_type, entity_type, entity_id, metadata, created_at.
- `feedback_messages`: user_id, household_id, message, status, created_at.

Existing data tables should be associated with a household either directly or through card holders. The migration should avoid breaking current single-admin data; existing data can be migrated into a default household per admin user.

## Error Handling

Commercial flows should prefer recoverable errors:

- Over-limit writes return a structured limit error with current usage and upgrade target.
- Import parser failures preserve the raw text and ask the user to manually fill fields.
- Duplicate bill detection should block accidental duplicates but allow explicit replacement or merge in a later version.
- Notification delivery failures should be recorded and visible in operations.
- Member permission failures should explain the required role without exposing hidden data.

## Testing

Testing should focus on commercial risk:

- Entitlement limits for Free and Pro.
- Household member visibility and RLS behavior.
- Member self-service writes versus forbidden base-data edits.
- Bill import validation and confirmation.
- Duplicate bill detection.
- Reminder deduplication.
- CSV export correctness.
- Account deletion and data export.
- Migration from current single-admin data to household data.

End-to-end tests should cover the full commercial spine from signup through Pro-gated actions.

## Deferred Work

These features are intentionally out of scope for the first commercial release:

- Bank account syncing.
- Automatic repayment or money movement.
- Credit score, loan, investment, or insurance features.
- Native mobile app subscriptions.
- Full English localization.
- Enterprise multi-tenant white-label controls.
- High-accuracy image/PDF OCR.
- AI financial advisor.
- Complex budgeting, net worth, and savings goals.

## Release Sequence

Recommended implementation sequence:

1. Household data boundary and migration.
2. Membership, invitations, and role enforcement.
3. Subscription, trial, entitlement checks, and Free/Pro limits.
4. Text-based bill import drafts and validation.
5. Repayment responsibility and reminder reliability.
6. Household reports and CSV export.
7. Benefits/promos opportunity polish.
8. Minimal operations console.
9. Trust pages, deletion/export flow, audit events, and production readiness checks.

This sequence puts data boundaries before paid limits, because subscription gating is unsafe if household ownership and permissions are ambiguous.

