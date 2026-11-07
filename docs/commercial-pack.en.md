# Vaultify Audit — commercial pack (English)

This note is a sales hypothesis for Hassan to edit. It is not evidence of demand, willingness to pay, customer results, or competitor positioning. No customer is named because none has been signed. Opening this repository does not grant a license.

## Who might buy this, as a hypothesis

A finance manager or accounts-payable controller at a company that already exports supplier invoices to CSV and reviews possible duplicates in a spreadsheet before payment. The hypothesized pain is a second payment of the same supplier invoice when the review depends on memory and unsorted files. That pain is a hypothesis, not a measured market.

Vaultify Audit is a pilot workspace for that review. It is not an accounting system, a payment product, or a fraud verdict.

## Five-minute demo

Use the synthetic demo only. Say out loud that the password is public and this is not production authentication.

1. Open the app and choose **Open the synthetic demo**. Point at the banner: fictional invoices, no payments, not production sign-in.
2. On the overview, read three separate figures from the fictional file:
   - Potential duplicate exposure: **SAR 2,905.00** and **EUR 1,000.00**. This is exact supplier key + normalized invoice number + same currency. One copy of each group is treated as the kept invoice and is not counted again.
   - Suspicious proximity: **SAR 2,640.00**. Different invoice numbers inside the date window. This is not included in the figure above.
   - Recorded recovery: **No recorded recovery.** Paid status is not counted as money recovered.
3. Open **Acme Trading / INV-100**. Show the three source rows, the reasons, and the label that this is not a fraud finding. Exposure on that case is **SAR 2,000.00** (two extra copies of 1,000.00).
4. Mark it a false positive with a comment. Return to the overview. Potential duplicate exposure for SAR falls to **905.00**. EUR and the proximity figure stay put. Recorded recovery stays empty.
5. Export findings. The file is a review record. It does not pay an invoice.

If a row is a credit, installment, recurring invoice, cancelled invoice, or missing a supplier or invoice number, it is excluded from exposure. A USD copy of a SAR invoice is not matched to it.

## Scoped paid pilot, proposed

These prices are offers Hassan may make. They are not a market study and they do not show that a buyer will pay them.

Both options are a fixed pilot for one company workspace, using CSV exports the buyer already has. Hassan keeps ownership of the software. Any use by the buyer requires a separate written agreement that Hassan chooses. Nothing in this repository is that agreement. Exclusivity, if any, is only what that agreement states.

### Illustrative option A — 10,000 USD

Proposed scope:

- Deploy the existing pilot on a server the buyer or Hassan controls, with HTTPS in front of it.
- One workspace, owner plus up to five reviewer or read-only users.
- Import template, field mapping, duplicate and proximity review, decisions, audit log, and CSV findings export.
- A working session with the buyer’s own sample export, using their chosen date format and amount format. Ambiguous values are rejected, not guessed.
- Short written limits: no bank file, no ERP write-back, no tax opinion, no fraud opinion, no compliance certification.

Proposed acceptance:

- The buyer’s reviewer can complete the same path as the demo on their own CSV: template or mapped import, open a case, record a false positive or a confirmation, and download findings.
- A second workspace or user outside that company cannot read the export.
- Exposure totals change only when the underlying rows or a review decision changes, and recorded recovery stays zero until someone enters an amount.
- Hassan and the buyer sign a punch list of defects against this scope. Cosmetic wishes outside the list are not acceptance failures.

### Illustrative option B — 15,000 USD

Option A, plus:

- A second working session to adjust the date window and amount tolerance with the buyer, and to re-check the queue after that change.
- A short administrator handover: backup of the SQLite file, how to delete invoice data, how to add a user, and what the audit log does not contain.
- One round of label or mapping adjustments for columns in the buyer’s export, limited to the fields the pilot already stores.

Acceptance is the same as option A, plus the backup and deletion steps run once on a copy of the pilot data.

Out of scope for both options: live accounting connections, payment files, automatic recovery, OCR, SSO, a public marketing site, and any claim of SOC 2, ISO, tax compliance, or fraud prevention.

## Licensing

Hassan retains control of licensing and exclusivity. This pack does not give the reader, a prospect, or a contributor the right to copy, sell, or relicense the product.
