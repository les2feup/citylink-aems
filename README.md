# a-EMS Emergency Model

W3C Web of Things Thing Models and structural validation for the priority-aware urban
Emergency Management System (a-EMS). The model describes every architectural component
(sensing and actuating EDUs, the Emergency Management Controller, Emergency Mitigation
Units, the management interface of the TRIAGE/4 fog scheduler) as a Thing, and defines a
message envelope that carries a contextual priority per EDU and hazard factor.

## Relation to CityLink

The device layer follows the [CityLink](https://github.com/les2feup/CityLink) Thing Model
framework (Application / Platform / Embedded Core composition, `tm:ref` schema libraries).
The sensor and actuator TMs here are **Application-layer** TMs, meant to be composed by the
CityLink Edge Connector; that composition is not reimplemented. What this repository adds:

- Thing Models for the cloud components (EMC, EMU);
- a Thing Model for the management interface of the TRIAGE/4 fog scheduler;
- the message envelope and its priority / hazard-factor vocabulary;
- typed links between components (`consumes`, `dispatchesTo`, `commands`, `schedules`,
  `registersWith`, `updatesPriority`);
- a TM-to-TD instantiation step for scenarios and a structural checker.

New terms live in the CityLink namespace (`citylink:`) with an `Aems` prefix on class names
(e.g. `citylink:AemsControllerTM`), following CityLink's naming (`citylink:EmbCTM`,
`citylink:controlledBy`). They are defined in `context/citylink-aems.context.jsonld`.

## Priority in the model

- The spatial priority is the contextual risk index (CRI) of the MGA (Multi-Domain
  Geospatial Assessment), `CRI_ent = R·(1 + γ·E) / (1 + γ)`, in [0, 1]: one value per zone,
  common to all hazard factors. Its risk domain includes the risk layers of every hazard
  factor monitored in the deployment. A CRI tracking service in the EMC (module S1) follows
  the MGA CRI maps.
- At registration the EDU calls `configure` on the EMC, which returns a `priorityAssignment`:
  zone, number of ranks N, the current CRI of the zone and `issuedAt`. Whenever the CRI of a
  zone changes (beyond a threshold that is a parameter of the EMC), the EMC invokes
  `updatePriority` on every EDU registered in that zone, with exactly the same schema; the EDU
  discards an assignment older than the one it applied. A change in the set of monitored
  hazard factors changes the risk domain, so the CRI is recomputed and propagated the same way.
- At runtime the FLC of the EDU combines the CRI and the Hazard Perception of each hazard
  factor into the contextual priority CP, and the envelope carries the CP output class as a
  rank: Critical = 1, High = 2, Moderate = 3, Low = 4. The classification rule belongs to the
  CP computation. N = 4 is therefore defined by the FLC, not chosen by the EMC; the EMC still
  returns N at configuration so that C5 can check that it agrees with the scheduler.
- Rank 1 is the most urgent, because TRIAGE/4 routes ranks `<= thetaHigh` to its HIGH band.
  The scenarios use thetaHigh = 2 (Critical and High → HIGH) and thetaStandard = 3
  (Moderate → STANDARD, Low → BACKGROUND). Within a band TRIAGE/4 serves devices round-robin,
  so the rank only selects the band. The priority unit is EDU × hazard factor: the CRI is
  shared, the Hazard Perception is not.
- The TD declares the schema of the priority field; the value travels in each envelope.

## Messages and flows

| Flow | Direction | Affordance | Binding | Envelope | Crosses TRIAGE/4 |
|---|---|---|---|---|---|
| Registration | EDU → EMC (response EMC → EDU) | Action `configure` | request-response | no | no |
| Priority update | EMC → EDU | Action `updatePriority` | request-response | no | no |
| Monitoring | EDU → EMC | Event `monitoring` | MQTT | monitoring | yes |
| Alarm | EDU → EMC | Event `alarm` | MQTT | alarm | yes |
| Alarm forwarding | EMC → EMU | Action `handleAlarm` | request-response | alarm, unchanged | no |
| Mitigation | EMU → EDU | Action `mitigate` | request-response | mitigation | no |

The class envelopes and `priorityAssignment` are defined once in
`ThingModels/generic/aems_common.tm.json` and referenced with `tm:ref`. In every envelope,
`deviceId` and `zone` refer to the origin of the emergency or observation. The mitigation
envelope copies rank, device, zone and hazard factor from the alarm without recalculation;
how an actuating EDU arbitrates concurrent commands belongs to its local logic (E3) and is
not specified. The EMC does not command actuators.

