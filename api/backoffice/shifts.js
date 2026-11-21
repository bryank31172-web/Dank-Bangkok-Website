/* /api/backoffice/shifts — Shift Maker management API.

   Who: the BackOffice session, or a personal owner/manager staff login
   (see SHARED_BACKOFFICE_PATHS in api/_auth.js). Every route checks a scope
   here on the server; the UI hiding a button is never the security boundary.
     shifts_manage   — read/edit drafts, copy, publish, approve requests, PDFs
     shifts_settings — templates, staffing targets, Shift settings
   Routing is by ?resource= so the whole feature costs one serverless function.
   Full reference: docs/dank-backoffice/SHIFT_MAKER.md. */
import { requirePermission, staffIdentity, hasPermission } from "../_auth.js";
import { boConfigured } from "../_bo-db.js";
import * as S from "../_shifts.js";
import * as E from "../../assets/shift-engine.js";

const { ShiftError } = S;
const actorOf = (req) => { const i = staffIdentity(req); return { id: i.id, name: i.name, role: i.role }; };
const need = (req, res, scope) => requirePermission(req, res, scope);
function dateParam(v, name) { if (!E.isDateStr(v)) throw new ShiftError(400, `${name} must be YYYY-MM-DD`); return v; }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured", detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
  const q = req.query || {}, b = req.body || {};
  const resource = String(q.resource || b.resource || "");
  try {
    if (!need(req, res, "shifts_manage")) return;
    const actor = actorOf(req);
    const identity = staffIdentity(req);
    const canSettings = hasPermission(identity, "shifts_settings");
    const settingsWrite = () => { if (!canSettings) throw new ShiftError(403, "Only the owner can change Shift settings, templates and staffing targets."); };

    switch (`${req.method} ${resource}`) {
      case "GET bootstrap": {
        const storeId = q.store ? String(q.store) : null;
        const [employees, stores, templates, requirements, settings] = await Promise.all([
          S.loadEmployees(), S.loadStores(), S.loadTemplates(), S.loadRequirements(null), S.loadSettings(storeId)]);
        return res.status(200).json({ employees, stores, templates, requirements, settings, me: actor, can: { manage: true, settings: canSettings } });
      }
      case "GET range": {
        const from = dateParam(q.from, "from"), to = dateParam(q.to, "to");
        if (to < from || E.bkkMs(to) - E.bkkMs(from) > 62 * E.DAY_MS) throw new ShiftError(400, "range must be 0-62 days");
        const fromMs = E.bkkMs(from) - E.DAY_MS, toMs = E.bkkMs(to) + 2 * E.DAY_MS;
        const [assignments, leave, availability, periods, pending] = await Promise.all([
          S.assignmentsInRange(fromMs, toMs), S.leaveInRange(fromMs, toMs), S.availabilityFor(),
          S.periodsInRange(from, to), S.listRequests({ status: "pending" })]);
        return res.status(200).json({ assignments, leave, availability, periods, pendingRequests: pending.length });
      }
      case "GET period": {
        const storeId = String(q.store || ""), week = dateParam(q.week, "week");
        const r = await S.periodReport(storeId, week);
        const history = r.period ? await S.publications(r.period.id) : [];
        return res.status(200).json({ period: r.period, validation: r.validation, dirty: r.dirty, history });
      }
      case "POST validate": {
        const p = S.cleanAssignmentInput(b.assignment || {}, { breakMinutes: 0 });
        p.id = b.assignment?.id;
        return res.status(200).json(await S.validateProposal(p));
      }
      case "POST assignment": return res.status(200).json(await S.createAssignment(actor, b));
      case "PATCH assignment": return res.status(200).json(await S.updateAssignment(actor, b));
      case "DELETE assignment": return res.status(200).json(await S.deleteAssignment(actor, { id: b.id || q.id, version: b.version ?? q.version }));
      case "POST copy-week": return res.status(200).json(await S.copyWeek(actor, { storeId: String(b.storeId || ""), fromWeek: b.fromWeek, toWeek: b.toWeek, apply: Boolean(b.apply), selected: b.selected }));
      case "POST publish": return res.status(200).json(await S.publishPeriod(actor, { storeId: String(b.storeId || ""), weekStart: b.weekStart, version: b.version, acknowledge: b.acknowledge }));

      case "GET templates": return res.status(200).json({ rows: await S.loadTemplates() });
      case "POST templates": case "PATCH templates": settingsWrite(); return res.status(200).json({ row: await S.saveTemplate(actor, b) });
      case "DELETE templates": settingsWrite(); return res.status(200).json(await S.retireTemplate(actor, b.id || q.id));
      case "GET requirements": return res.status(200).json({ rows: await S.loadRequirements(q.store ? String(q.store) : null) });
      case "POST requirements": case "PATCH requirements": settingsWrite(); return res.status(200).json({ row: await S.saveRequirement(actor, b) });
      case "DELETE requirements": settingsWrite(); return res.status(200).json(await S.retireRequirement(actor, b.id || q.id));
      case "GET settings": return res.status(200).json({ settings: await S.loadSettings(q.store ? String(q.store) : null) });
      case "PATCH settings": settingsWrite(); return res.status(200).json(await S.saveSettings(actor, b.storeId || null, b.settings || {}));

      case "GET leave": return res.status(200).json({ rows: await S.listLeave({ status: q.status || null }) });
      case "POST leave": { // a manager recording leave for someone (e.g. phoned in sick) — approved on entry, audited
        const employees = await S.loadEmployees();
        if (!employees.some((e) => e.id === b.employeeId)) throw new ShiftError(400, "Unknown employee.");
        return res.status(200).json(await S.requestLeave(actor, b.employeeId, b, { autoApprove: true }));
      }
      case "PATCH leave": return res.status(200).json(await S.decideLeave(actor, b));
      case "GET availability": return res.status(200).json({ rows: await S.listAvailability() });
      case "PATCH availability": return res.status(200).json({ row: await S.reviewAvailability(actor, b.id) });
      case "GET change-requests": return res.status(200).json({ rows: await S.listRequests({ status: q.status || null }) });
      case "PATCH change-requests": return res.status(200).json(await S.decideRequest(actor, b));

      case "GET print": {
        // The PDF renderer's data: validated server-side, draft or latest published.
        const storeId = String(q.store || ""), week = dateParam(q.week, "week");
        const weeks = q.type === "monthly" ? E.monthGrid(week).days.filter((_, i) => i % 7 === 0) : [E.weekStartOf(week)];
        const stores = await S.loadStores();
        const store = stores.find((s) => s.id === storeId);
        if (!store) throw new ShiftError(400, "Unknown store.");
        const out = { store, type: q.type || "weekly", weeks: [] };
        for (const w of weeks) {
          const r = await S.periodReport(storeId, w);
          out.employees = r.employees; out.settings = r.settings; out.requirements = r.requirements;
          let assignments = r.assignments, status = r.period?.publishedNo ? (r.dirty ? "Draft (unpublished changes)" : "Published") : "Draft";
          if (q.source === "published") {
            const pub = r.period?.publishedNo ? await S.publishedForPeriod(r.period.id) : [];
            assignments = pub; status = r.period?.publishedNo ? `Published v${r.period.publishedNo}` : "Not published";
          }
          out.weeks.push({ weekStart: w, status, assignments, validation: r.validation, acknowledged: r.period?.publishedNo ? (await S.publications(r.period.id))[0]?.acknowledged || [] : [] });
        }
        return res.status(200).json(out);
      }
      default:
        return res.status(404).json({ error: `unknown resource ${req.method} ${resource || "(none)"}` });
    }
  } catch (e) {
    return S.sendError(res, e);
  }
}
