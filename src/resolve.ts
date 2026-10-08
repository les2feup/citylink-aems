// Local resolution of tm:ref pointers (W3C WoT TD 1.1, Thing Model section).
// Remote base URLs are mapped to the local checkout so validation runs offline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PriorityContract } from "./contracts.ts";

export const REPO_BASE =
  "https://raw.githubusercontent.com/les2feup/citylink-aems/main/";
export const ROOT = join(import.meta.dirname, "..");

const cache = new Map<string, any>();

export function loadJson(path: string): any {
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return structuredClone(cache.get(path));
}

function toLocal(url: string): string {
  if (!url.startsWith(REPO_BASE)) throw new Error(`tm:ref outside repository: ${url}`);
  return join(ROOT, url.slice(REPO_BASE.length));
}

function pointer(doc: any, ptr: string): any {
  return ptr.split("/").filter(Boolean).reduce((o, k) => {
    if (o === undefined) throw new Error(`broken JSON pointer ${ptr}`);
    return o[k.replace(/~1/g, "/").replace(/~0/g, "~")];
  }, doc);
}

export function deref(url: string): any {
  const [file, ptr = ""] = url.split("#");
  return pointer(loadJson(toLocal(file)), ptr);
}

// Replace every {"tm:ref": ...} by the referenced definition; sibling keys override (TM spec).
export function resolveRefs(node: any, depth = 0, contract?: PriorityContract): any {
  if (depth > 32) throw new Error("tm:ref recursion too deep");
  if (Array.isArray(node)) return node.map((n) => resolveRefs(n, depth + 1, contract));
  if (node && typeof node === "object") {
    let out: any = {};
    if (typeof node["tm:ref"] === "string") {
      const ref = node["tm:ref"];
      const definition = deref(ref);
      const specialized = contract && ref === `${REPO_BASE}ThingModels/generic/aems_common.tm.json#/properties/priority`
        ? { ...definition, ...contract.schema } : definition;
      out = resolveRefs(specialized, depth + 1, contract);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k !== "tm:ref") out[k] = resolveRefs(v, depth + 1, contract);
    }
    return out;
  }
  return node;
}
