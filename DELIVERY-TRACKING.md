# Delivery tracking

This feature is for explicitly approved food and ordinary merchandise orders.
New orders containing any other products keep the existing checkout flow.

## What customers see

For a browser-only walkthrough without an order or real rider, open
`/delivery.html?demo=1`. Use Start delivery, Next location (20 sample positions),
Complete delivery and Restart test. Only public map configuration and a fixed public Google road route are fetched;
no order records, phone GPS or notifications are used. The route is cached for
five minutes and rate limited to ten requests per five minutes. This previews
the customer stages and Google map; positions and ETA are simulated.

Checkout opens a private link: Preparing -> On the way -> Completed.
On the way uses a Wayfinder map with a rounded rider information panel, with
profile photo, name and phone. Call now dials the DANK BKK shop at
084 162 0610. Mobile puts the map above the driver
card. The page polls every 45 seconds without reloading Google Maps. Routes and
ETA come from Google Routes; unavailable routing never creates a fake ETA or
straight-line driving route. Location older than 90 seconds is clearly marked.
Completion stops polling and removes driver details and location. The
completion screen shows the order summary and Back to shop; no review is requested.

## Enable in Vercel

1. Staff portal -> Orders -> Delivery products: select eligible food/ordinary
   merchandise from the existing live POS/database catalog and press Save products.
   Selections persist in the connected database. Mixed orders are excluded.
   An empty saved selection disables new tracking. The legacy
   DELIVERY_ALLOWED_PRODUCT_IDS environment variable is only a fallback before
   the first database selection is saved. Bundled/demo catalogs cannot enable tracking.
2. Confirm durable storage: Supabase service-role credentials or Upstash.
   Tracking refuses to run on per-instance memory or after a storage failure.
3. Set GOOGLE_MAPS_BROWSER_KEY, restricted to your website domains, with Maps
   JavaScript API enabled. Set GOOGLE_MAPS_MAP_ID to your production map ID.
4. Set GOOGLE_MAPS_API_KEY server-side with Routes API enabled; it is never
   returned to the customer. Map rendering still works without Routes, but
   there will be no road route or arrival estimate.
5. No Google review URL is required. Delivery ends at the completed screen.
6. Deployments -> Redeploy after setting variables.

## Product connection

The picker uses the existing shared menu service: the saved POS/database feed,
configured live feed, or StoreHub. It does not create another product catalog or
modify product price/stock. Product selections use the durable `delivery:products`
record. Editing selections requires the existing products permission; delivery
assignment continues to require orders permission. New orders are validated
against the current live catalog, so deleted or newly unsupported products cannot
qualify using stale selections or customer-provided names/categories.

## Staff workflow

### LINE group dispatch

For eligible tracked orders, the saved order now creates tracking before the LINE
notification. The group receives the order details plus two buttons: Check your
delivery (customer tracking) and Choose rider (an in-group picker). The picker
shows only registered, active staff with a valid phone and Rider on shift enabled.
After selection, the assigned rider receives their private Start delivery / Pause
sharing / Complete delivery link in a direct LINE message; the group gets an
assignment confirmation. Private rider credentials never appear in the group.

One-time setup: the LINE Official Account needs Messaging API, a valid webhook at
`https://www.dankbangkok.com/api/line-webhook`, channel token/secret and membership
in the staff group identified by LINE_TO. Each dispatcher and rider adds the OA
as a friend and sends `rider id` in a private chat to retrieve their LINE user ID.
A manager opens Staff portal → Orders → LINE riders, enters those IDs against
existing staff accounts, and marks the available riders on shift. Set staff phone
numbers in Staff management. Availability is explicit here and does not require
the rider to keep the staff portal open. Turn the setting off when their shift ends.

Only registered staff with orders permission can select riders, and only from the
configured group. An atomic claim prevents simultaneous group selections from
assigning multiple riders. Reassignment uses the existing staff portal, which
rotates the previous private token. After a failed direct send, tap Choose rider
again and select the assigned rider to retry with the same LINE retry key. Order
saving and customer checkout continue even if LINE notifications fail.

The browser demo previews tracking only; it does not send LINE messages. Live
dispatch requires the above account and group setup and a configured eligible
order. Automated tests use simulated LINE requests and do not contact real staff.

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

Run `node --test tests/delivery*.test.js` for authorization, expiry, eligibility,
GPS validation, reassignment, stale updates, completion and storage failure.
Then test a configured eligible order with two phones: one customer and one
driver. Verify actual GPS, Google API access, calling, completion screen and
background/locked-phone behavior before production use.

## Route map presentation

Customer and rider pages share the reference-style map: destination pill, red
destination pin, motorcycle marker, outlined green road route and green time /
distance badge. Desktop keeps the 70/30 map and rider-panel split; mobile uses a
70svh map with a rounded white information panel. The actual remaining route is
computed from each accepted rider GPS update every 45 seconds. Stale GPS hides
the route and estimate, and pause/completion removes the rider route. The driver
page refreshes its route after sending GPS and keeps the existing Start / Pause /
Complete and Open navigation controls. Map failures do not disable those controls.

