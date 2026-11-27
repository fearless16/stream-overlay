# Dual-live review fixes: plan

Seven bugs were found in review of the dual-live go-live control at baseline commit `34fc343`. This document is the plan for fixing each one. It is committed before any fix so the plan exists before the code changes, as `docs/obs-dual-format-plan.md` requires.

## Process

1. Each fix is its own branch, created from the feature branch tip after the previous fix has merged. This avoids merge conflicts between fixes that touch the same functions.
2. Write the failing test first and record that it fails (RED). Then make the smallest change that passes (GREEN).
3. Run `npm run test:portrait` before committing. It must pass: the existing 28 tests plus the new ones.
4. Commit only the files a fix names. Never commit the sticker-overlay edits in `chat-overlay.html` or `package.json`; they stay uncommitted in the working tree.
5. Merge into `feature/obs-dual-format` with `--no-ff`. Nothing is pushed.
6. New tests go in `tests/dual-live.cjs`, not in `package.json`. That keeps every fix branch off the sticker-only script line.

Order: A, B, C, D, E, F, G. C and D both change `Feed`. E, F, and G touch the go-live path, and G builds on E's stop logic.

---

## A. Portrait Virtual Camera is not blocked by go-live

**Branch:** `fix/dual-live-portrait-virtualcam-gate`

**Problem.** `gate()` in `dual-format/ops.cjs` checks that horizontal's Virtual Camera is running. It never checks portrait's. The plan (`docs/obs-dual-format-plan.md`, line 26) says portable OBS never publishes Virtual Camera. The manual `send-vertical` path refuses when it's on (`ops.cjs` line 214). The one-click path does not, so it allows a state the manual path forbids.

**Change.** `gate()` adds a blocker when `vertical.virtualCam` is on. Because `gate()` is shared, `status` and `send-vertical` get the same rule.

**Tests (RED first).**
- `gate()` reports a blocker when portrait's Virtual Camera is on, and none when it's off.
- `goLive` refuses with portrait Virtual Camera on, and sends no OBS command.

**Acceptance.** Both new tests fail on the baseline and pass after the change. All existing tests still pass.

**Risk.** Low. Only adds a blocker.

---

## B. A JSON `null` body returns 500 instead of 400

**Branch:** `fix/dual-live-control-null-body`

**Problem.** `readJson` in `dual-format/control.cjs` accepts any JSON value. A body of `null` reaches `body.action` (line 66), which throws. The generic handler then returns 500 "Unexpected error" and logs an internal error. A bad request is reported as a server fault.

**Change.** `readJson` accepts only a JSON object. Anything else (`null`, an array, a string, a number) gets 400 "Body must be a JSON object".

**Tests (RED first).** POST `null`, `[]`, and `"text"` each return 400. Existing 413, 415, 403, and 404 tests still pass.

**Acceptance.** The new tests fail on the baseline (500) and pass after the change.

**Risk.** Low. Only changes the status code for malformed bodies.

---

## C. Overlapping `Feed.inspect()` calls can disconnect each other

**Branch:** `fix/dual-live-serialize-feed-inspect`

**Problem.** `Feed.inspect()` in `ops.cjs` has no guard. Status polls go through the shared `sample()` in `go-live.cjs`, but stop's wait loop (`go-live.cjs` line 159) calls `feed.inspect()` directly, so the two overlap. `connect()` returns early once `this.obs` is set (`ops.cjs` line 49), but `this.obs` is set before the handshake finishes (line 55). A second caller in that window skips connect. Its request fails with "Socket not identified", because obs-websocket-js rejects requests until identified. Its catch then calls `disconnect()` (line 120), which tears down the socket the first caller is using.

**Change.** `inspect()` returns one shared in-flight promise, cleared when it settles. The sampling body moves to a private method. Concurrent callers get the same sample.

**Tests (RED first)**, in a new `Feed sampling` section of `tests/dual-live.cjs`. The OBS client is stubbed by setting `feed.obs` and overriding `feed.connect` to count calls.
- Two concurrent `inspect()` calls connect once and issue each request once.
- Sequential calls each take a fresh sample.

**Acceptance.** The concurrency test fails on the baseline (two connects, two request sets) and passes after the change.

**Risk.** A caller that arrives mid-sample gets a sample that began just before its call. Waits poll every second, and `sample()` already shares samples this way.

---

## D. "Healthy" is reported before any bytes are sent

**Branch:** `fix/dual-live-healthy-requires-throughput`

**Problem.** `kbps` is null on the first sample after StartStream, because there is no earlier sending sample to compare against. Then `state` (`ops.cjs` lines 99-100) reports Healthy with 0 bytes. Go-live waits for Healthy, so portrait can start about a second after horizontal does, with no throughput measured. Separately, drop and total counts subtract the previous sample's counters even when that sample belonged to an earlier stream session. `Math.max(0, …)` then clamps the result to 0, so new drops in the first interval are hidden.

