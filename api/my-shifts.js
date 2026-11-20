/* /api/my-shifts — staff self-service for Shift Maker (staff portal "My Shifts").

   Personal staff login only. Everything is scoped to the caller's own
   account id taken from the signed session — never from the request body —
   so nobody can read or file anything for a colleague. Only PUBLISHED
   shifts are ever returned; drafts do not exist from this endpoint's view.

   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD
        → { me, shifts, hours, leave, availability, requests, notifications, colleagues }
   POST { action: "leave" | "cancel-leave" | "availability" | "withdraw-availability"
                | "change" | "cancel-change" | "read" , ... } */
import { requirePermission, staffIdentity, hasPermission } from "./_auth.js";
import { boConfigured } from "./_bo-db.js";
import { requireRate } from "./_ratelimit.js";
import * as S from "./_shifts.js";
import * as E from "../assets/shift-engine.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
  if (!requirePermission(req, res, null)) return;
  const me = staffIdentity(req);
  if (!hasPermission(me, "shifts_self") && !hasPermission(me, "shifts_manage")) return res.status(403).json({ error: "forbidden" });
  if (me.id === "legacy-owner" || me.role === "backoffice")
    return res.status(403).json({ error: "My Shifts needs your own named staff login, not a shared key." });
  const actor = { id: me.id, name: me.name, role: me.role };
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      const today = E.todayBkk();
      const from = E.isDateStr(q.from) ? q.from : E.weekStartOf(today);
      const to = E.isDateStr(q.to) ? q.to : E.addDays(from, 41);
      if (to < from || E.bkkMs(to) - E.bkkMs(from) > 62 * E.DAY_MS) return res.status(400).json({ error: "range must be 0-62 days" });
      const [shifts, leave, availability, requests, notifications, employees, stores, settings] = await Promise.all([
        S.publishedShiftsFor(me.id, from, to), S.listLeave({ employeeId: me.id }), S.availabilityFor([me.id]),
        S.listRequests({ requesterId: me.id }), S.myNotifications(me.id), S.loadEmployees(), S.loadStores(), S.loadSettings(null)]);
      const self = employees.find((e) => e.id === me.id) || { id: me.id, name: me.name, role: me.role };
      const weeks = [];
      for (let w = E.weekStartOf(from); w <= to; w = E.addDays(w, 7)) {
        const [row] = E.weeklyHours(shifts, [self], w, settings);
        weeks.push({ weekStart: w, minutes: row.minutes, days: row.days, threshold: row.threshold });
      }
      return res.status(200).json({
        me: self, shifts, hours: weeks, leave, availability, requests, notifications,
        stores: stores.map((s) => ({ id: s.id, name: s.name })),
        // Names only, for picking a swap partner. No one else's schedule or hours.
        colleagues: employees.filter((e) => e.active && e.id !== me.id).map((e) => ({ id: e.id, name: e.name })),
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    // Per person, not per IP: staff share the shop Wi-Fi. Plenty for real use,
    // but a stuck button or a script cannot flood managers with requests.
    if (!(await requireRate(req, res, `myshifts:${me.id}`, 30, 600))) return;
    const b = req.body || {};
    switch (b.action) {
      case "leave": return res.status(200).json(await S.requestLeave(actor, me.id, b));
      case "cancel-leave": return res.status(200).json(await S.cancelOwnLeave(actor, b.id));
      case "availability": return res.status(200).json({ row: await S.addAvailability(actor, me.id, b) });
      case "withdraw-availability": return res.status(200).json(await S.withdrawAvailability(actor, b.id, { own: true }));
      case "change": return res.status(200).json({ request: await S.fileChangeRequest(actor, b) });
      case "cancel-change": return res.status(200).json(await S.cancelOwnRequest(actor, b.id));
      case "read": return res.status(200).json(await S.markNotificationsRead(me.id));
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    return S.sendError(res, e);
  }
}
