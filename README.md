# a-EMS Emergency Model

Reusable W3C Web of Things Thing Models and structural checks for contextual configuration,
hazard-specific routing, and connected priority contracts in urban emergency monitoring.
The firmware computes priority. The model describes how context reaches sensing EDUs and
how their emitted priority reaches consumers. Scheduling is an explicit deployment choice.

## Relation to CityLink

Device TMs follow the [CityLink](https://github.com/les2feup/CityLink) Application / Platform /
Embedded Core composition and shared `tm:ref` definitions. This repository does not
reimplement the Edge Connector, device onboarding, or application replacement. Receiving
context through an application action is distinct from replacing that application.

The core has five TMs: sensing EDU, actuating EDU, EMC, EMU, and a shared schema library.
An additional TM describes the optional TRIAGE/4 scheduling interface. The contribution is
the connected description and checks of registration, contextual updates, hazard routing,
and consumer contracts, rather than the numeric field or WoT schema conformance alone.
New vocabulary uses the CityLink namespace in `context/citylink-aems.context.jsonld`.

## Context and emitted priority

`configure` returns `priorityAssignment`: `zone`, `contextualRiskIndex` in [0, 1], and
`issuedAt`. The EMC supplies subsequent context through `updatePriority`, with the identical
schema. Those historical names refer to contextual configuration, not final message
priority. There is no `priorityLevels` field. The MGA assessment defines the risk domain;
installing another sensor does not automatically change it. CRI can vary temporally.

EDU firmware can emit CRI directly or compose it with local Hazard Perception, including
the published fuzzy CP mechanism. The checker does not know that formula or require HP.
A priority map per hazard factor is supported; factors need not have different values.
The reusable `priority` definition is a number. Each scenario must declare its representation:

```json
{
  "priorityContract": {
    "schema": {"type": "number", "minimum": 0, "maximum": 1},
    "order": "higher-first"
  },
  "scheduling": "none"
}
```

Only `number` or `integer` with finite inclusive bounds is accepted. Integer bounds must be
integers. `order` is `higher-first` or `lower-first`. Each instance can override the entire
`priorityContract`; otherwise it inherits the deployment contract. Instantiation specializes
the shared priority definition **before** resolving its `tm:ref` usages, and records the
contract as a `citylink:priorityContract` JSON annotation in every TD. It does not convert
values or negotiate scales. Messages carry the scalar without contract metadata.

Connected consumers must accept the producer's full declared domain and agree on order.
An integer producer can supply a number consumer; the reverse is rejected. Equal numeric
contracts do not establish semantic equivalence or empirical calibration of algorithms.

Version 0.4.0 changes existing interfaces. All scenarios and fixtures are migrated together;
there is no legacy number-of-classes field. The original 1–4 lower-first scenarios remain
valid deployment examples, without identification with four compulsory fuzzy output classes.

## Scheduling

`scheduling` is required in every manifest:

- `none`: no scheduler instances or `schedules` links. C5 records **not applicable**.
- `required`: at least one scheduler, every monitoring/alarm event linked to a scheduler,
  and each scheduler linked to events. Request-response actions cannot be scheduled.

The `AemsSchedulerTM` type identifies a scheduling consumer. The additional
`AemsTriage4SchedulerTM` type selects the TRIAGE/4-specific checks: nonnegative integer
priority, lower-first orientation, and integer thresholds satisfying
`minimum <= thetaHigh < thetaStandard < maximum`. These restrictions apply only to this
specialization. No equality between producer class counts and scheduler parameters is used.

`integer-ten` uses priorities 1–10 and thresholds 3 and 7. If normalized firmware priority
`p` in [0, 1] increases with urgency, a possible firmware representation for that consumer is
`r = max(1, min(10, ceil(10 * (1 - p))))`. `ceil(10 * p)` produces zero at `p = 0` and reverses
that consumer's preference. Neither conversion is implemented in the model.

The TRIAGE/4 runtime is not modified. These contracts do not demonstrate operational
integration with its dispatcher, where `zone_priority` also affects alarm grouping. Zone
identity remains independent of emitted priority here.

## Messages and flows

| Flow | Direction | Affordance | Binding | Envelope | Scheduled |
|---|---|---|---|---|---|
| Registration | EDU → EMC; response EMC → EDU | `configure` action | request-response | none | no |
| Context update | EMC → EDU | `updatePriority` action | request-response | none | no |
| Monitoring | EDU → EMC | `monitoring` event | MQTT | monitoring | deployment choice |
| Alarm | EDU → EMC | `alarm` event | MQTT | alarm | deployment choice |
| Alarm forwarding | EMC → EMU | `handleAlarm` action | request-response | alarm | no |
| Mitigation | EMU → actuator | `mitigate` action | request-response | mitigation | no |

Shared envelopes distinguish class, priority, source device, zone, hazard factor, timestamp,
and payload. Alarm forwarding is specified to retain the envelope; mitigation preserves
priority and source lineage without recalculation. Schema checks establish that interfaces
can carry these fields, not that firmware preserves their values at runtime. Command
selection and arbitration remain external; no responder-allocation policy is implemented.
Monitoring follows SOSA observation structure as plain JSON; alarms carry CAP XML.

## Running and layout

```sh
npm install
npm run fetch:cap                    # official CAP 1.2 XSD to vendor/, SHA-256 pinned
npm run validate                     # minimal scenario
npm run validate:all                 # exact expected failures and not-applicable checks
npm run instantiate -- continuous-cri
npx tsx src/validate.ts integer-ten
npx tsc --noEmit
```

The CAP XSD is not committed because its header reserves rights to OASIS. Missing or
changed XSD bytes fail C6. Source directories:

- `ThingModels/`: reusable application/cloud TMs, schema library, optional fog specialization.
- `context/`: vocabulary annotations.
- `scenarios/<name>/scenario.json`: deployment contracts, instances, links, expected failures.
- `scenarios/<name>/fixtures/`: optional witness overrides; common templates in `fixtures/`.
- `scenarios/<name>/td/`: generated and ignored; edit source models and manifests instead.
- `src/`: reference resolution, instantiation, contract checks, validation runner.

## Checks and evidence

| Check | Scope |
|---|---|
| C1 / C2 | W3C TM / TD JSON schemas, including scenario-specific TM copies |
| C3 | Exactly one sensing-EDU registration to an EMC configure action, matching controller update and alarm consumption; hazard reachability to EMUs and shared commanded-actuator factors |
| C4 | Connected priority types, domains and order; alarm and mitigation lineage schemas; registered configuration pairs and configuration/update schema identity |
| C5 | Explicit scheduling choice, event coverage and consumer compatibility; TRIAGE/4 representation and band reachability only for its specialization |
| C6 | Witnesses against producer and consumer schemas; priority boundaries and integer rejection; contextual assignment rejection; official CAP 1.2 XSD and contextual parameters |

C1/C2 use `@thing-description-playground/core`; C6 uses Ajv and `xmllint-wasm`. Only the W3C
schemas and official CAP XSD are external specifications. C4's compatibility routine checks
the types, required fields, constants/enumerations and bounds used here; it is not a proof
of inclusion between arbitrary JSON schemas. Shared configuration definitions make identity
true by construction; the check detects deviations. SOSA ontology conformance is not tested.

An applicable check with no evaluated item fails. Deliberate absence of scheduling is
recorded separately from success. Each scenario lists the exact set of expected failed
check groups in `expect`, and expected not-applicable groups in `expectNotApplicable`
(default empty). A negative scenario ceasing to expose its intended fault fails the suite.
An invalid manifest stops instantiation with a named failed prerequisite; subsequent checks
are not evaluated. Fault injections are hand-built examples, not systematic mutation analysis.

The 29 scenarios include the original 12, continuous priority without scheduling and with a generic scheduling interface, integer
1–10, integer-to-number compatibility, missing registration/update links, reversed order,
range incompatibility, out-of-range values, and a continuous producer rejected by TRIAGE/4.
`continuous-cri` uses priority 0.82 equal to the supplied CRI; `continuous-composed` uses an
illustrative 0.61 under the same contract. Neither executes or evaluates fuzzy calculation.
`negative-unsatisfiable` retains compatible declarations but admits no valid alarm witness.

These checks do not establish runtime value preservation, atomicity, interaction ordering,
timing, scale calibration, city-scale performance, mitigation equity, or emergency outcomes.
The last received context can become stale when a unit disconnects. Scheduling links do
not imply network-level timing guarantees. Those limits bound the evidence without removing
the utility of identifying structural incompatibilities before operation.

## Before publishing

Replace `OWNER` consistently in TM references, URLs and `src/resolve.ts`. The repository's
local reference mapping supports offline validation; its placeholder URLs are not evidence
that a deployment or publicly hosted model is available.
