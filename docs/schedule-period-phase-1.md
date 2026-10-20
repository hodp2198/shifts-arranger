# Schedule periods and Excel importing: Phases 1–2

`src/schedulePeriodService.js` owns date-only period rules. The UI keeps one
canonical `state.period`, persisted as `schedulePeriod` in the existing draft.
The service uses an Asia/Jerusalem calendar date and UTC date arithmetic. Its
`weekStartsOn` setting defaults to Sunday; the UI currently supports Sunday only.

Automatic proposals start on the first Sunday strictly after both today and the
greatest active official coverage end. Old `savedAt` values and archived periods
do not influence the proposal. Saved drafts retain their dates; selecting
“רענן הצעה אוטומטית” only refreshes the separate preview. Manual periods may precede
future official coverage, but official saving requires the existing replacement
confirmation for every overlap, including the same period ID. History is reloaded
before saving; a failed load blocks generation, save and export.

## Manual period preview and Apply

The period selection section is always visible above special-day settings. Its
date picker has no minimum: past Sundays can be inspected with warnings, while
generation/save/export retain the future-Sunday rule. Week counts remain 1–8.
Input and native change events update only preview ranges and warnings, including
overlaps and import applied/skipped/issue counts. The active canonical period,
grid, employee activation and constraints are untouched; autosaves serialize the
active period's week count, never a pending preview. The automatic recommendation
can be staged in these same controls or refreshed separately. Cancel restores the
controls to the active period without changing data.

Apply requires confirmation when a grid, imports, constraints or other affected
input exists. It uses the recoverable backup/switch service even for an empty
draft. Backup failure leaves the active draft unchanged and shows the failure
beside the controls. On success the selected period becomes canonical; old
assignments remain recoverable in the backup and must be generated again.
Excel weekly blocks map by sequence into the newly selected canonical period,
after confirmation. Their original headers remain preserved as information only.
Manual constraints, special dates and assignment
overrides remain intact; mismatched period-bound input blocks generation rather
than being shifted or cleared. Official history is never written by Apply.

## Automatic constraint import

`src/constraintImportService.js` interprets Excel separately from the scheduling
engine. It matches normalized headers to employee names or configured aliases,
independently of column order. Unique new names create employees with the existing
defaults. Ambiguous/shared aliases require manager selection; fuzzy matching is
not used. Each employee column has its own weekly blocks, including staggered
rows and different block counts. The canonical period is never taken from an employee.

Version 3 explicitly replaces the former date-anchored model with
`mappingMode: "block-sequence"`. Employee-written dates and week numbers are
informational only. The first detected block maps to canonical week 1, the next
to week 2, and so on, with each entry placed by weekday. Date labels delimit
blocks without being validated or used for dates. Headerless completed weekday
cycles and separated Sunday restarts also establish blocks. Repeated weekdays
without a clear boundary and consecutive empty headers require an explicit manager
block selection. Unknown weekdays require weekday selection. Saturday aliases
`ש`, `ש׳`, `שבת` are supported. Extra blocks beyond the selected week count are
retained and listed as skipped; shorter employee submissions need no padding.
Changing periods through confirmed Apply remaps block positions to the new period.
It never changes the manager's week count or official history.

Known availability, unavailability, preferences and weekly exclusive-day statements
become typed dated records. Neutral comments such as `יום בחירות` are preserved
as notes and use the existing default availability rule; explicit unavailability
with a comment stays blocked. Ambiguous availability, partial-shift restrictions
and contradictory availability require review. Unambiguous records apply
immediately, but unresolved issues block generation, official saving and export.
Managers can supply an explicit interpretation or explicitly retain a record
outside this schedule. Decisions and original text remain visible. New contradictory
evidence invalidates an older conflict decision. Blank/unreported days inside a
submitted weekly block remain open; unresolved restrictions do not.

## Submission and participation

