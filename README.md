# AI Document Extraction Tool

A small pipeline that extracts structured data — customer names, dollar amounts, and addresses — from unstructured legal and real estate documents using an LLM constrained to a JSON Schema, with an accompanying evaluation harness to measure extraction accuracy against hand-labeled fixtures.

This project is a **proof of concept for evaluating the accuracy of a document extraction pipeline** — the goal was to build and validate an evaluation methodology (field-level accuracy measurement against ground truth), not to maximize extraction accuracy itself. The model choice reflects that: `gpt-5-mini` was selected for cost-effective iteration while building and testing the pipeline, not for its document-extraction power. Swapping in a stronger model is a natural next step once the evaluation methodology itself is validated.

## Problem

Documents like purchase agreements, leases, and deeds bury the data that matters — customer names, dollar amounts, addresses, categorized line items — inside free-form legal prose. Traditional approaches (regex, manual review) are brittle or slow. This project tests whether an LLM constrained to a strict schema can extract this data reliably, and — more importantly — builds the tooling to actually *measure* how reliably, at the individual field level, rather than assume it.

## Approach

The project has two parts:

**1. Extraction pipeline (`index.ts`)**
- Reads every document in an `input/` directory.
- Sends each document's text to an LLM (Azure-hosted OpenAI model) via a strict JSON Schema-constrained request, so the response is guaranteed to conform to the shape defined in `schema/document-extraction.schema.json`.
- The extraction instructions specifically extract customers (excluding banks/businesses), dollar amounts (each assigned a category like rental amount, principal, or security deposit), and addresses.
- Writes one JSON output file per input document to `output/`, preserving the source filename for traceability.

**2. Evaluation harness (`evaluate.ts`)**
- Compares every extracted output file against a corresponding hand-labeled fixture in `test/data/expected_output/`.
- Performs a deep, path-aware diff between actual and expected JSON, so mismatches are reported with the exact field path (e.g., `customers[0].name`) rather than a generic pass/fail.
- Aggregates accuracy **per field** (not just per document) by normalizing array indices, so it's possible to see that, say, dollar-amount categorization is weaker than name extraction even when overall accuracy looks fine.
- Prints a per-file accuracy percentage, a full per-field accuracy report sorted from weakest to strongest, and an overall accuracy percentage across the whole batch.
- Exits with a non-zero code when any file has a mismatch, so it can be wired into CI.

## Why a schema-constrained approach

Rather than prompting for JSON and hoping the model complies, or writing regex to clean up free-form output, the extraction call uses strict, schema-constrained structured output. This guarantees the response matches the defined shape on every call, which removes an entire class of parsing failures and makes the evaluation harness's job simpler and more reliable.

## Test Data

Ten synthetic legal/real estate documents were used as test fixtures, covering a range of document types and structural complexity:

- Purchase agreement
- Lease agreement
- Quitclaim deed
- Mortgage note
- Property settlement
- Commercial lease
- Power of attorney
- Estate distribution
- Rent-to-own agreement
- Escrow instructions

Each document has a hand-labeled expected-output fixture used as ground truth by the evaluation harness.

## Results

Getting to a trustworthy accuracy number took three iterations — and the process of getting there is arguably more informative than the final number itself.

**Iteration 1 — baseline: 93.22% (564/605 fields)**
The first full run looked solid on the surface, but the evaluation harness's per-field breakdown surfaced two weak fields: `addresses[].renterName` (14.81%) and `addresses[].ownerName` (74.07%). Digging in showed this wasn't really a model reasoning failure — `ownerName` and `renterName` were defined in the schema as `"type": "string"` only, with no `null` option. Under strict structured output, this left the model no valid way to express "no owner" or "no renter" other than substituting the literal string `"null"`, which the evaluation harness's exact-match comparison then flagged as wrong. A single accuracy number would have hidden this — the field-level breakdown is what made it visible.

**Iteration 2 — after the schema-only fix: 80.66% (488/605 fields)**
Adding `null` as an allowed type for the affected fields fixed `renterName` as expected (14.81% → 70.37%), but overall accuracy dropped sharply and unrelated fields regressed too — including `ownerName` itself, which fell to 18.52%. Investigating the drop surfaced two separate, previously-hidden issues: the hand-labeled expected-output fixtures had been making incorrect assumptions about which addresses counted as mailing addresses and who counted as owner vs. renter, and the model had no consistent standard for formatting fields like `country`. In other words, the "regression" wasn't really a regression — it was the schema fix removing a masking bug and exposing real problems in both the ground truth data and the extraction prompt that had been there all along.

