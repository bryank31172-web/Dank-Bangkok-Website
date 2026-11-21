# Thai Cannabis Retail Compliance — Research Starting Point (NOT LEGAL ADVICE)

**This document does not substitute for a licensed Thai lawyer or a direct consultation with DTAM
(Department of Thai Traditional and Alternative Medicine) / Thai FDA. It is a starting point for
that conversation, built from secondary sources (law-firm blogs, cannabis-industry publications),
not the Royal Gazette or DTAM's own filings. Confidence is explicitly marked per claim below. Before
any compliance field in `bo_inventory_ledger` or elsewhere is finalized, Bryan should have this
reviewed by Thai counsel — the regulatory picture has changed direction multiple times since 2022 and
is still actively moving (see "Pending legislation" below).**

## What the research found (November 2026)

- **Core framework (medium confidence, multiple consistent sources):** Cannabis flower was
  reclassified as a controlled herb around June 2025. A Ministerial Notification (25 June 2025,
  Royal Gazette) reportedly reaffirmed this. Since then, dispensaries selling cannabis flower are
  reported to need a licensed practitioner on site able to issue **PT 33** prescriptions — i.e.
  cannabis flower sales are described as prescription-gated, not over-the-counter.
- **Recordkeeping/traceability (medium confidence, sources partly disagree on form numbers):**
  Dispensaries are reported to need to keep detailed records, variously described as:
  - Monthly inventory submissions (one source: **Phor.Tor.27** form, for both growers and dispensaries)
  - **PT28** reporting at the dispensary level
  - **PT33** documenting a patient's medical authorization/prescription
  - Traceability chain elements: cultivation license + batch number, processing/harvest records,
    transport records, prescription number + prescriber ID
  - Sourcing requirement: commercial cannabis flower reportedly must come from **GACP-certified**
    farms
- **Licensing changes (low-medium confidence, sources conflict on specifics):** Reports of two
  ministerial regulations taking effect around April 2026 tightening flower licensing criteria. Fee
  figures conflict between sources (฿1,500–5,000 cited); license validity period also conflicts
  across sources (1–3+ years). **Do not treat any specific fee or validity number here as reliable —
  check the figure on Bryan's own license directly.**
- **Pending legislation (confirmed as pending, not yet law):** A "Thailand Cannabis Control Bill
  2026" reportedly has Cabinet approval but is **not yet enacted**. Current obligations come from
  existing rules in force today, not this bill — but the bill is worth tracking since it may change
  recordkeeping requirements again.

## What this means for DANK BackOffice's design (if confirmed by counsel)

If the above holds up under a real legal review, the schema implication is small and additive, not a
redesign:

- `bo_inventory_ledger` would likely need optional fields for **batch/lot number** and a
  **prescription/authorization reference**, nullable so non-cannabis products (food, drinks,
  accessories) are unaffected. `DATABASE_SCHEMA.md` already flags this as a planned non-breaking
  addition.
- A monthly reporting view (matching whatever the real current form — Phor.Tor.27 and/or PT28 turns
  out to require) could be built on top of the existing ledger once the exact required fields are
  confirmed, the same way `reports.js` already builds sales-by-product on top of existing order data.
- The supplier/purchase-order model may need a **GACP-certification flag** on suppliers of cannabis
  flower specifically, if that sourcing requirement is confirmed.

**None of this is implemented yet.** It's deliberately left as a schema-ready-but-unbuilt gap rather
than guessed-at compliance logic, because getting this wrong has real regulatory consequences for
DANK, which AI research alone cannot be trusted to get right.

## Sources (secondary — verify against DTAM/Thai FDA directly)

- [Cannabis in Thailand 2026: how Bangkok dispensaries are adapting to the new medical-only rules](https://thethaiger.com/guides/cannabis/cannabis-thailand-2026-medical-rules)
- [Thailand's Medical-Only Cannabis Shift: What It Means for Cultivators and Dispensaries in 2025 - Cannavigia](https://www.cannavigia.com/blog-posts/thailands-medical-only-cannabis-shift-what-it-means-for-cultivators-and-dispensaries-in-2025)
- [Thailand Cannabis Licensing Rules 2026: Regulation Changes](https://thaicannamed.com/thailand-cannabis-licensing-rules-2026/)
- [Thailand's 2025 Cannabis Regulatory Overhaul - Formichella & Sritawat](https://fosrlaw.com/2025/thailand-2025-cannabis-regulations/)
- [Cannabis License Thailand 2026: Cost, Types and How to Apply](https://cannabisforthailand.com/business/cannabis-license-thailand/)
- [Thailand Cannabis Control Bill 2026 for Bangkok Dispensaries](https://thaicannamed.com/thailand-cannabis-control-bill-2026-dispensaries/)
- [Cannabis Dispensary Licence in Thailand For Shop Owners 2026](https://thaicannamed.com/cannabis-dispensary-licence-in-thailand/)
- [Thailand's 2025 U-Turn on Cannabis: Recriminalization, Prescription-Only Sales](https://www.cannabisregulations.ai/cannabis-and-hemp-regulations-compliance-ai-blog/thailand-2025-cannabis-recriminalization-compliance)
- [Thailand Cannabis Law: Complete Guide for 2025](https://thailand.themispartner.com/guides/thailand-cannabis-law-guide-2025/)