A name-only or empty employee column is not a submission. A detected weekly block,
including a header-only block with no restrictions, is a submission for that week.
Employees participate automatically only in their submitted weeks. A one-block
submission in a two-week period does not participate in week 2. Imported block
positions still follow canonical week-by-sequence mapping; date headers remain
informational. Existing dated manual constraints can also establish participation
in the weeks they actually cover. Explicit manager one-time rules retain their
existing targeted behavior.

Each worker has a visible participation label. The activation checkbox allows the
manager to include a non-submitter for the entire selected period; explicit blocked
days still apply. Manual activation/deactivation is stored separately with the
canonical period key, survives reload and reimport, and does not carry into another
period or a new schedule. A restored pre-rule grid remains preserved, but cannot
be saved/exported with employees who no longer participate; regenerate or activate
them explicitly. In the audited screenshot, Siwar's empty column now requires
manual activation before Siwar can receive assignments.

The scheduling adapter masks non-participating dates without changing the engine
or holiday rules. New official constraint snapshots store optional
`participationDates`; absent weeks contribute neither opened nor closed fairness
days. Artificial scheduling exclusions are separate from explicit unavailability.
Historical official records without this metadata retain their previous counting
rules. No official record is migrated, rewritten or resaved automatically.

The draft stores `constraintImport`: original sources, JSON-string matrices,
original import metadata, dated records, notes, skipped entries, issues and manager decisions.
Matrices use strings because Firestore disallows nested arrays. Every import and
manager decision first preserves a complete recoverable draft through the existing
backup/switch service. Repeated identical matrices are idempotent; different sources
merge and contradictory restrictions require review rather than being overwritten.
Use a new schedule to start with a clean source set. Oversized backups fail safely.

Saved version-2 imports are not automatically converted on load or period changes.
They retain their original data, and generation/save/export are blocked until the
manager explicitly reimports and confirms switching models. Conversion first backs
up the entire old draft, reparses all retained sources and resets old interpretation
decisions rather than carrying decisions across incompatible models. Canceling or
backup failure leaves the old import untouched. One-time notes under the separate
`הערות` divider retain explicit dates; they do not define weekly blocks or periods.

The worker data adapter combines typed imported records with separately labeled
manual inputs. Conflicting or unparseable manual input blocks generation. The
existing manual parser, scheduling algorithms, holiday module, fairness and official
records remain unchanged. Legacy drafts keep their original fields; reimporting
the exact old column text replaces only that recognized legacy import after backup.
Mixed legacy/manual text requires explicit review. Nonconsecutive legacy periods
remain preserved and require a new canonical schedule before reimporting.
Changing periods invalidates output and cached calendar links. Existing manual
constraints/overrides continue to require explicit handling when periods change.

## Recoverable draft switching

The interface labels a restored draft separately from today's automatic proposal.
Refreshing that proposal never writes or replaces the active draft. “התחל סידור
חדש ושמור עותק מהטיוטה” refreshes official coverage, asks for confirmation, then
preserves the entire current draft before switching to the proposal. Employee
definitions/settings remain; activation, constraints, imported text, one-time
notes, date overrides and assignments do not transfer into the new period.

Backups include all editable draft fields plus runtime assignments, workers,
dates/sets, warnings, shuffle seed, rejected grids and pending form values.
`draftSnapshot.js` preserves runtime types, and restored grid entries reconnect
to the worker registry. The existing renderer is used without regenerating or
reapplying manual overrides. A past/unresolved grid remains stored but is not
rendered as a usable schedule.

In cloud mode, an owner-scoped Firestore batch writes both
`users/{uid}/draftBackups/{id}` and `users/{uid}/appData/current`; neither write
commits alone. An in-flight autosave finishes before the batch, preventing an
older save from overwriting the new draft. Existing owner rules cover this path;
official history and fairness storage are untouched.

