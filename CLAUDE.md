# Code-agent guidance

This repository supports Chapter 4 with structural descriptions and checks, not operational
performance claims. Read [README.md](README.md) for the current model and commands. Device
TMs follow CityLink's Application-layer composition; do not reimplement the Edge Connector.

## Pipeline and validation

Scenario manifest → instantiation → generated `scenarios/<name>/td/` → C1–C6.
Edit TMs, manifests and fixtures, not generated TDs. Run `npm run validate:all` and
`npx tsc --noEmit` for changes. Scenarios must match both their exact `expect` failures and
`expectNotApplicable` groups (default empty). CAP requires the official pinned XSD.
Applicable empty checks fail; C5 deliberately returns not applicable for `scheduling=none`.
An invalid manifest stops instantiation with a named failed prerequisite.

## Current invariants (v0.4.0)

- Firmware computes emitted priority; TMs describe its interface. HP, fuzzy CP, four ranks,
  and TRIAGE/4 are not core requirements.
- `configure` output and `updatePriority` input share `priorityAssignment`: `zone`,
  `contextualRiskIndex`, `issuedAt`. These names transport context, not final priority.
  Do not reintroduce `priorityLevels` or infer MGA risk layers from installed sensors.
- Every manifest declares a finite numeric `priorityContract` and explicit `scheduling`.
  Instances inherit the contract or override it entirely. Specialize shared priority before
  resolving `tm:ref`, then annotate TDs; do not add conversion or negotiation to the model.
- Connected contracts must agree on orientation and accept the whole producer domain.
  Integer producers may supply number consumers; continuous producers cannot supply
  integer-only interfaces. Compare configuration pairs through registration links.
- Every sensing EDU registers with its EMC configure action and has the corresponding
  controller update and alarm-consumption links. Preserve hazard-specific routing checks.
- Three envelope classes: monitoring, alarm, mitigation. Source identity, zone, hazard
  factor, class and priority are separate. Forwarding/copying are declared behavior;
  schema compatibility is not evidence of runtime value preservation.
- EMC never commands actuators. EMUs address actuators directly; command selection,
  arbitration and resource allocation remain external.
- `scheduling=none` forbids scheduler instances and links. `required` covers monitoring and
  alarm events. Request-response actions cannot be scheduling targets.
- `AemsSchedulerTM` selects general scheduling checks; `AemsTriage4SchedulerTM` additionally
  requires nonnegative integer lower-first priority and reachable threshold bands.
  Do not modify the external TRIAGE/4 runtime or claim dispatcher integration.
- Reuse CityLink vocabulary, `tm:ref` shared definitions, W3C TM/TD schemas, and official
  CAP XSD. `compatible` covers the schema constructs used here, not arbitrary JSON Schema.
  C6 witnesses demonstrate admissibility, not priority computation.
- Update TM `version.model`, `package.json`, and lockfile together.

Placeholder filling preserves typed values when the placeholder is the complete JSON
string. `tm:ref` resolution maps `REPO_BASE` to local files and rejects other bases; siblings
override referenced definitions shallowly. `OWNER` must be replaced consistently before
publishing. Historical notes under ignored `docs/conceptual/` can predate v0.4.0; their
mandatory fuzzy/class-count/scheduler decisions are superseded by the user's deployment
contract intervention. Do not present those historical decisions as current invariants.
