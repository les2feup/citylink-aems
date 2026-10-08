// Structural checks of deployment interfaces and contracts, not firmware behaviour.
// C1/C2: W3C TM/TD JSON Schemas (JSON-LD and runtime conformance not checked).
// C3: registration/update paths and hazard reachability through typed links.
// C4: connected producer/consumer contracts, priority domains/order, configuration identity.
// C5: declared optional scheduling; TRIAGE/4 constraints only for its specialization.
// C6: witness messages, boundary rejection, contextual assignments and official CAP XSD.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tdValidator, tmValidator } from "@thing-description-playground/core";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { validateXML } from "xmllint-wasm";
import { ROOT } from "./resolve.ts";
import { fillPlaceholders } from "./instantiate.ts";
import { contractErrors } from "./contracts.ts";

export type Result = { id: string; ok: boolean | null; msg: string };
export type Rec = (id: string, ok: boolean | null, msg: string) => void;

export function walk(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), suffix) : e.name.endsWith(suffix) ? [join(dir, e.name)] : []);
}
const silent = () => {};
const opts = { checkDefaults: false, checkJsonLd: false };
export const rel = (f: string) => f.replace(ROOT + "/", "");

export async function c1(rec: Rec, scenarioModels: string[] = []) {
  for (const f of new Set([...walk(join(ROOT, "ThingModels"), ".tm.json"), ...scenarioModels])) {
    const r = await tmValidator(readFileSync(f, "utf8"), silent, opts);
    rec("C1", r.report.schema === "passed", `${rel(f)}: schema ${r.report.schema}`);
  }
}
export async function c2(rec: Rec, tds: string[]) {
  for (const f of tds) {
    const r = await tdValidator(readFileSync(f, "utf8"), silent, opts);
    rec("C2", r.report.schema === "passed", `${rel(f)}: schema ${r.report.schema}`);
  }
}

// ---- scenario graph ------------------------------------------------------------------------

const byType = (tds: any[], t: string) => tds.filter((d) => [].concat(d["@type"]).includes(t));
const linksOf = (d: any, rel: string): any[] => (d.links ?? []).filter((l: any) => l.rel === rel);
const factors = (d: any): string[] => d?.hazardFactors ?? [];
const shared = (a: any, b: any) => factors(a).filter((f) => factors(b).includes(f));

// Resolves a link href (urn:aems:<id>#<JSON pointer>) to its Thing and affordance.
// A dangling target is returned as an error so the calling check records a failure.
type Target = { thing?: any; node?: any; ptr: string; err?: string };
function linked(tds: any[]) {
  const byId = new Map(tds.map((d) => [d.id, d]));
  return (href: string): Target => {
    const [id, ptr = ""] = href.split("#");
    const thing = byId.get(id);
    if (!thing) return { ptr, err: `link target ${id} not in scenario` };
    const node = ptr.split("/").filter(Boolean).reduce((o: any, k) => o?.[k], thing);
    return node === undefined ? { ptr, err: `affordance ${href} not found` } : { thing, node, ptr };
  };
}
const report = (rec: Rec, id: string, what: string, errs: string[]) =>
  rec(id, errs.length === 0, `${what}${errs.length ? ": " + errs.join("; ") : ""}`);

const isAlarm = (t: Target) => t.ptr.startsWith("/events/") && t.node?.data?.properties?.messageClass?.const === "alarm";

// The EMUs to which an EMC forwards the alarms of sensing EDU `s`, with their dispatch target.
function dispatchedEmus(tds: any[], s: any) {
  const at = linked(tds);
  return byType(tds, "AemsControllerTM")
    .filter((e) => linksOf(e, "consumes").some((l) => l.href === `${s.id}#/events/alarm`))
    .flatMap((e) => linksOf(e, "dispatchesTo").map((l) => at(l.href)))
    .filter((t) => !t.err && [].concat(t.thing["@type"]).includes("AemsMitigationTM"));
}

// Only valid registration links identify configuration producer/consumer pairs.
function registrations(tds: any[], s: any): Target[] {
  const at = linked(tds);
  return linksOf(s, "registersWith").map((l) => at(l.href)).filter((t) =>
    !t.err && t.ptr === "/actions/configure" && byType([t.thing], "AemsControllerTM").length > 0);
}

