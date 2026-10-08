# a-EMS Emergency Model

W3C Web of Things Thing Models and structural validation for the priority-aware urban
Emergency Management System (a-EMS). The model describes every architectural component
(sensing and actuating EDUs, the Emergency Management Controller, Emergency Mitigation
Units) as a Thing, and defines a common message envelope that carries a contextual,
per-device priority consumed by the TRIAGE/4 fog scheduler.

## Relation to CityLink

The device layer follows the [CityLink](https://github.com/les2feup/CityLink) Thing Model
framework (Application / Platform / Embedded Core composition, `tm:ref` schema libraries).
The sensor and actuator TMs here are **Application-layer** TMs, meant to be composed by the
CityLink Edge Connector; that composition is not reimplemented. What this repository adds:

- Thing Models for the cloud components (EMC, EMU);
- a Thing Model for the management interface of the TRIAGE/4 fog scheduler;
- the message envelope and its priority / hazard-factor vocabulary;
- typed links between components (`consumes`, `dispatchesTo`, `commands`, `schedules`).

New terms live in the CityLink namespace (`citylink:`) with an `Aems` prefix on class names
(e.g. `citylink:AemsControllerTM`), following CityLink's naming (`citylink:EmbCTM`,
`citylink:controlledBy`). They are defined in `context/citylink-aems.context.jsonld`.
- a TM-to-TD instantiation step for scenarios and a structural checker.

## Priority in the model

- At configuration the EMC returns, per hazard factor, the spatiotemporal priority index pR
  and the number of priority ranks N.
- At runtime the EDU converts pR and Hazard Perception into the contextual priority CP and
  assigns every envelope a rank with the proportional discretization known by the EMC:
  `rank = clamp(ceil((1 - CP) * N), 1, N)`. Rank 1 is the most urgent, because TRIAGE/4 routes
  ranks `<= thetaHigh` to its HIGH band.
- The TD declares the schema of the priority field; the value travels in each envelope.

## Layout

```
context/citylink-aems.context.jsonld  citylink: terms added by this repository
ThingModels/generic/                envelope schema library (tm:ref targets)
ThingModels/edu/                    sensing EDU (monitoring + alarm events), actuating EDU (mitigate)
ThingModels/controller/             EMC (configure; consumes alarms; dispatches to EMUs)
ThingModels/mitigation/             EMU (handleAlarm; commands actuating EDUs directly)
ThingModels/fog/                    TRIAGE/4 scheduler management interface
scenarios/<name>/scenario.json      instances, placeholders and wiring
src/                                resolver, instantiation, checker
```

## Running

```
npm install
npm run validate            # scenario 'minimal'  -> expected: 0 failures
npm run validate:negative   # flood without EMU -> C3 fails; thetaS = N -> C5 fails
```

## Checks

| Id | Check | Tool |
|----|-------|------|
| C1 | Every TM conforms to the W3C TM JSON Schema | `@thing-description-playground/core` tmValidator |
| C2 | Every instantiated TD conforms to the W3C TD JSON Schema | tdValidator |
| C3 | Every hazard factor monitored by a sensing EDU is served by an EMU | this repo |
| C4 | Contracts: alarm event satisfies the EMU input; EMC configure output satisfies the EDU properties | this repo |
| C5 | Scheduled events satisfy the scheduler input; `1 <= thetaH < thetaS < N`; N agrees across EMC and scheduler | this repo |
| C6 | Alarm payload conforms to the OASIS CAP 1.2 XSD | not implemented yet (needs the official XSD) |

The schema checks (C1, C2) use the W3C schemas shipped with an independent tool, not
schemas written in this repository. Each repository check (C3, C4, C5) has a scenario or
mutation that makes it fail, so a pass is not vacuous.

**What these checks do not validate:** runtime behaviour, ordering of interactions,
timing, or performance. They establish structural consistency of interfaces and
contracts only.

## The scheduler as a Thing

The scheduler Thing is the configuration surface of TRIAGE/4 at a fog broker (thresholds,
number of ranks, fields read by band assignment), not the queue. Messages are not addressed
to it; the `schedules` link states which event affordances pass through it. Mitigation
commands are not linked, because their request-response binding bypasses the broker.

## Before publishing

Replace `OWNER` in every `tm:ref`/`href` and in `src/resolve.ts` with the GitHub account.
