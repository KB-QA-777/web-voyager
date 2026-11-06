# Transparency note — where Claude got it wrong and how it was fixed

This suite was written by Claude (Claude Code) from the two slides in the brief. Everything
below was observed during the session, not reconstructed afterwards.

## 1. The collision test failed on the very first run — and the test was right

**What happened.** The first full run was 5 green, 1 red. The *Collision* test expected both
screens to end on `Low` (B's write lands last, last-write-wins). The run log said:

```
COLLISION RESULT: winner=B (userb.test) final priority=High version=3 gap=34ms
```

Winner B, but B had saved `High`, not `Low`.

**Why.** Claude's first version of the ticket page applied every live-sync event to every
form field. Sequence: B selects `Low` (unsaved) -> A saves `High` -> the server pushes
`High` to B -> the page overwrote B's pending `Low` with `High` -> B's Save then sent `High`.
A "keep the focused field" guard Claude had added did not help because after clicking
Save the focused element is the button, not the select. So the test exposed a real
defect in the app Claude had written: live updates clobbered unsaved user edits.

**Fix.** The page now tracks *dirty* fields (changed since the last successful save) and
live events skip them; the set is cleared only when the user's own save succeeds. The
test was not changed. This is also what makes the *Popup* check ("unsaved edits are
intact") honest rather than accidental.

## 2. Out-of-order updates could flicker the wrong value

**What happened.** While reviewing the collision path Claude noticed that A's own save
response (version 2, `High`) and the live event for B's later save (version 3, `Low`)
can arrive at A in either order. Applying them naively could leave A showing `High`
after it had already shown `Low`.

**Fix.** The page ignores any update whose version is lower than the one already on
screen. This was fixed before it produced a failure, but it would have shown up as a
flaky collision assertion under the 10-run stability batch.

## 3. First draft used the focused element as a proxy for "being edited"

**What happened.** Claude's first attempt at protecting unsaved edits read
`document.activeElement.name`. For the Save button that is an empty string, so the
code would have thrown on `form[""].value` the first time a live event arrived while
the button had focus.

**Fix.** Replaced by the explicit dirty-field set described in item 1.

## 4. Things Claude considered and deliberately did not do

- **Retries.** `retries: 0` in the config. A retry would hide exactly the kind of race
  item 1 exposed; the stability log must be ten *first-attempt* greens.
- **A shared app for all runs with per-run ticket IDs.** Rejected because the brief
  names a shared `TCK-101`. Per-run app processes on free ports give isolation without
  renaming the record.
- **`waitForTimeout` in the collision test to force "same second".** Not needed: A's
  save is awaited via `waitForResponse`, B's follows immediately; the server-side
  timestamps are asserted to be under 1000 ms apart (observed gaps: 34 ms and 106 ms).

## 5. What a human should still check

- The app under test is a stand-in written for this exercise. Against the real ticket
  system the selectors (`data-testid`), the login flow and the 410 response contract
  will need mapping; the test structure and the fixtures do not.
- The Artifactory host in `.npmrc.example` has to be filled in by someone with the URL.