function priorityCompatible(producer: any, consumer: any): string[] {
  const p = producer.priorityContract, c = consumer.priorityContract;
  return [...contractErrors(p), ...contractErrors(c),
    ...compatible(p?.schema, c?.schema, "/priority"),
    ...(p?.order === c?.order ? [] : [`priority order ${p?.order} != ${c?.order}`])];
}

// ---- C3 ------------------------------------------------------------------------------------

export function c3(rec: Rec, tds: any[]) {
  const at = linked(tds);
  for (const s of byType(tds, "AemsSensingEduTM")) {
    const links = linksOf(s, "registersWith");
    const regs = registrations(tds, s);
    report(rec, "C3", `${s.id} registration`,
      links.length === 1 && regs.length === 1 ? [] : ["require exactly one registersWith link to an EMC configure action"]);
    for (const t of regs) {
      const e = t.thing;
      rec("C3", linksOf(e, "updatesPriority").some((l) => l.href === `${s.id}#/actions/updatePriority`),
        `${e.id} must update its registered EDU ${s.id}`);
      rec("C3", linksOf(e, "consumes").some((l) => l.href === `${s.id}#/events/alarm`),
        `${e.id} must consume the alarms of its registered EDU ${s.id}`);
    }
    const consumed = byType(tds, "AemsControllerTM").some((e) => linksOf(e, "consumes").some((l) => l.href === `${s.id}#/events/alarm`));
    const emus = dispatchedEmus(tds, s);
    for (const f of factors(s)) {
      const reach = emus.filter((t) => factors(t.thing).includes(f)).map((t) => t.thing.id);
      rec("C3", reach.length > 0, `${s.id} factor '${f}' ${reach.length ? `reaches ${reach.join(", ")}`
        : consumed ? "is not dispatched to any EMU serving it" : "alarm is not consumed by any EMC"}`);
    }
  }
  for (const e of byType(tds, "AemsControllerTM"))
    for (const l of linksOf(e, "updatesPriority")) {
      const t = at(l.href);
      report(rec, "C3", `${e.id} updatesPriority ${l.href}`, t.err ? [t.err]
        : t.ptr !== "/actions/updatePriority" || !byType([t.thing], "AemsSensingEduTM").length
          ? ["update must target a sensing EDU updatePriority action"]
          : registrations(tds, t.thing).some((r) => r.thing.id === e.id) ? [] : ["target EDU is not registered with this EMC"]);
    }
  for (const u of byType(tds, "AemsMitigationTM"))
    for (const l of linksOf(u, "commands")) {
      const t = at(l.href);
      report(rec, "C3", `${u.id} commands ${l.href}`, t.err ? [t.err]
        : shared(u, t.thing).length ? [] : [`no hazard factor in common (${factors(u)} vs ${factors(t.thing)})`]);
    }
}

// ---- C4 ------------------------------------------------------------------------------------

// Producer schema satisfies consumer schema: every field the consumer requires is produced
// as required, with the same type, compatible const/enum and compatible numeric bounds.
export function compatible(prod: any = {}, cons: any = {}, path = ""): string[] {
  const p = path || "/";
  const errs: string[] = [];
  if (cons.type && prod.type !== cons.type && !(prod.type === "integer" && cons.type === "number")) errs.push(`${p}: type ${prod.type} != ${cons.type}`);
  if (cons.const !== undefined && prod.const !== cons.const) errs.push(`${p}: const ${prod.const} != ${cons.const}`);
  if (cons.enum) {
    const pv = prod.const !== undefined ? [prod.const] : prod.enum;
    if (!pv || pv.some((v: any) => !cons.enum.includes(v))) errs.push(`${p}: values ${JSON.stringify(pv)} not within ${JSON.stringify(cons.enum)}`);
  }
  if (cons.minimum !== undefined && !(prod.minimum >= cons.minimum)) errs.push(`${p}: minimum ${prod.minimum} below ${cons.minimum}`);
  if (cons.maximum !== undefined && !(prod.maximum <= cons.maximum)) errs.push(`${p}: maximum ${prod.maximum} above ${cons.maximum}`);
  if (cons.type === "object") {
    for (const k of cons.required ?? []) {
      if (!(prod.required ?? []).includes(k)) errs.push(`${path}/${k}: required by consumer, not guaranteed by producer`);
      else errs.push(...compatible(prod.properties?.[k], cons.properties?.[k], `${path}/${k}`));
    }
    if (cons.additionalProperties && typeof cons.additionalProperties === "object")
      errs.push(...compatible(prod.additionalProperties, cons.additionalProperties, `${path}/*`));
  }
  return errs;
}