**Iteration 3 — final: 97.02% (553/570 fields)**
Three fixes together resolved the underlying issues:
1. Corrected the hand-labeled expected-output fixtures to remove incorrect assumptions about mailing addresses and owner/renter identity.
2. Refined the extraction prompt to standardize fields like `country` and to correctly treat marital residences as mailing addresses where applicable.
3. Constrained the dollar-amount category field in the schema to a predefined set of values instead of open-ended text.

Full results:

| Document | Fields Correct | Accuracy |
|---|---|---|
| doc_01_purchase_agreement | 28/28 | 100% |
| doc_02_lease_agreement | 55/58 | 94.83% |
| doc_03_quitclaim_deed | 70/71 | 98.59% |
| doc_04_mortgage_note | 37/38 | 97.37% |
| doc_05_property_settlement | 62/62 | 100% |
| doc_06_commercial_lease | 42/50 | 84% |
| doc_07_power_of_attorney | 44/44 | 100% |
| doc_08_estate_distribution | 102/103 | 99.03% |
| doc_09_rent_to_own | 53/54 | 98.15% |
| doc_10_escrow_instructions | 60/62 | 96.77% |

**Overall: 553/570 fields matched (97.02%)**

### Per-field breakdown

Most fields now extract perfectly or near-perfectly:

| Field | Accuracy |
|---|---|
| customers[].name / email / phone / dateOfBirth | 100% |
| dollarAmounts[].currency | 100% |
| addresses[].{street,city,state,postalCode} | 100% |
| addresses[].renterName | 100% |
| customers[].mailingAddress.{street,city,state,postalCode,country,line2} | 100% |
| addresses[].{line2,type} | 96.3% |
| addresses[].country | 92.59% |
| dollarAmounts[].amount | 92.31% |
| customers[].mailingAddress | 90% |
| addresses[].ownerName | 88.89% |
| dollarAmounts[].category | 84.62% |

**What's still open:** `addresses[].ownerName` (88.89%) is the clearest remaining gap — some genuine owner/renter misattribution likely still exists even after the schema and ground-truth fixes, distinct from the null-serialization bug that dominated the earlier runs. `doc_06_commercial_lease` is now the weakest document (84%) and worth a closer manual look. `dollarAmounts[].category`, despite now being constrained to a predefined set of values, sits at 84.62% — lower than expected for an enum-constrained field, suggesting the category values themselves may need refinement rather than the constraint approach being wrong.

These three iterations are the actual point of this project: an evaluation harness is only useful if it's trusted enough to act on, and getting there meant questioning the extraction pipeline, the schema, the prompt, *and* the ground-truth labels — not assuming any one of them was correct by default.

## Setup

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Create a `.env` file with your Azure OpenAI credentials:
   ```
   AZURE_API_KEY=your-key-here
   AZURE_MODEL_DEPLOYMENT=gpt-5-mini-1
   ```
3. Place source documents in `input/`.
4. Place hand-labeled expected outputs in `test/data/expected_output/`, using the same filenames (with a `.json` extension) as the corresponding input documents.

## Usage

Run extraction on all documents in `input/`:
```
npx tsx index.ts
```

Run the evaluation harness against the latest extraction output:
```
npx tsx evaluate.ts
```

## What I'd improve with more time

- Investigate the remaining `addresses[].ownerName` gap (88.89%) directly — pull a few mismatched documents and confirm whether it's genuine misattribution or another edge case, now that the null-serialization and ground-truth issues are resolved.
- Look closely at `doc_06_commercial_lease`, the weakest-performing document at 84%, to understand what's structurally different about it.
- Revisit the `dollarAmounts[].category` enum values (84.62%) — an enum-constrained field performing below several free-text fields suggests the category set itself may not cleanly match how the source documents describe amounts.
- Re-run the same test set against a stronger model (e.g., Claude or a larger OpenAI model) now that the evaluation methodology and ground truth are both trustworthy, to see how much of the remaining error is model capability vs. schema/prompt design.
- Add prompt-level and fixture-level regression tracking, so future accuracy changes can be tied to specific prompt, schema, or ground-truth edits over time — this project's own history is a good example of why that traceability matters.
