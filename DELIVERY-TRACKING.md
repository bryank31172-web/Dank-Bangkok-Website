# Delivery tracking

This feature is for explicitly approved food and ordinary merchandise orders.
New orders containing any other products keep the existing checkout flow.

## What customers see

Checkout opens a private link: Preparing -> On the way -> Completed.
On the way uses a 70/30 desktop split: Google map and driver information, with
profile photo, name, phone and Call now. Mobile puts the map above the driver
card. The page polls every 30 seconds without reloading Google Maps. Routes and
ETA come from Google Routes; unavailable routing never creates a fake ETA or
straight-line driving route. Location older than 90 seconds is clearly marked.
Completion stops polling and removes driver details and location. The Google
review button appears if a valid Google review URL has been configured.

## Enable in Vercel

1. Settings -> Environment Variables: set DELIVERY_ALLOWED_PRODUCT_IDS to
   comma-separated StoreHub SKU IDs for verified ordinary food/merchandise.
   The server checks live product names/categories; mixed orders are excluded.
2. Confirm durable storage: Supabase service-role credentials or Upstash.
   Tracking refuses to run on per-instance memory or after a storage failure.
3. Set GOOGLE_MAPS_BROWSER_KEY, restricted to your website domains, with Maps
   JavaScript API enabled. Set GOOGLE_MAPS_MAP_ID to your production map ID.
4. Set GOOGLE_MAPS_API_KEY server-side with Routes API enabled; it is never
   returned to the customer. Map rendering still works without Routes, but
   there will be no road route or arrival estimate.
5. Google Business Profile -> Ask for reviews -> copy link into
   GOOGLE_REVIEW_URL. No review destination is guessed.
6. Deployments -> Redeploy after setting variables.

## Staff workflow

Staff portal -> Orders -> open an eligible order -> Manage delivery tracking.
Enter driver name/phone, upload profile photo and confirm destination coordinates.
The checkout captures coordinates when the customer selects a Google Places
result. For a typed address, staff must confirm coordinates before assigning.
Copy the driver link and send it to the driver. Copy the customer link if the
customer needs to reopen tracking on another device. Links are private bearer
credentials and expire seven days after checkout. Reassignment rotates the
private driver credential and rejects the previous driver's updates.

## Driver workflow

Open the private driver link in an HTTPS browser. Start delivery -> allow GPS.
Use Open navigation to launch Google Maps. Keep the driver page open and phone
awake. Screen wake lock is requested when supported, but browser tracking cannot
guarantee updates with a locked phone or background app. Pause sharing stops GPS
and clears the visible location. Start delivery resumes sharing. Complete delivery
requires confirmation, ends tracking and marks the order completed in staff and
customer order-status views. Staff can also complete or cancel tracking.

## Privacy and storage

Credentials are carried in URL fragments and request headers, not API query
strings or referrer headers. Customer access cannot assign drivers or update GPS.
Staff uses existing authenticated orders permission. Coordinates and driver
updates use separate records so GPS cannot overwrite payment fields. Terminal
records take precedence over late GPS writes. After completion/cancellation,
no driver identity or location is returned. Latest GPS has a one-hour retention;
tracking records expire after seven days. Public order-number lookup exposes no
tracking credentials, driver profile or coordinates. Tracking pages/API are
no-store and excluded from the PWA cache.

## Verification

Run `node --test tests/delivery.test.js` for authorization, expiry, eligibility,
GPS validation, reassignment, stale updates, completion and storage failure.
Then test a configured eligible order with two phones: one customer and one
driver. Verify actual GPS, Google API access, calling, review destination and
background/locked-phone behavior before production use.