// A message schema narrowed to the hazard factors a given edge can carry.
function narrow(schema: any, fs: string[]) {
  const s = structuredClone(schema);
  if (s?.properties?.hazardFactor) s.properties.hazardFactor.enum = fs;
  return s;
}

// First difference between two schemas, ignoring title and description (annotations).
function schemaDiff(a: any, b: any, path = ""): string | undefined {
  if (a === b) return;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b))
    return `${path || "/"}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== "title" && k !== "description"));
  for (const k of keys) {
    const d = schemaDiff(a[k], b[k], `${path}/${k}`);
    if (d) return d;
  }
}

const LINEAGE = ["priority", "deviceId", "zone", "hazardFactor"];

export function c4(rec: Rec, tds: any[]) {
  const at = linked(tds);
  for (const d of tds) report(rec, "C4", `${d.id} priority contract`, contractErrors(d.priorityContract));
  for (const e of byType(tds, "AemsControllerTM")) {
    const alarms = linksOf(e, "consumes").map((l) => ({ l, t: at(l.href) }));
    for (const { l, t } of alarms) if (t.err) report(rec, "C4", `${e.id} consumes ${l.href}`, [t.err]);
    for (const { l, t } of alarms.filter((a) => !a.t.err))
      report(rec, "C4", `${l.href} -> ${e.id} priority domain/order`, priorityCompatible(t.thing, e));
    for (const d of linksOf(e, "dispatchesTo")) {
      const u = at(d.href);
      if (u.err) { report(rec, "C4", `${e.id} dispatchesTo ${d.href}`, [u.err]); continue; }
      for (const { l, t } of alarms.filter((a) => !a.t.err && isAlarm(a.t))) {
        const fs = shared(t.thing, u.thing);
        if (fs.length) report(rec, "C4", `${l.href} -> ${d.href} [${fs}]`, [
          ...compatible(narrow(t.node.data, fs), u.node.input), ...priorityCompatible(t.thing, u.thing)]);
      }
    }
    const out = e.actions?.configure?.output;
    for (const s of byType(tds, "AemsSensingEduTM").filter((s) => registrations(tds, s).some((r) => r.thing.id === e.id))) {
      const errs = (out?.required ?? []).flatMap((k: string) =>
        s.properties?.[k] === undefined ? [`/${k}: no EDU property receives it`] : compatible(out.properties[k], s.properties[k], `/${k}`));
      report(rec, "C4", `${e.id} configure output -> ${s.id} properties`, errs);
      const input = s.actions?.updatePriority?.input;
      const diff = input === undefined ? "updatePriority input missing" : schemaDiff(out, input);
      report(rec, "C4", `${e.id} configure output identical to ${s.id} updatePriority input`, diff ? [diff] : []);
    }
  }
  for (const u of byType(tds, "AemsMitigationTM"))
    for (const l of linksOf(u, "commands")) {
      const a = at(l.href);
      if (a.err) continue; // reported by C3
      const fs = shared(u, a.thing), src = u.actions?.handleAlarm?.input ?? {}, dst = a.node.input ?? {};
      const prod = { type: "object", required: src.required, properties: narrow(src, fs).properties };
      const cons = { type: "object", required: LINEAGE.filter((k) => (dst.required ?? []).includes(k)), properties: dst.properties };
      report(rec, "C4", `lineage ${u.id} handleAlarm -> ${l.href} [${fs}]`, [...compatible(prod, cons), ...priorityCompatible(u, a.thing)]);
    }
}

// ---- C5 ------------------------------------------------------------------------------------

export function c5(rec: Rec, tds: any[], scheduling: string) {
  const at = linked(tds);
  const schedulers = byType(tds, "AemsSchedulerTM");
  if (scheduling === "none") {
    if (schedulers.length || tds.some((d) => linksOf(d, "schedules").length))
      rec("C5", false, "scheduling=none forbids scheduler instances and schedules links");
    else rec("C5", null, "not applicable: deployment explicitly declares scheduling=none");
    return;
  }
  if (scheduling !== "required") { rec("C5", false, "scheduling must be explicitly none or required"); return; }
  rec("C5", schedulers.length > 0, "scheduling=required needs a scheduler instance");
  const scheduled = new Set(schedulers.flatMap((x) => linksOf(x, "schedules").map((l) => l.href)));
  for (const s of byType(tds, "AemsSensingEduTM"))
    for (const [ev, event] of Object.entries<any>(s.events ?? {})) {
      if (!["monitoring", "alarm"].includes(event.data?.properties?.messageClass?.const)) continue;
      const href = `${s.id}#/events/${ev}`;
      rec("C5", scheduled.has(href), `${href} ${scheduled.has(href) ? "is scheduled" : "has no deployment scheduler"}`);
    }
  for (const sch of schedulers) {
    rec("C5", linksOf(sch, "schedules").length > 0, `${sch.id} must schedule at least one event`);
    for (const l of linksOf(sch, "schedules")) {
      const t = at(l.href);
      report(rec, "C5", `${l.href} -> ${sch.id} schedulingInput`, t.err ? [t.err]
        : !t.ptr.startsWith("/events/") ? ["only events cross the fog queue; request-response affordances must not be scheduled"]
        : [...compatible(t.node.data, sch.schedulingInput), ...priorityCompatible(t.thing, sch)]);
    }
    if (byType([sch], "AemsTriage4SchedulerTM").length) {
      const c = sch.priorityContract, min = c?.schema?.minimum, max = c?.schema?.maximum;
      const tH = sch.properties?.thetaHigh?.const, tS = sch.properties?.thetaStandard?.const;
      report(rec, "C5", `${sch.id} TRIAGE/4 representation`,
        c?.schema?.type === "integer" && c?.order === "lower-first" && min >= 0 ? []
          : ["TRIAGE/4 specialization requires nonnegative integer priority with lower-first order"]);
      report(rec, "C5", `${sch.id} TRIAGE/4 thresholds (${tH}, ${tS}; domain ${min}..${max})`,
        Number.isInteger(tH) && Number.isInteger(tS) && min <= tH && tH < tS && tS < max ? []
          : ["require minimum <= thetaHigh < thetaStandard < maximum so every routine band is reachable"]);
    }
  }
}

