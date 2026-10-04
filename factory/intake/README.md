# Universal Intake v1

First isolated module for Automation Factory v2. It does not replace Money Scout and does not change production routes.

## v1 contract
- Detect common spreadsheet/PDF/image/document/structured/archive inputs.
- Classify business documents such as invoice, purchase order, price list, refund, order and inventory.
- Map heterogeneous English/Korean headers into canonical fields.
- Produce confidence scores and a review gate instead of silently guessing.
- Normalize already-parsed rows into the canonical schema.
- Add only new D1 table definitions in `schema.sql`; integration into the production Worker comes after tests.

## Important boundary
Binary parsing/OCR is deliberately adapter work for the next layer. This core decides what a file is, how extracted headers map, and whether a human review is required. PDF/image text extraction must feed this module and must not bypass confidence/QC.