In isolated mode, backups use independent `isolated_dev_draftBackup_{uid}_{id}`
localStorage keys. A backup is written before current is replaced. If either
write fails, the original current stays intact. If only the second write fails,
the extra backup also remains recoverable.

Choose an entry under “עותקי טיוטות לשחזור” and click “שחזר טיוטה נבחרת”. Restoring
first backs up the draft being replaced. Copies are not automatically deleted.
Isolated copies remain browser-local; clearing that browser's site storage removes
them. Cloud documents remain subject to Firestore's existing document size limit;
an oversized backup fails without clearing the current draft.

Every rendered assignment is checked against the canonical period, week index,
weekday, actual Date and date uniqueness. Outdated grids are retained as rejected
snapshots, hidden, and blocked from official saving, copying and calendar export.

Overlap checking retains the existing client-side save workflow. It is not a
transactional lock across simultaneous tabs or managers. Shared-organization
ownership and cross-client concurrency enforcement remain outside Phase 1.

## Safe automated verification

From the repository root, run:

```powershell
node scripts/check-syntax.js
node --check src/schedulePeriodService.js
node scripts/test-schedule-period.js
node scripts/test-manual-period.js
node scripts/test-participation.js
node scripts/test-constraint-import.js
node scripts/test-excel-date-import.js
node scripts/test-draft-safety.js
node scripts/test-environment-isolation.js
node scripts/test-fairness-tracking.js
node scripts/test-isolated-workflow.js
git -c core.fsmonitor=false diff --check
```

These checks use local code and in-memory fakes. Import tests exercise the screenshot
column layout, Daniel's two blocks with inconsistent headers, Hod's election note,
Naomi's Saturday shorthand, matching, parsing, conflicts, backups, version migration,
restoration, period switching and the engine adapter. Daniel's small second header
is represented by a malformed range; its exact transcription is immaterial to
mapping and it never blocks importing. Tests also exercise existing holiday/fairness rules. Do not run
`scripts/test-access-request-lifecycle.js`: it writes to production Firebase.

## Manual verification in isolated development mode

1. Run `node scripts/dev-server.js` and open
   `http://localhost:3000/?dev=true`. After updating the application, use
   Ctrl+Shift+R so an older in-memory page cannot keep running.
2. Verify the **TEST MODE** title/banner. `?dev=true` now selects the isolated
   user automatically before authentication starts. Google login/access requests
   are unavailable in this environment. Application and official data use the
   existing `isolated_dev_*` localStorage keys; real history is not loaded.
3. In the always-visible period selection section, with empty isolated history, the proposal must
   be the next future Sunday in Israel. On a Sunday it must be seven days later.
4. Change the manual date and week count. Preview ranges must update immediately
   while the active period, grid and constraints stay unchanged. Try a weekday,
   today, a past date, 0 weeks and 9 weeks. Invalid inputs must warn; past Sundays
   remain inspectable and applicable, but cannot generate schedules. Select a
   future Sunday and 1–8 weeks, then Apply. With existing data, cancel confirmation
   first and verify no change; then confirm, check the backup and restore it.
   Verify the automatic recommendation remains available independently.
5. Add at least two test employees, generate and save an official schedule.
   Select “רענן הצעה אוטומטית”: the separate proposal must follow its coverage end,
   while the current draft stays unchanged.
   Select the saved period manually, regenerate, and verify that saving requires
   replacement confirmation. Canceling must leave the official history intact.
6. Select October 25, 2026 and two weeks (while it remains future). Paste the Excel
   table including headers and click “שייך לעובדים”. Verify employee matching,
   applied records and any review items. All first blocks must map to October 25–31,
   all second blocks to November 1–7, regardless of written dates. Daniel's malformed
   second header must not block his November constraints. Hod's election note in
   block 2 must appear on November 3 with default availability. Naomi's `ש` entries
   must block October 31 and November 7. Reorder columns
   and confirm identical dates. The period and original source must stay unchanged.
   Check the recoverable copy list, reload, and verify imports persist.
   Verify Siwar's empty column is inactive. Manually check Siwar to include them,
   wait for autosave, reload and verify the manual activation persists. Also test
   a single submitted block: the employee must be eligible only in week 1 until
   manually activated for the full period. Save only in TEST MODE and verify missing
   weeks do not add fairness opened/closed days; historical counts must stay intact.