The browser demo uses a real Google road route from the public Sathorn shop
coordinates to Siam Paragon. Its rider moves through twenty simulated points
on that geometry, shortening the displayed route. It never requests phone GPS,
creates an order, or sends LINE messages. Production route geometry and distance
come from Google Routes; failure never invents a road route.

## Delivery setup and Wayfinder

Staff portal → Orders → Delivery setup runs manager-only checks for durable
storage write/read, eligible products, Google Routes, LINE bot token and
registered on-shift riders. It sends no notifications. LINE webhook delivery,
group membership and friendship still require a real dispatch test. The panel
includes a two-phone checklist. Configuration checks never mark that physical
test completed.

Customer and driver basemaps now use MapLibre GL JS 4.7.1 and PMTiles 4.3.0
from pinned CDN URLs. ELEMNT Wayfinder light/dark styles are selected with
the map toggle. PMTiles is registered before map creation. OpenStreetMap and
Protomaps attribution stays at bottom right, with Powered by ELEMNT at bottom
left. Basemap rendering does not require GOOGLE_MAPS_BROWSER_KEY or a map ID.
Google Places checkout and server-side Google Routes retain their existing
configuration. Style changes restore the latest route without reviving paused
or completed locations. Guide: https://carto.elemnt.earth/USE.md.

## Reference delivery panel and departure photo

The customer journey now uses a full map with floating back/delivery/You pills,
blue rider and red destination pins with white location labels, a green road
route and ETA badge. On phones the rounded rider panel sits below the map.
On desktop it floats over the lower-left map corner. It shows rider profile,
arrival estimate, departure photo preview, shop call icon and order details;
there is no vehicle selection, cash/offer selector or booking action.

Before starting a new tracked order, the assigned rider uploads a departure
photo on their private page. The phone resizes and exports a JPEG through canvas
without EXIF metadata. The server limits the encoded size, rate limits uploads,
checks driver credentials and stores it separately per assignment. The customer
can open the full photo only through the private tracking API. Reassignment
clears the old photo, completion/cancellation removes customer access, and
storage expires no later than the tracking record. Existing legacy orders may
start without the new requirement. The demo uses a labeled illustration rather
than a real rider photo.


### Traffic and remaining route (October 2026)

Google Routes now requests `TRAFFIC_ON_POLYLINE` and returns normalized speed intervals with the private rider location. The customer Wayfinder overlay uses green (normal), amber (slow), and red (traffic jam). Without traffic intervals, the route stays green; it does not invent congestion. Google traffic-aware polyline requests have a higher billing tier.

Passed geometry is clipped at the nearest route projection within 100 metres. Progress only advances on the same polyline to avoid GPS jitter restoring passed sections. New Google route geometry resets that projection. The scooter animation updates clipping between received fixes, and stale, paused or terminal deliveries remove the route.

After Start delivery, the rider page loads Google Maps JavaScript using the existing public `GOOGLE_MAPS_BROWSER_KEY` from `/api/maps-config`. Maps JavaScript API must be enabled and the browser key must allow the production and preview referrers. The server Routes key is never exposed. The rider map shows Google live traffic, destination, scooter and remaining route; dragging stops following until Recenter. Location sharing still runs every 45 seconds with the page open and phone awake. Pause/completion clears overlays. A Google loading failure retains Wayfinder and the external navigation button.

This is an in-page map and route viewer. Spoken turn-by-turn navigation uses the Google Maps app button. Paired demos use the same fixed public road route and provider traffic snapshot with simulated rider progress; no real GPS, orders or LINE messages are sent.


### Rider customer sheet and cost estimate

The rider sheet fills the bottom of the screen and can be dragged by its handle or expanded/collapsed by tapping it. Starting delivery collapses it to 200px. It shows the customer name and a circular call action using the authenticated order contact. Customer contact is exposed only to the assigned rider/staff, validates telephone characters, and is cleared on completion/cancellation. Demo customer call is disabled because no real customer number is used.

As of 7 October 2026, traffic-on-polyline requests trigger Compute Routes Enterprise ($15/1,000 requests; 1,000 free/month). Dynamic Maps is $7/1,000 loads with 10,000 free/month. Link creation and customer polling do not themselves invoke Google. One 30-minute trip at 45-second route updates is about 41 requests plus one rider map load ($0.622 before any applicable free allowance). At a hypothetical 90-second interval it is about 21 requests plus one map load ($0.322). This is an estimate excluding checkout Places, taxes, repeated page loads, retries and other account usage. No interval change was made when answering the conditional pricing question.

Official pricing: https://developers.google.com/maps/billing-and-pricing/pricing
Enterprise traffic trigger: https://developers.google.com/maps/billing-and-pricing/sku-details#routes-compute-routes-enterprise

Preview Google Maps currently requires authorizing the exact preview origin in the browser key's website referrers. The server traffic route returned actual NORMAL, SLOW and TRAFFIC_JAM intervals in live preview testing. A rejected browser referrer switches back to Wayfinder instead of leaving a broken Google map.