// ---- C6 ------------------------------------------------------------------------------------

export const CAP_XSD = join(ROOT, "vendor", "cap", "CAP-v1.2.xsd");
export const CAP_XSD_URL = "http://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.xsd";
export const CAP_XSD_SHA256 = "b7798ef25868b068c97b268bda02d067c7d4ba9373adc5638bf37105804ee723";

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats.default(ajv);
function accepts(schema: any, data: any): string[] {
  const v = ajv.compile(schema);
  return v(data) ? [] : (v.errors ?? []).map((x) => `${x.instancePath || "/"} ${x.message}`);
}
const rejects = (schema: any, data: any, why: string) => (accepts(schema, data).length ? [] : [`accepted ${why}`]);

// Witness templates live in fixtures/; a scenario may override one in scenarios/<name>/fixtures/.
function witness(dir: string, name: string, map: Record<string, unknown>) {
  const local = join(dir, "fixtures", `${name}.json`);
  return JSON.parse(fillPlaceholders(readFileSync(existsSync(local) ? local : join(ROOT, "fixtures", `${name}.json`), "utf8"), map));
}

function capParameters(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<parameter>\s*<valueName>([^<]*)<\/valueName>\s*<value>([^<]*)<\/value>\s*<\/parameter>/g)) out[m[1]] = m[2];
  return out;
}

async function capErrors(xml: string, alarm: any): Promise<string[]> {
  if (!existsSync(CAP_XSD)) return [`CAP XSD missing at ${rel(CAP_XSD)}: run npm run fetch:cap`];
  const xsd = readFileSync(CAP_XSD, "utf8");
  if (createHash("sha256").update(xsd).digest("hex") !== CAP_XSD_SHA256) return ["CAP XSD differs from the official OASIS file (SHA-256)"];
  const r = await validateXML({ xml: [{ fileName: "alert.xml", contents: xml }], schema: [{ fileName: "CAP-v1.2.xsd", contents: xsd }] });
  const errs = r.valid ? [] : r.errors.map((x: any) => `XSD: ${x.rawMessage}`);
  const p = capParameters(xml), cri = Number(p.CRI);
  if (!("CRI" in p) || !(cri >= 0 && cri <= 1)) errs.push(`CAP parameter CRI missing or outside [0, 1] (${p.CRI})`);
  if (p.hazardFactor !== alarm.hazardFactor) errs.push(`CAP parameter hazardFactor '${p.hazardFactor}' != header '${alarm.hazardFactor}'`);
  const id = xml.match(/<identifier>([^<]*)<\/identifier>/)?.[1];
  if (id !== alarm.payload.identifier) errs.push(`CAP <identifier> '${id}' != payload.identifier '${alarm.payload.identifier}'`);
  return errs;
}