7. Resolve genuinely unclear headers/wording in the review panel. Generation must
   remain blocked until every issue is resolved or explicitly deferred. Verify a
   blocked employee is not assigned on that date. Preview another period: active
   data must stay unchanged. Confirm Apply: imported block positions must map to
   the new period, with the prior draft recoverable. Add a
   conflicting manual constraint and confirm that it blocks generation. Restore
   a draft backup and confirm its original inputs and import decisions return.
8. To simulate a history failure without contacting Firebase, temporarily replace
   `window.fairnessService.loadOfficialSchedulesDocs` in browser DevTools with an
   async function that throws, then click “טען היסטוריה מחדש”. Verify that the
   selected period stays put and actions are blocked. Restore the original
   function and retry. No empty-history proposal should appear on failure.
9. Add distinctive worker constraints and pending notes to the current draft.
   Refresh the automatic proposal: verify every draft field and grid stays put.
   Click “התחל סידור חדש ושמור עותק מהטיוטה” and confirm. The new period must use
   today's proposal and have no old constraints, imports, overrides or assignments.
   Employees remain registered but inactive until explicitly selected.
10. Select the preserved draft and click “שחזר טיוטה נבחרת”. Confirm. Verify the
    original period, constraints, notes and valid grid return. The draft you just
    left must also appear among the recoverable copies. Reload the page and verify
    that the recovered draft and copy list persist. It must be labeled as restored.
11. On October 20, 2026, an October 18 draft must remain labeled as a restored
    past draft, while the separate two-week proposal is October 25–November 7.
    Its old grid must not be rebuilt. Starting new must first preserve that draft.

Stale-entry and invalid-Date rejection, storage failures and autosave ordering are
covered by `test-draft-safety.js` with in-memory storage/Firestore fakes. These
tests never contact production Firebase.

The static page still needs its existing Firebase CDN modules to load before the
application initializes; isolated data operations themselves use localStorage.

## Development environment boundary

`runtimeEnvironment.js` runs first on both pages. Exact `?dev=true` selects a
fixed test environment for the lifetime of that document, including logout and
delayed saves. A remembered real Firebase login is not observed in test mode.
The old `isolated_dev_active` preference no longer selects the environment.
Opening the app without `dev=true` retains normal production authentication and
overlap protection; localhost by itself does not select test mode.

The October 25–31 production official schedule has no effect on test proposals,
overlap checking or fairness, since those read only isolated official records.
If you have already saved an October 25 test schedule locally, it can still
advance the automatic test proposal. You can manually choose October 25 again;
the existing replacement confirmation then refers only to that local test record.
No production record is replaced. Future-Sunday and pending-import validation
continue to apply in test mode.

Drafts, draft backups, official history and derived fairness use test storage.
Calendar preview links also use browser-local test payloads and include
`dev=true`; they work only in the same browser/origin. Missing test links never
fall back to production Firestore. Google Calendar writes and calendar-file
exports, OAuth, Firebase login and all access-request/GAS actions are blocked.
Legacy caches, calendar event caches and backend-URL preferences are namespaced,
so test logout/cleanup cannot remove normal-mode browser state. Service boundaries
fail closed if their environment bootstrap is missing.

Safe verification: save a local official test schedule for October 25, review its
test fairness, create/open its test preview link, and restore a test draft. The
banner must remain TEST MODE and no real Google Calendar authorization should be
offered. `test-environment-isolation.js` runs these service paths with in-memory
storage and throwing/recording Firebase/network fakes, including normal-mode
regressions. It never contacts or modifies production Firebase.
