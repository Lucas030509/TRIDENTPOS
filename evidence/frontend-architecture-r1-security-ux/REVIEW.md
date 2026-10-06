# Frontend Architecture Gate — R1
Date: 2026-10-06
Repository: Lucas030509/TRIDENTPOS
PR: #64
Subject SHA: b0d90a2bc7cb0ef0653df724d27e1aacf222207d
Canonical sidecar base: 167704791e26b1f6964c47ad38e927c04613d1e2
Reviewer: Codex, independent of document authors; roles 08_Security_Architect + 06_UX_UI_Design_Architect.
Framework: EAAF v1.3.0 @ 167cea36c09c1031c763971ff790db2e0d0f7362 + Lean profile.
Round: 1 of maximum 2. REVIEW ONLY.
Verdict: BLOCK (Security: PASS WITH ADVISORIES; UX: BLOCK).
This joint assessment does not replace the separate independent 05_Frontend_Architect approval required by the project gate.

## Subject binding and evidence
PR metadata resolves the unspecified PR/SHA to #64 and the subject above. Both ZIP documents match the fetched subject files byte-for-byte.
ZIP SHA-256: 26ec043b8ba745038eb7f0e9056c2cd270dbd2c4922dd6fc598c4e2fb7a7fa26.
FRONTEND_ARCHITECTURE.md SHA-256: 64d11b512dd2bbbdd724e7d0e3bc398634c83976e659e85dca5748e7d1ec4ef4.
VISUAL_SYSTEM.md SHA-256: c7c0253109a1ba340dabc7691e87c5bb15b374d47d1e6291f0fb579ac5876c97.
Source citations below refer exclusively to this subject SHA.
Document architecture assessment; implementation, axe scans, interaction tests and hardware benchmarks NOT EXECUTED and not claimed as passed.

## Gate coverage
IMPLEMENTATION_PLAN.md, Frontend Architecture Gate (non-executable prerequisite of WP-026A):
| Required topic | FRONTEND_ARCHITECTURE.md |
| --- | --- |
| Routing | §3 |
| State management | §7 |
| Session boundaries | §4 |
| API/IPC boundaries | §1, §5 |
| Client contracts | §6 |
| Caching | §7 |
| Offline presentation | §8 |
| Error architecture | §9 |
| Component library | §2, §10 |
| Primitive/component boundaries | §10 |
| Variants/composition | §10 |
| Token consumption | §11 |

All twelve topics have explicit decisions. React + Electron 30+ + Tailwind remain selected. ADR-003 isolation, sandbox and disabled renderer Node are preserved in §13; ADR-005 HTTP/OCC, ws, heartbeat and reconnect resync are incorporated by frozen inputs and §5/§7; ADR-012 formatting-only UI is stated in §10, with the terminology advisory below. No ADR file is modified by the two-file candidate.

UX-COND-015-01: targets 44×44 in VISUAL_SYSTEM §5 and frontend §12; all three dimensions 1024×768, 1280×800, 1440×900 and reflow in visual §6; keyboard/focus in frontend §12 and visual focus token; reduced motion visual §7; WCAG 2.2 AA target stated but color defect below prevents accepting the specification as meeting it.
UX-COND-015-02: shared tokens, primitives and variants across Salón/KDS/Caja in frontend §10–11 and visual §1/§10. One language with differing densities, not separate design systems.

## Blockers
### FE-R1-UX-BLK-01 — specified soft success/warning text falls below AA
Citation: VISUAL_SYSTEM.md §2.1, sentence prescribing 12% solid-hue opacity over surface with the solid token for text, and introductory universal contrast assertion; FRONTEND_ARCHITECTURE.md §10 tone=soft; IMPLEMENTATION_PLAN.md WP-026B Acceptance Criteria UX-COND-015-01 (inherited by C/D).
Reproduction: composite sRGB foreground hue at alpha 0.12 over surface #FFFFFF, then compute relative luminance and (Lhigh+0.05)/(Llow+0.05):
- success #15803D: 4.265987326152777:1.
- warning #B45309: 4.261507848551279:1.
Both are less than 4.5:1 for ordinary text. §3 allows 14/16px ordinary labels; the soft prescription imposes no large-text-only restriction. The defect is in the specified token pairing, independently reproducible without an implemented screen.
Risk: ordinary status/badge labels cannot meet the declared AA minimum; an assertion calculated against plain surface misses the composited background.
Closure: define compliant ordinary-text/background pairs for every permitted soft semantic tone in both themes, document measured ratios >=4.5:1 (unrounded threshold), and remove the unsupported universal assertion or substantiate all supported pairings. No implementation proposal or source mutation is made by this review.

