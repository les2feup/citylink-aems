// Structural validation of the Emergency Model (checks in checks.ts).
//   tsx src/validate.ts [scenario]   one scenario (default: minimal)
//   tsx src/validate.ts --all        every scenario under scenarios/
// Each scenario.json lists in "expect" the checks it is designed to fail (empty for a
// positive scenario). A run passes only if the set of failing checks equals "expect", so a
// fault-injection scenario that stops failing is itself reported as a failure.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadJson } from "./resolve.ts";
import { instantiate } from "./instantiate.ts";
import { ScenarioError } from "./contracts.ts";
import { type Rec, type Result, c1, c2, c3, c4, c5, c6 } from "./checks.ts";

const CHECKS = ["C1", "C2", "C3", "C4", "C5", "C6"];

async function runScenario(name: string): Promise<{ results: Result[]; expect: string[]; expectNotApplicable: string[] }> {
  const dir = join(ROOT, "scenarios", name);
  const results: Result[] = [];
  const rec: Rec = (id, ok, msg) => results.push({ id, ok, msg });
  const scenario = loadJson(join(dir, "scenario.json"));
  let files: string[];
  try { files = instantiate(dir); }
  catch (error) {
    if (!(error instanceof ScenarioError)) throw error;
    rec(error.check, false, error.message);
    return { results, expect: scenario.expect ?? [], expectNotApplicable: scenario.expectNotApplicable ?? [] };
  }
  const tds = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  await c1(rec, scenario.instances.map((i: any) => join(ROOT, i.tm))); await c2(rec, files); c3(rec, tds); c4(rec, tds); c5(rec, tds, scenario.scheduling); await c6(rec, tds, dir);
  for (const id of CHECKS)
    if (!results.some((r) => r.id === id)) rec(id, false, "no item checked: the check would pass vacuously");
  return { results, expect: scenario.expect ?? [], expectNotApplicable: scenario.expectNotApplicable ?? [] };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

async function main() {
  const all = process.argv[2] === "--all";
  const names = all
    ? readdirSync(join(ROOT, "scenarios"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [process.argv[2] ?? "minimal"];
  let bad = 0;
  for (const name of names) {
    const { results, expect, expectNotApplicable } = await runScenario(name);
    const failed = [...new Set(results.filter((r) => r.ok === false).map((r) => r.id))].sort();
    const na = [...new Set(results.filter((r) => r.ok === null).map((r) => r.id))];
    const ok = same(failed, expect) && same(na, expectNotApplicable);
    if (!ok) bad++;
    if (all) {
      console.log(`${ok ? "OK  " : "BAD "}  ${name}: failed [${failed.join(", ")}], expected [${expect.join(", ")}]${na.length || expectNotApplicable.length ? `; not applicable [${na.join(", ")}], expected [${expectNotApplicable.join(", ")}]` : ""}`);
      if (!ok) for (const r of results.filter((r) => r.ok === false)) console.log(`        FAIL  ${r.id}  ${r.msg}`);
    } else {
      for (const r of results) console.log(`${r.ok === null ? "N/A " : r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.msg}`);
      console.log(`\nscenario '${name}': failed [${failed.join(", ")}], expected [${expect.join(", ")}]; not applicable [${na.join(", ")}], expected [${expectNotApplicable.join(", ")}] -> ${ok ? "as expected" : "NOT as expected"}`);
    }
  }
  if (all) console.log(`\n${names.length - bad}/${names.length} scenario(s) as expected`);
  process.exit(bad ? 1 : 0);
}
main();
