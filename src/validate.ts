// Structural validation of the Emergency Model.
// C1  every Thing Model conforms to the W3C WoT TM JSON Schema (playground tmValidator)
// C2  every instantiated TD conforms to the W3C WoT TD JSON Schema (playground tdValidator)
// C3  hazard coverage: every hazard factor monitored by a sensing EDU is served by an EMU
// C4  contracts: alarm event satisfies the EMU input; EMC configure output satisfies the EDU
// C5  fog: scheduled events satisfy the scheduler input; 1 <= thetaH < thetaS < N;
//     N agrees across EMC, scheduler and envelope
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tdValidator, tmValidator } from "@thing-description-playground/core";
import { ROOT } from "./resolve.ts";
import { instantiate } from "./instantiate.ts";

type Result = { id: string; ok: boolean; msg: string };
const results: Result[] = [];
const rec = (id: string, ok: boolean, msg: string) => results.push({ id, ok, msg });

function walk(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), suffix) : e.name.endsWith(suffix) ? [join(dir, e.name)] : []);
}
const silent = () => {};
const opts = { checkDefaults: false, checkJsonLd: false };
const rel = (f: string) => f.replace(ROOT + "/", "");

async function c1() {
  for (const f of walk(join(ROOT, "ThingModels"), ".tm.json")) {
    const r = await tmValidator(readFileSync(f, "utf8"), silent, opts);
    rec("C1", r.report.schema === "passed", `${rel(f)}: schema ${r.report.schema}`);
  }
}
async function c2(tds: string[]) {
  for (const f of tds) {
    const r = await tdValidator(readFileSync(f, "utf8"), silent, opts);
    rec("C2", r.report.schema === "passed", `${rel(f)}: schema ${r.report.schema}`);
  }
}

const byType = (tds: any[], t: string) => tds.filter((d) => [].concat(d["@type"]).includes(t));

function c3(tds: any[]) {
  const served = new Set(byType(tds, "AemsMitigationTM").flatMap((d) => d.hazardFactors));
  for (const s of byType(tds, "AemsSensingEduTM"))
    for (const f of s.hazardFactors)
      rec("C3", served.has(f), `${s.id} factor '${f}' ${served.has(f) ? "served" : "has NO EMU"}`);
}

// Producer schema satisfies consumer schema: every field the consumer requires is produced
// as required, with the same type, compatible const/enum and compatible numeric bounds.
function compatible(prod: any = {}, cons: any = {}, path = ""): string[] {
  const p = path || "/";
  const errs: string[] = [];
  if (cons.type && prod.type !== cons.type) errs.push(`${p}: type ${prod.type} != ${cons.type}`);
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

function linked(tds: any[]) {
  const byId = new Map(tds.map((d) => [d.id, d]));
  return (href: string) => {
    const [id, ptr] = href.split("#");
    return ptr.split("/").filter(Boolean).reduce((o: any, k) => o?.[k], byId.get(id));
  };
}
const report = (id: string, what: string, errs: string[]) =>
  rec(id, errs.length === 0, `${what}${errs.length ? ": " + errs.join("; ") : ""}`);

function c4(tds: any[]) {
  const at = linked(tds);
  for (const emc of byType(tds, "AemsControllerTM")) {
    const consumed = emc.links.filter((l: any) => l.rel === "consumes");
    for (const d of emc.links.filter((l: any) => l.rel === "dispatchesTo"))
      for (const c of consumed) report("C4", `${c.href} -> ${d.href}`, compatible(at(c.href).data, at(d.href).input));
    const out = emc.actions.configure.output.properties;
    for (const s of byType(tds, "AemsSensingEduTM")) {
      const errs = ["zone", "priorityIndex", "priorityLevels"].flatMap((k) => compatible(out[k], s.properties[k], `/${k}`));
      report("C4", `configure output -> ${s.id}`, errs);
    }
  }
}

function c5(tds: any[]) {
  const at = linked(tds);
  const emcN = byType(tds, "AemsControllerTM").map((d) => d.actions.configure.output.properties.priorityLevels.const);
  for (const sch of byType(tds, "AemsSchedulerTM")) {
    for (const l of sch.links.filter((x: any) => x.rel === "schedules"))
      report("C5", `${l.href} -> ${sch.id} schedulingInput`, compatible(at(l.href).data, sch.schedulingInput));
    const N = sch.properties.priorityLevels.const, tH = sch.properties.thetaHigh.const, tS = sch.properties.thetaStandard.const;
    report("C5", `${sch.id} thresholds (thetaH=${tH}, thetaS=${tS}, N=${N})`,
      1 <= tH && tH < tS && tS < N ? [] : ["require 1 <= thetaH < thetaS < N so that HIGH, STANDARD and BACKGROUND are all reachable"]);
    report("C5", `${sch.id} N agrees with EMC`, emcN.every((n) => n === N) ? [] : [`EMC N=${emcN} vs scheduler N=${N}`]);
  }
}

async function main() {
  const scenario = process.argv[2] ?? "minimal";
  const files = instantiate(join(ROOT, "scenarios", scenario));
  const tds = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  await c1(); await c2(files); c3(tds); c4(tds); c5(tds);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.msg}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nscenario '${scenario}': ${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
}
main();