**Per-hazard CRI (documented, not implemented).** The per-factor variant is the MGA
instantiated with a single hazard in its risk domain (CRI-flood, CRI-fire, …). The CRI of the
CP article, `w_R·RL(z, f) + w_V·VL(z, t)`, is a particular case of it: one hazard, no response
(mitigation capacity) layer, γ = 0 and fixed weights instead of entropy weights. Because the
envelope carries the rank and not the CRI, adopting the per-factor variant would change only
`priorityAssignment` and the EDU's internal computation; the scheduler, the EMC's alarm
handling and the EMUs would not change.

## Layout

```
context/citylink-aems.context.jsonld  citylink: terms added by this repository
ThingModels/generic/                schema library (envelopes, priorityAssignment; tm:ref targets)
ThingModels/edu/                    sensing EDU (monitoring + alarm events, updatePriority), actuating EDU (mitigate)
ThingModels/controller/             EMC (configure; consumes events; dispatches to EMUs)
ThingModels/mitigation/             EMU (handleAlarm; commands actuating EDUs directly)
ThingModels/fog/                    TRIAGE/4 scheduler management interface
scenarios/<name>/scenario.json      instances, placeholders, wiring and expected failures
scenarios/<name>/fixtures/          optional scenario-specific witness messages
fixtures/                           witness message templates (check C6)
src/                                resolver, instantiation, checks, runner, CAP XSD download
```

## Running

```
npm install
npm run fetch:cap           # downloads the official CAP 1.2 XSD to vendor/ (SHA-256 pinned)
npm run validate            # scenario 'minimal'
npm run validate:all        # every scenario; passes only if each fails exactly its "expect"
npx tsx src/validate.ts <scenario>
```

The CAP XSD is not committed (its header reserves all rights to OASIS); without it, C6
fails with a message asking to run `npm run fetch:cap`.

## Checks

| Id | Check | Tool |
|----|-------|------|
| C1 | Every TM conforms to the W3C TM JSON Schema | `@thing-description-playground/core` tmValidator |
| C2 | Every instantiated TD conforms to the W3C TD JSON Schema | tdValidator |
| C3 | Reachability: every hazard factor of a sensing EDU reaches, through typed links, an EMU that serves it (EDU →alarm→ EMC →dispatchesTo→ EMU); commanded actuators share a factor with the EMU | this repo |
| C4 | Contracts: alarm → `handleAlarm` for each shared factor; lineage `handleAlarm` → `mitigate` (rank, device, zone, factor); `configure` output → EDU properties; `configure` output identical to `updatePriority` input | this repo |
| C5 | Every sensing EDU event is scheduled; only events are scheduled; scheduled events satisfy the scheduler input; `1 <= thetaH < thetaS < N`; N agrees across EMC and scheduler | this repo |
| C6 | Witness messages are accepted by producer and consumer schemas; invalid priority assignments are rejected; the CAP alert conforms to the OASIS CAP 1.2 XSD and carries the CRI and the envelope's hazard factor as parameters | Ajv; `xmllint-wasm` with the official XSD |

Only C1, C2 and the CAP XSD use schemas written outside this repository. The identity in C4
between the `configure` output and the `updatePriority` input is guaranteed by the single
source (`tm:ref` to `priorityAssignment`); the check detects deviations from it. The
monitoring payload follows the observation structure of SOSA (observed property, result,
result time) as plain JSON; no check verifies it against the ontology.

Each check C3–C6 is made to fail by at least one **fault-injection scenario**
(`scenarios/negative-*`), and a check that evaluates no item counts as a failure, so a pass
is not vacuous. `negative-unsatisfiable` shows why C6 exists: its alarm schema accepts no
message, yet the producer/consumer compatibility of C4 and C5 still holds.

**What these checks do not validate:** runtime behaviour, ordering of interactions,
timing, or performance. They establish structural consistency of interfaces and
contracts only. Also outside their reach: the rank formula and the Hazard Perception; the
consistency between the CRI in the CAP alert and the rank; the atomicity of
`updatePriority`, which is declared. Without a connection to the EMC, an EDU keeps the last
CRI it received, which may be outdated; since `updatePriority` is addressed to each EDU, its
cost grows with the number of EDUs per zone.

## The scheduler as a Thing

The scheduler Thing is the configuration surface of TRIAGE/4 at a fog broker (thresholds,
number of ranks, fields read by band assignment), not the queue. Messages are not addressed
to it; the `schedules` link states which event affordances pass through it. Mitigation
commands and priority updates are never linked, because their request-response binding
bypasses the broker; C5 fails if an action is scheduled.

## Before publishing

Replace `OWNER` in every `tm:ref`/`href` and in `src/resolve.ts` with the GitHub account.
