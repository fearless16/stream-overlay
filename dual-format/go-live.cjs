'use strict';

// Operator go-live sequencing for the two OBS instances. The OBS feeds, browser
// heartbeat probe, gate and YouTube-key check are injected, so this module can be
// tested without OBS or YouTube. Ordering rules come from docs/obs-dual-format-plan.md:
// horizontal is the production authority and is started first; portrait is only
// started once horizontal reports Healthy; no failure is retried blindly.

const { randomBytes, timingSafeEqual } = require('node:crypto');

const ARM_MS = 20_000;
const WAIT_MS = 20_000;
const POLL_MS = 1_000;
const ACTIONS = new Set(['go-live', 'stop-portrait', 'stop-all']);
const SHOWN = ['state', 'reason', 'lastGoodAt', 'profile', 'collection', 'scene', 'sending', 'recording', 'kbps', 'fps',
  'targetFps', 'drops', 'recentDropPct', 'micMuted', 'virtualCam', 'cameraInScene', 'picture', 'fullBleed', 'browserInScene', 'micInScene'];
const KEY_BLOCKER = 'Profile files do not show two distinct nonempty YouTube RTMPS keys (save Settings in OBS)';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = (status, message) => Object.assign(new Error(message), { status });
const shown = sample => Object.fromEntries(SHOWN.filter(key => sample?.[key] !== undefined).map(key => [key, sample[key]]));
function sameText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createGoLive({ horizontal, vertical, browserHealth, gate, keysOk, now = Date.now, pause = wait,
  newToken = () => randomBytes(18).toString('base64url'), log = () => {} }) {
  let armed = null;
  let busy = null;
  let last = null;
  let inflight = null;

  // One OBS read at a time: status polls and the go-live sequence share a single sample.
  function sample() {
    inflight ??= Promise.all([horizontal.inspect(), vertical.inspect(), browserHealth()])
      .then(([wide, tall, browser]) => ({ wide, tall, browser }))
      .finally(() => { inflight = null; });
    return inflight;
  }

  function blockersFor({ wide, tall, browser }) {
    const issues = gate(wide, tall, browser);
    if (!keysOk()) issues.push(KEY_BLOCKER);
    return issues;
  }

  function confirm(action, token) {
    if (busy) throw fail(409, `Another action is running: ${busy}`);
    const valid = armed && armed.action === action && armed.expires > now() &&
      typeof token === 'string' && sameText(armed.token, token);
    if (!valid) throw fail(409, 'Arm this action first. Confirmation is single-use and expires after 20 seconds.');
    armed = null;
  }

  // Polls until check() returns a truthy value or the wait budget runs out.
  async function until(check, ms = WAIT_MS) {
    const deadline = now() + ms;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (now() >= deadline) return null;
      await pause(POLL_MS);
    }
  }

  // One command, one attempt. A rejected or timed-out command is reported, never replayed.
  async function act(feed, request, label, steps) {
    try {
      await feed.call(request);
      steps.push(`${label}: ${request} acknowledged`);
      return true;
    } catch (error) {
      steps.push(`${label}: ${request} ${error.code === 'timeout' ? 'timed out' : 'was not acknowledged'}; not retried`);
      return false;
    }
  }

  async function exclusive(action, work) {
    busy = action;
    const started = now();
    const steps = [];
    let outcome;
    try {
      outcome = await work(steps);
    } catch (error) {
      outcome = { ok: false, message: error.message || 'Unexpected error' };
    } finally {
      busy = null;
    }
    last = { action, at: started, ...outcome, steps };
    log(`[dual-live] ${new Date(started).toISOString()} ${action} ${outcome.ok ? 'ok' : 'not completed'}: ${outcome.message}`);
    return last;
  }

  function arm(action) {
    if (!ACTIONS.has(action)) throw fail(400, 'Unknown action');
    if (busy) throw fail(409, `Another action is running: ${busy}`);
    armed = { action, token: newToken(), expires: now() + ARM_MS };
    return { action, token: armed.token, expiresInMs: ARM_MS };
  }

  async function goLive(token) {
    confirm('go-live', token);
    return exclusive('go-live', async steps => {
      const first = await sample();
      const blockers = blockersFor(first);
      if (blockers.length) return { ok: false, message: 'Not started: fix the blockers first.', blockers };
      if (first.tall.sending) return { ok: false, message: 'Portrait is already sending. Nothing was started.' };
      if (first.wide.sending && first.wide.state !== 'Healthy') {
        return { ok: false, message: `Horizontal is ${first.wide.state}. Portrait was not started.` };
      }

      if (first.wide.sending) {
        steps.push('Horizontal already sending and Healthy: left unchanged');
      } else {
        steps.push('Horizontal is idle: starting it first');
        if (!await act(horizontal, 'StartStream', 'Horizontal', steps)) {
          return { ok: false, message: 'Horizontal did not start. Portrait was not started.' };
        }
        const healthy = await until(async () => {
          const { wide } = await sample();
          return wide.sending && wide.state === 'Healthy' ? wide : null;
        });
        if (!healthy) {
          return { ok: false, message: 'Horizontal did not report Healthy within 20 seconds. Portrait was not started; horizontal was left running.' };
        }
        steps.push('Horizontal sending and Healthy');
      }

      const recheck = blockersFor(await sample());
      if (recheck.length) {
        return { ok: false, message: 'Portrait preconditions changed while horizontal started. Portrait was not started; horizontal was left running.', blockers: recheck };
      }
      if (!await act(vertical, 'StartStream', 'Portrait', steps)) {
        return { ok: false, message: 'Portrait start was not acknowledged. Horizontal was left running. Check portable OBS and Studio; do not retry blindly.' };
      }
      const sending = await until(async () => (await sample()).tall.sending);
      return sending
        ? { ok: true, message: 'Both feeds are sending. Verify both previews and the shared chat in YouTube Studio, then click Go live there (still a manual step).' }
        : { ok: false, message: 'Portrait did not report sending within 20 seconds. Horizontal was left running; check OBS and Studio.' };
    });
  }

  // Only an explicit sending === false means idle. True, or an unreadable sample, may still be live.
  const mayBeLive = sample => sample?.sending !== false;

  async function stop(scope, token) {
    if (scope !== 'portrait' && scope !== 'all') throw fail(400, 'Scope must be portrait or all');
    const action = scope === 'all' ? 'stop-all' : 'stop-portrait';
    confirm(action, token);
    return exclusive(action, async steps => {
      const first = await sample();
      const targets = [];
      if (mayBeLive(first.tall)) targets.push(['Portrait', vertical]);
      if (scope === 'all' && mayBeLive(first.wide)) targets.push(['Horizontal', horizontal]);
      if (!targets.length) return { ok: true, message: 'Nothing was sending. Nothing changed.' };
      let confirmed = true;
      for (const [label, feed] of targets) {
        const acknowledged = await act(feed, 'StopStream', label, steps);
        let lastSeen = null;
        const idle = await until(async () => {
          lastSeen = await feed.inspect();
          return lastSeen.sending === false;
        });
        const reading = lastSeen?.sending === true ? 'still sending' : 'state unreadable';
        if (idle && acknowledged) steps.push(`${label}: stopped`);
        else if (idle) steps.push(`${label}: already idle (StopStream was not acknowledged)`);
        else steps.push(`${label}: ${acknowledged ? 'stop acknowledged' : 'StopStream not acknowledged'}; ${reading} after 20 seconds`);
        confirmed &&= !!idle;
      }
      return confirmed
        ? { ok: true, message: 'Stopped. Confirm in YouTube Studio that the ingest has ended.' }
        : { ok: false, message: 'A feed could not be confirmed stopped. Check OBS directly; nothing was retried.' };
    });
  }

  async function status() {
    const s = await sample();
    const live = armed && armed.expires > now() ? { action: armed.action, expiresInMs: armed.expires - now() } : null;
    return {
      horizontal: shown(s.wide), vertical: shown(s.tall), browser: s.browser?.status ?? 'offline',
      blockers: blockersFor(s), armed: live, busy, last,
      // The page offers stop from these, so an unreadable feed can still be stopped from the page.
      controls: { stopPortrait: !busy && mayBeLive(s.tall), stopAll: !busy && (mayBeLive(s.tall) || mayBeLive(s.wide)) },
    };
  }

  return { status, arm, goLive, stop };
}

module.exports = { createGoLive, ARM_MS, WAIT_MS, POLL_MS };
