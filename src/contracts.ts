// Deployment metadata describes an emitted scalar; it never computes its value.
export type PriorityContract = {
  schema: { type: "number" | "integer"; minimum: number; maximum: number };
  order: "higher-first" | "lower-first";
};

export class ScenarioError extends Error {
  constructor(public check: "C4" | "C5", message: string) {
    super(message);
  }
}

export function contractErrors(value: any): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["priorityContract is required"];
  const errors: string[] = [];
  const s = value.schema;
  if (!s || typeof s !== "object" || Array.isArray(s)) errors.push("priorityContract.schema is required");
  else {
    if (!["number", "integer"].includes(s.type)) errors.push("priority type must be number or integer");
    if (!Number.isFinite(s.minimum) || !Number.isFinite(s.maximum)) errors.push("priority bounds must be finite numbers");
    else if (s.minimum > s.maximum) errors.push("priority minimum exceeds maximum");
    if (s.type === "integer" && (!Number.isInteger(s.minimum) || !Number.isInteger(s.maximum)))
      errors.push("integer priority bounds must be integers");
    if (Object.keys(s).some((k) => !["type", "minimum", "maximum"].includes(k)))
      errors.push("priority schema supports only type, minimum and maximum");
  }
  if (!["higher-first", "lower-first"].includes(value.order)) errors.push("priority order must be higher-first or lower-first");
  if (Object.keys(value).some((k) => !["schema", "order"].includes(k)))
    errors.push("priorityContract supports only schema and order");
  return errors;
}

export function checkScenario(sc: any): void {
  if (!["none", "required"].includes(sc.scheduling))
    throw new ScenarioError("C5", "scheduling must be explicitly none or required");
  for (const [id, contract] of [["deployment", sc.priorityContract],
    ...(sc.instances ?? []).map((i: any) => [i.id, i.priorityContract ?? sc.priorityContract])]) {
    const errors = contractErrors(contract);
    if (errors.length) throw new ScenarioError("C4", `${id}: ${errors.join("; ")}`);
  }
}