export async function c6(rec: Rec, tds: any[], dir: string) {
  const at = linked(tds);
  const schedulersOf = (href: string) => byType(tds, "AemsSchedulerTM").filter((x) => linksOf(x, "schedules").some((l) => l.href === href));
  for (const s of byType(tds, "AemsSensingEduTM"))
    for (const f of factors(s)) {
      const schema = s.priorityContract.schema;
      const middle = (schema.minimum + schema.maximum) / 2;
      const priority = schema.type === "integer" ? Math.ceil(middle) : middle;
      const map = { deviceId: s.id, hazardFactor: f, priority };
      const mon = witness(dir, "monitoring", map), alarm = witness(dir, "alarm", map);
      const w = `(${s.id}, ${f})`;
      report(rec, "C6", `monitoring ${w} accepted by ${s.id} monitoring`, accepts(s.events.monitoring.data, mon));
      for (const name of ["monitoring", "alarm"]) {
        const data = name === "monitoring" ? mon : alarm;
        const message = s.events[name].data;
        report(rec, "C6", `${name} ${w} priority bounds`, [
          ...accepts(schema, schema.minimum),
          ...accepts(schema, schema.maximum),
          ...rejects(message, { ...data, priority: schema.minimum - 1 }, "priority below deployment minimum"),
          ...rejects(message, { ...data, priority: schema.maximum + 1 }, "priority above deployment maximum"),
          ...(schema.type === "integer" ? rejects(message, { ...data, priority: schema.minimum + 0.5 }, "fractional priority") : [])]);
      }
      for (const x of schedulersOf(`${s.id}#/events/monitoring`))
        report(rec, "C6", `monitoring ${w} accepted by ${x.id} schedulingInput`, accepts(x.schedulingInput, mon));
      report(rec, "C6", `alarm ${w} accepted by ${s.id} alarm`, accepts(s.events.alarm.data, alarm));
      for (const x of schedulersOf(`${s.id}#/events/alarm`))
        report(rec, "C6", `alarm ${w} accepted by ${x.id} schedulingInput`, accepts(x.schedulingInput, alarm));
      report(rec, "C6", `alarm ${w} CAP alert`, await capErrors(alarm.payload.xml, alarm));
      for (const u of dispatchedEmus(tds, s).filter((t) => factors(t.thing).includes(f))) {
        report(rec, "C6", `alarm ${w} accepted by ${u.thing.id} handleAlarm`, accepts(u.node.input, alarm));
        // Mitigation copies priority, device, zone and factor from the alarm (lineage, D9).
        const mit = { ...Object.fromEntries(LINEAGE.map((k) => [k, alarm[k]])), messageClass: "mitigation",
          timestamp: alarm.timestamp, payload: { alarmId: alarm.payload.identifier, command: "activate", issuedBy: u.thing.id } };
        for (const l of linksOf(u.thing, "commands")) {
          const a = at(l.href);
          if (!a.err && factors(a.thing).includes(f))
            report(rec, "C6", `mitigation ${w} from ${u.thing.id} accepted by ${l.href}`, accepts(a.node.input, mit));
        }
      }
    }
  for (const e of byType(tds, "AemsControllerTM")) {
    const out = e.actions?.configure?.output;
    if (!out) continue;
    const cfg = witness(dir, "configure", {});
    report(rec, "C6", `configure witness accepted by ${e.id} configure output`, accepts(out, cfg));
    for (const s of byType(tds, "AemsSensingEduTM").filter((s) => registrations(tds, s).some((r) => r.thing.id === e.id))) {
      const input = s.actions?.updatePriority?.input;
      if (!input) continue; // reported by C4
      const { issuedAt, ...noIssuedAt } = cfg;
      report(rec, "C6", `configure witness accepted by ${s.id} updatePriority; CRI outside [0, 1] and missing issuedAt rejected`, [
        ...accepts(input, cfg),
        ...rejects(input, { ...cfg, contextualRiskIndex: 1.5 }, "a CRI outside [0, 1]"),
        ...rejects(input, noIssuedAt, "an assignment without issuedAt")]);
    }
  }
}
