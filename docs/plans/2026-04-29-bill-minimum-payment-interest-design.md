# Bill Minimum Payment And Interest Estimate Design

## Goal

Add bill-level repayment health so a user can see whether recorded repayments cover the minimum payment and what interest may be generated when a bill is not fully repaid.

## Scope

The first version keeps calculation in the application layer and does not add database fields or InsForge RPCs. The existing `bills.min_payment`, `bill_items`, and `payments` data are enough to support the feature.

## Rules

- Minimum payment coverage is based on recorded payments for the bill.
- A bill covers the minimum payment when `totalPaid >= bill.min_payment`.
- The uncovered minimum amount is `max(min_payment - totalPaid, 0)`.
- If `totalPaid >= bill.bill_amount`, estimated interest is `0`.
- Otherwise, estimated interest uses a unified daily rate of `0.0005`.
- Interest-bearing bill items are positive `purchase`, `fee`, `interest`, and `other` rows.
- `refund`, `payment`, and `adjustment` rows do not create new interest-bearing principal.
- Each interest-bearing item starts accruing from `transaction_date`, falling back to `post_date`, `statement_date`, `statement_end`, then `due_date`.
- Payments are sorted by `paid_at` and allocated to the earliest interest-bearing principal first.
- For each item, interest is accrued from its start date until the date a payment reduces it; any remaining principal accrues through the estimate date.

## UI

The bill detail screen adds a repayment health section near the bill summary. It shows:

- Minimum payment status: covered or not covered.
- The amount still needed to cover the minimum payment, when applicable.
- Estimated interest amount.
- Daily rate used for the estimate.
- A concise note when some bill items have missing transaction dates and fallback dates were used.

The section refreshes after recording a payment because the bill detail page already reloads bill, item, and payment data after successful repayment.

## Testing

Add focused unit tests for the calculation helper:

- Covered and uncovered minimum payment.
- Fully paid bills return zero estimated interest.
- Payments reduce the earliest principal first.
- Missing transaction dates fall back to bill dates and set an estimate warning flag.

Existing type check, unit tests, and production build remain the verification gate.