## Advisories
### FE-R1-UX-ADV-01 — restrict low-contrast border usage
Citation: VISUAL_SYSTEM.md §2.1/§2.2 border tokens; §10 component inventory.
Measured ratios: light #CBD5E1 vs white 1.48470221380943 and bg 1.4190352179009544; dark #334155 vs surface 1.6417549186436304 and bg 1.808166478996344.
Risk: if these borders alone identify an empty input or required state, they fail the 3:1 non-text requirement. Decorative boundaries and controls identified by other sufficiently contrasting information are exempt, so this review does not assert an unconditional additional blocker.
Criterion: distinguish decorative separators from required control/state identification and specify a compliant visual identifier for the latter.

### FE-R1-SEC-ADV-01 — make inherited station authentication explicit
Citation: FRONTEND_ARCHITECTURE.md §1, §4–5, §13; ADR/ADR-005-local-lan-communication-protocol.md §9.
Signed station/device authentication in the WS handshake remains binding through the frozen ADR; the new EventRelay description does not explain how it consumes that identity. No bypass is specified or reproduced, so advisory.
Criterion: explicitly map main-process EventRelay to the inherited signed station handshake and rejection of absent/invalid identity; keep credentials outside renderer.

### FE-R1-SEC-ADV-02 — disambiguate money transport and session-cache lifecycle
Citation: FRONTEND_ARCHITECTURE.md §10 “minor units / fixed-point strings”, §4/§7; ADR-012.
Risk: generic “minor units” may be read as cents rather than canonical scale-four money; cache keys lack principal while expiry clearing is specified but explicit logout/session replacement is not.
Criterion: explicitly retain ADR-012 canonical four-decimal string transport and exact formatting without Number arithmetic, and define cache/draft clearing plus stale in-flight response handling on every principal/session transition. No implemented monetary loss or cross-user disclosure is claimed.

### FE-R1-UX-ADV-02 — complete reusable token specifications during design-system realization
Citation: VISUAL_SYSTEM.md §4, §8, §10; FRONTEND_ARCHITECTURE.md §11.
Shadow names have no values and icon set is illustrative (“e.g. Lucide”). These do not erase the required component/token architecture.
Criterion: freeze concrete values and one selected icon family before consumers require them; preserve the shared visual language.

## Method and normative reference
Independent numerical reproduction used standard sRGB linearization: c/12.92 for c<=0.04045, otherwise ((c+0.055)/1.055)^2.4; luminance=0.2126R+0.7152G+0.0722B. Soft compositing performed on normalized sRGB channels before luminance conversion.
W3C WCAG 2.2 contrast and non-text guidance:
https://www.w3.org/TR/WCAG22/#contrast-minimum
https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
The latter explicitly exempts decorative boundaries and controls otherwise identifiable; the border issue is consequently advisory.

## State and handoff
STATE=BLOCK
BLOCKER_IDS=FE-R1-UX-BLK-01
ADVISORY_IDS=FE-R1-UX-ADV-01,FE-R1-SEC-ADV-01,FE-R1-SEC-ADV-02,FE-R1-UX-ADV-02
Next destination: Coordinator for bounded remediation and, if authorized within the two-round budget, R2 review. This is not APPROVED/FROZEN or authorization to start WP-026A, merge or deploy.
Subject branch and files unchanged. GIT_SIDECAR evidence on canonical base; PR review is notification only.
