# SHIZUKA (Quiet Precision) — source-grounded frontend audit and improvement pipeline

**Product:** Garh Jaisal seven-room, local-first FortLedger. Baseline: main at `4c2a64a` (PR #112), 22 November 2026. This is a design and interaction track only; the financial ledger and API invariants are not changed.

## Confirmed audit findings

1. `public/styles.css` still seeds the retired green-era `:root` colors, while the later `public/heritage-sky.css` defines the actual navy/off-white look. This duplicates typography, background and palette ownership. The active root is now explicitly the SHIZUKA source of truth.
2. The eight primary sidebar links were text-prefixed with mixed symbols (diamond, chess pawn, tea cup, gear, etc.), creating inconsistent widths and icon families. New 20px/1.8-stroke **local SVG symbols** preserve semantic link names with `aria-hidden` graphics.
3. Header/main desktop/tablet/mobile padding had competing 12/18/20/24/32/44px rules, with narrow mobile panels at 13px. Establish 32/24/16px page padding and tokenized panel/form spacing; preserve intentional domain layouts.
4. The mobile More menu used heritage-gold focus outlines, inconsistent with other controls' documented blue focus. Standardize visible blue focus.
5. There was no keyboard skip-to-main shortcut. Add one that focuses the active main landmark without changing the hash route, booking or financial task.
6. Initial synthetic Chromium screenshot at 1440px showed the Reservation ledger title wrap into two lines as the queue and status filters competed inside a single flex header. The booking header now uses explicit desktop grid areas, one-column task groups below 1250px and single-column filters below 600px, with a real layout/clipping browser assertion.
7. Browser smoke already exercises seven CSS viewport widths and the real authenticated roles, but had no retained screenshot artifacts or narrow reflow proxy for 200% zoom. Extend evidence. Browser automation is not an actual physical hotel Mac inspection.

## Canonical design contract

The existing `public/heritage-sky.css` owns SHIZUKA semantic tokens. Keep backwards-compatible `--hs-*` aliases so existing operations, rooms, restaurant and finance modules stay legible without a broad rewrite.

| Purpose | Token | Value |
| --- | --- | --- |
| Canvas | `--sh-washi` | #F8F6F1 |
| Surface | `--sh-paper` | #FFFEFB |
| Structure | `--sh-indigo` | #192B42 |
| Positive | `--sh-moss` | #20675B |
| Accent only | `--sh-brass` | #A77C4A |
| Negative | `--sh-vermilion` | #A33D39 |
| Borders | `--sh-stone` | #E5E0D7 |
| Secondary text | `--sh-slate` | #5C6977 |
| Focus | `--sh-focus` | #245DA8 |

Spacing uses a 4px base with 8px rhythm: `--sh-space-{1,2,3,4,5,6,8,10,12,16}`. Primary buttons/form controls target 44px, icon stroke 1.8, nav icons 20px. Brass text is **not** sufficient for ordinary text at WCAG AA on paper, and must not indicate success or failure.

## Roadmap (verified scope rather than a rebuild)

| Order | Track | Work | Verification gate |
| --- | --- | --- | --- |
| 1 | **Foundation — this PR** | Semantic palette, spacing/typography, consistent offline icons, mobile focus, keyboard skip, testable contrast | Unit + browser CI and screenshot artifacts; no backend writes |
| 2 | **Shared components** | Inventory and consolidate repeated button, table, form, dialog and feedback rules; minimize CSS cascade conflicts incrementally | Before/after at identical widths, focus/disabled/error states |
| 3 | **Primary workspaces** | Dashboard hierarchy, arrivals and in-house cues, seven-room cards, invoice document states, restaurant bill review | Real operator tasks with time and mis-click observations |
| 4 | **Responsive/accessibility** | 200% browser zoom and assistive technology, keyboard dialog focus, 360/390/768/1024/1440/1920 layouts | Visual/functional signoff; WCAG claims only after audit |
| 5 | **Final craftsmanship** | Remove now-obsolete CSS, tighten microcopy, screenshots across all states, review performance | Representative Mac+phone walkthrough; no hidden financial changes |

Parallel **business safety** priorities remain: audited saved-bill correction/credit (separate accountant-reviewed design), price editor with signed review, and the outstanding Mac/Epson/backup/GST acceptance gates. The restaurant **read-only recorded-event reconciliation CSV** is now delivered separately (see `docs/RESTAURANT_RECONCILIATION_EXPORT.md`); independent bank verification is not implemented. Do not mix ledger mutations into visual PRs.

## Evidence limits and delivery

Source audit and Node tests are reproducible. CI can save **after-change** Chromium screenshots using synthetic hotel data, but no verified before-change screenshots exist yet. Record these gaps explicitly. Screenshot pixels alone are not WCAG certification. All PRs must pass Linux, Windows and Chromium before merging. FortLedger remains ACTIVE ALPHA — NOT RELEASED.

Screenshot notes: screenshot collection crops to the configured CSS viewport width and scrolls to the top; an intentionally horizontally scrollable calendar remains usable inside its own region. Artifact capture is an inspection aid, not evidence that visual mismatches are all eliminated.

Follow-up visual inspection of the real synthetic Chromium reservation-panel PNG found the final desktop queue chip cut off. Desktop work queues now wrap instead of concealing filters horizontally; narrow mobile retains intentional, labeled horizontal scrolling.

## Phase 2 implementation — shared controls and safe confirmation (22 November 2026)

The source audit found that `public/login.html` loaded only the earlier green-era `styles.css`, so authenticated workspaces and sign-in used different visual languages. The base file also duplicated primary/secondary buttons, labels, inputs, close buttons, form previews and dialog-action layouts already owned by SHIZUKA. Those **shared presentation declarations** are now consolidated into `public/heritage-sky.css` and the login loads that same offline stylesheet.

One shared native `<dialog>` confirmation component is now reused for **clearing an unsaved restaurant draft** and **manager dish availability**. Both are non-ledger destructive choices. Financial save/payment/refund/settlement confirmations remain under their existing audited workflows, with server guards unchanged. The shared component includes an explanation, action-specific labels, Escape/Cancel, keyboard-focus handling, a single-flight guard and no untrusted HTML injection.

Shared input sizing deliberately excludes checkbox and radio controls. The two daily close acknowledgements retain ordinary checkbox dimensions and full clickable label rows. Booking, proforma, folio and draft dialog elements gain explicit accessible names. Forms, buttons, error messages and overlays use SHIZUKA spacing and colors rather than legacy per-screen green styling.

Acceptance gates: Node tests for helper concurrency/focus/cancel and CSS ownership, Chromium login CSS parity, real mobile manager confirmation cancel/save, real unsaved bill cancel, existing booking/payment/invoice checks. Mac Safari, actual screen readers, and historical visual baselines are **still not certified**. Next phase: improve primary workspaces and continue targeted CSS cleanup without replacing business logic.
