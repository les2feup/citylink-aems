// TM -> TD instantiation for a scenario (analogous to the CityLink Edge Connector step).
// Fills placeholders (scenario-wide and per instance), resolves tm:ref, adds forms,
// and wires links to concrete TDs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadJson, resolveRefs } from "./resolve.ts";

type Instance = {
  id: string; tm: string; placeholders?: Record<string, unknown>;
  links?: { rel: string; target: string; affordance: string }[];
};

const MQTT_CTX = { mqv: "http://www.example.org/mqtt-binding#" };

// A placeholder that is the whole JSON string ("{{X}}") is replaced by the typed value
// (number, array); a placeholder inside a longer string is replaced textually.
export function fillPlaceholders(raw: string, map: Record<string, unknown>): string {
  const typed = raw.replace(/"\{\{(\w+)\}\}"/g, (_, k) => {
    if (!(k in map)) throw new Error(`missing placeholder ${k}`);
    return JSON.stringify(map[k]);
  });
  return typed.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in map)) throw new Error(`missing placeholder ${k}`);
    return String(map[k]);
  });
}

export function instantiate(scenarioDir: string): string[] {
  const sc = loadJson(join(scenarioDir, "scenario.json"));
  const outDir = join(scenarioDir, "td");
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const inst of sc.instances as Instance[]) {
    const raw = JSON.stringify(loadJson(join(ROOT, inst.tm)));
    const map = { ...(sc.placeholders ?? {}), ...(inst.placeholders ?? {}) };
    const td = resolveRefs(JSON.parse(fillPlaceholders(raw, map)));
    // tm:ref targets may themselves contain placeholders: fill again after resolution.
    const done = JSON.parse(fillPlaceholders(JSON.stringify(td), map));
    const types = ([] as string[]).concat(done["@type"]).filter((t) => t !== "tm:ThingModel");
    done["@type"] = ["Thing", ...types];
    done["@context"] = [...[].concat(done["@context"]), MQTT_CTX];
    done.id = `urn:aems:${inst.id}`;
    done.title = `${done.title} (${inst.id})`;
    done.securityDefinitions = { nosec_sc: { scheme: "nosec" } };
    done.security = ["nosec_sc"];
    const http = `${sc.httpBase}/${inst.id}`;
    for (const [name, p] of Object.entries<any>(done.properties ?? {})) {
      p.forms = [{ href: `${http}/properties/${name}`, contentType: "application/json" }];
      if (p.observable) p.forms.push({ href: sc.mqttBroker, "mqv:filter": `aems/${inst.id}/properties/${name}`, op: ["observeproperty", "unobserveproperty"], contentType: "application/json" });
    }
    for (const [name, a] of Object.entries<any>(done.actions ?? {})) {
      a.forms = [{ href: `${http}/actions/${name}`, contentType: "application/json" }];
    }
    for (const [name, e] of Object.entries<any>(done.events ?? {})) {
      e.forms = [{ href: sc.mqttBroker, "mqv:filter": `aems/${inst.id}/events/${name}`, op: ["subscribeevent", "unsubscribeevent"], contentType: "application/json" }];
    }
    done.links = (inst.links ?? []).map((l) => ({ rel: l.rel, href: `urn:aems:${l.target}#${l.affordance}`, type: "application/td+json" }));
    delete done.version;
    const file = join(outDir, `${inst.id}.td.json`);
    writeFileSync(file, JSON.stringify(done, null, 2) + "\n");
    written.push(file);
  }
  return written;
}

if (process.argv[1]?.endsWith("instantiate.ts")) {
  const dir = join(ROOT, "scenarios", process.argv[2] ?? "minimal");
  for (const f of instantiate(dir)) console.log("wrote", f);
}