**Change.**
- Healthy requires a measured `kbps > 0`.
- Until throughput is measured, state is Warning with `reason: 'Throughput not measured yet'`.
- Drop and total baselines come from the previous sample only when it was sending in the same session. Otherwise the baseline is 0.

**Assumption to confirm in rehearsal.** OBS resets output counters when a stream starts. If it doesn't, the change over-counts drops for one sample, which errs toward Warning.

**Tests (RED first)**, in the `Feed sampling` section with a stubbed stream.
- The first sample after StartStream with 0 bytes is not Healthy.
- A second sample with bytes flowing is Healthy.
- Drops from a previous session don't hide new drops: `recentDropPct` is computed from the new session's counters.

**Acceptance.** The first two tests fail on the baseline (Healthy on sample one; no drop percentage). All pass after the change.

**Risk.** Manual `send-vertical` checks `wide.state === 'Healthy'` on a single sample, so right after horizontal starts it will refuse until a second sample. The operator waits a few seconds and runs it again. Document this in the plan's rehearsal notes.

---

## E. Stop treats an unknown state as "not sending"

**Branch:** `fix/dual-live-stop-unknown-state`

**Problem.** `stop()` in `go-live.cjs` only targets feeds where `sending` is truthy (line 153). An unreadable sample has no `sending`, so the result is `ok: true, "Nothing was sending. Nothing changed."` with no StopStream sent. The wait loop (line 159) counts an unreadable sample as stopped, so it can report "Stopped" while the feed is still live. Failed samples are common: any sample error, or an unstable sample such as the StreamStateChanged from the stop itself. The page also disables both stop buttons when `sending` is missing (`go-live.html` lines 139-140), so the operator can't stop from the page during an unreadable state.

**Change.**
- Stop targets every feed that is not explicitly idle (`sending !== false`) and sends StopStream.
- A feed counts as stopped only when a sample reads `sending === false`.
- Each feed ends in one of four outcomes: **stopped**; **already idle** (StopStream rejected, but OBS reads idle); **acknowledged but not confirmed** within 20 s; **not acknowledged and state unknown**. Anything other than stopped or already idle is `ok: false`, with "Check OBS directly."
- `status()` adds `controls.stopPortrait` and `controls.stopAll`, each true unless the feeds are explicitly idle. The page uses them instead of `sending`.

**Tests (RED first)**, in `tests/dual-live.cjs`.
- Unreadable portrait: StopStream is sent.
- Unreadable portrait, StopStream rejected, still unreadable: result is not ok.
- StopStream acknowledged, then unreadable: result is not "Stopped".
- StopStream acknowledged, then explicitly idle: "Stopped".
- Explicitly idle from the start: "Nothing was sending", with no commands. This is an existing test and must still pass.
- `status().controls` is true for an unreadable portrait and false for an explicitly idle one.

**Acceptance.** The first three and the `controls` test fail on the baseline. All pass after the change.

**Risk.** With OBS down, stop buttons are enabled and a stop attempt reports "not confirmed". That is intended: unknown must not look idle.

---

## F. Refused actions and their messages disappear

**Branch:** `fix/dual-live-visible-errors`

**Problem.** `refresh()` in `go-live.html` calls `fail('')` on every successful status poll, every 2 seconds (line 184). `confirmPending` calls `refresh()` in its `finally` (line 177). So a refused confirm (expired, or "Another action is running") is erased immediately. A refused arm is erased within 2 seconds. The operator sees no reason.

**Change.** Connection status moves to its own element, `#conn`. Action errors in `#error` stay until the operator's next action (arm, confirm, or cancel).

**Tests (RED first).** A browser test in `tests/dual-live.cjs`, using puppeteer as `tests/portrait-browser.cjs` does. It serves the real page from `createControlServer` with a stub controller.
- A refused confirm's message is still visible after 2.5 seconds.
- A refused arm's message is still visible after 2.5 seconds.

**Acceptance.** Both tests fail on the baseline and pass after the change.

**Risk.** Page only. No OBS effect.

---

## G. A timed-out start says "did not start"

**Branch:** `fix/dual-live-timeout-messages`

**Problem.** `act()` in `go-live.cjs` (line 69) returns only true or false, so a timed-out StartStream is reported as "did not start" (line 120). OBS may have started it, so the operator is told the wrong thing.

**Change.** `act()` returns `ok`, `timeout`, or `rejected`. A timeout says the feed may or may not be running and points to OBS. A rejection keeps the current wording and "do not retry blindly".

**Tests (RED first).**
- Horizontal StartStream times out: the message says it may or may not be running, and portrait is not started.
- Portrait StartStream times out: the message says it may or may not be running, and horizontal is left running.
- A rejected StartStream keeps the existing "did not start" wording.

**Acceptance.** The two timeout tests fail on the baseline and pass after the change.

**Risk.** Wording only. The control flow is unchanged.
