# web-voyager — shared-ticket multi-session challenge (Playwright, JavaScript)

Two users, one record (`TCK-101`), two isolated browser sessions. The suite proves live sync,
last-write-wins collisions, stale-data rejection, popup handling and clean-up, with the
evidence the brief asks for.

## Layout

| Path | What it is |
|---|---|
| `app/server.js` | Small ticket tracker used as the system under test (login, ticket page, live sync via Server-Sent Events, print preview, JSON API). In-memory, test accounts only. |
| `lib/fixtures.js` | Fixtures: run-tagged logger, API client, `ticket` (create fresh / delete + verify), `sessions` (User A and User B contexts, dual screenshots). |
| `tests/shared-ticket.spec.js` | The six checks from the "What done looks like" slide. |
| `playwright.config.js` | One `RUN_ID` and one app instance on a free port per run; trace retained on failure; reports under `evidence/<RUN_ID>/`. |
| `scripts/stability.js` | 10 consecutive headless runs -> `evidence/stability-run-log.md`. |
| `scripts/parallel.js` | 3 runs started at once -> `evidence/parallel-run-log.md`. |
| `scripts/check-no-waits.js` | Fails if any test/fixture contains `waitForTimeout`, `sleep`, `setTimeout`, ... |
| `evidence/sample-run/` | A committed evidence pack from one run: `run.log`, screenshots from both sessions per test, popup screenshot, `results.json`. |
| `TRANSPARENCY.md` | Where Claude got it wrong and how it was fixed. |

## Run it

```bash
npm ci                      # packages from the Artifactory mirror (see .npmrc.example)
npm test                    # one run, headless
npm run check:no-waits      # no-fixed-waits gate
npm run stability           # 10 consecutive runs, appends to evidence/stability-run-log.md
npm run parallel            # 3 simultaneous runs, appends to evidence/parallel-run-log.md
npx playwright show-report evidence/<RUN_ID>/html-report
npx playwright show-trace evidence/<RUN_ID>/test-results/<test>/trace.zip   # only on failure
```

Requires Node 18+ and Playwright's Chromium (`npx playwright install chromium`).

## How each check is done

| Check | Test | How it is asserted |
|---|---|---|
| Sessions | *Sessions: two isolated contexts...* | Two `browser.newContext()`s, each logs in through the real form; both show `TCK-101`; session cookies differ. |
| Sync | *Sync: A changes status...* | A saves `In Review`; `expect(B.status).toHaveValue('In Review')` with no reload (SSE push), then again after `reload()`. |
| Collision | *Collision: A and B save...* | A saves `High`, B saves `Low`; server `updatedAt` gap asserted `< 1000 ms`; final record fetched from the API; both screens asserted to show that one value, version and editor; winner written to `run.log` as `COLLISION RESULT: winner=B ...`. |
| Stale data | *Stale data: B deletes...* | B deletes (204); A, never refreshed, edits and saves; PUT returns 410 and the page shows **Record no longer exists**. |
| Popup | *Popup: A opens "Print preview"...* | `context.waitForEvent('page')` around the click; popup URL and content checked; popup closed; `context.pages().length` back to 1; A's unsaved title still in the input, version still 1. |
| Clean up | fixture + *Clean up: ...* | Fixture asserts `GET /api/tickets/TCK-101` is 404 **before** creating, deletes after, asserts 404 again. The test deletes and re-creates to show a rerun starts identical. |

## Requirements -> evidence

| Requirement | Where |
|---|---|
| No fixed waits: zero `waitForTimeout`/`sleep` | Code review of `tests/` and `lib/`; `npm run check:no-waits` passes. Every wait is an auto-retrying `expect`, `waitForResponse` or `waitForEvent` on a real signal (DOM state, HTTP response, new page, `body[data-live=connected]` for the SSE channel). |
| Stability: 10 consecutive green headless runs | `evidence/stability-run-log.md` |
| Parallel safety: 3 runs in parallel, no interference | `evidence/parallel-run-log.md` (each run on its own port with its own app process and `RUN_ID`) |
| Traceability: session-tagged logs, screenshots from both sessions, trace on failure | `evidence/sample-run/run.log` (every line carries `[run=..] [test=..] [session=A|B|-]`), `*-session-A.png` / `*-session-B.png` per test, `trace: 'retain-on-failure'` in the config |
| Transparency: where Claude got it wrong | `TRANSPARENCY.md` |
| Ground rules | Self-declaration below |

## Ground rules — self-declaration

- **Artifactory only.** The only dependency is `@playwright/test`; `.npmrc.example` points `npm` at the internal Artifactory npm remote. No other registries, CDNs or downloads are used at run time.
- **Test accounts.** The app under test ships two fixed accounts, `usera.test` and `userb.test`, with throwaway passwords. No real user credentials exist anywhere in this directory.
- **No Lilly data out.** The system under test is an in-memory stand-in that runs on `127.0.0.1`; the only record is the synthetic `TCK-101` with the title *Initial title*. Nothing is sent to any external host. Evidence files contain only that synthetic data.

## Design notes

- Within a run the tests share `TCK-101` as the brief describes, so they run serially (`workers: 1`). Isolation between runs comes from a fresh app process per run, which is why three parallel runs cannot interfere.
- The app's live sync never overwrites a field the user has changed but not yet saved (see `TRANSPARENCY.md` for why this matters).
