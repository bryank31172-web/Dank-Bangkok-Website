# DANK website continuation — 2026-08-29

This branch continues from `claude/pos-app-connection-5eictn` at `26d1a3a5c303691b31eabc70451e8698838a73fc` (PR #35), which is currently the newest broad implementation branch.

## Hard source-of-truth rule

**Kamagra is intentionally excluded. Do not generate, map, publish, or restore a Kamagra product image.**

Any older handoff that lists Kamagra as a missing photo is stale and must not override this rule.

## Open work to reconcile

- PR #35: current broad feature branch (CRM first-order free joint at THB 500, member 10% discount, QR/print pages, Beam payment wiring and later handoff updates).
- PR #37: Google Maps review proof + full shop details shown directly in the hero. This work is still separate and must be reconciled without overwriting the newer PR #35 changes to `index.html`.
- Preserve all unrelated/newer work when reconciling the branches.

## Current code/data priorities

1. Reconcile PR #37 UI/review work into this continuation line safely.
2. Keep Kamagra excluded.
3. Treat Frezzer Jam / Freezer Jam as the only in-stock customer-visible flower-photo gap mentioned by the latest handoff, but re-run `/photo-audit.html` before changing image mappings because catalogue counts can move.
4. Verify the 27 remote strain cards against `strain-db.json` before changing strain facts.
5. Do not reintroduce the retired first-order free gram; the current first-order member gift is the free joint at the configured THB 500 threshold.
6. Preserve bar hiding, `shopData()` filtering, member pricing, volume ladder, wheel promo, analytics, QR pages, and existing order alerts.

## Environment / owner-side items still requiring verification

- Duplicate Vercel project `dankbkk-site-4jrn` should not be treated as the production target.
- Beam credentials/webhook, Shopify Admin credentials, and Gemini key must be verified in the active Vercel project before claiming those integrations are live.
- Telegram status must be verified from the current `/api/health`; older PR text saying it is broken conflicts with newer branch handoff text saying it was fixed.

## Safety for the next agent

Do not merge PR #35 and PR #37 blindly in arbitrary order. Both touch `index.html`. Use this continuation line as the reconciliation base, retain the newer broad changes from PR #35, then port only the intended Google-review/full-shop-details changes from PR #37 and re-test mobile, desktop, age gate, product shelf, checkout, staff console, and `/api/health` before merge.
