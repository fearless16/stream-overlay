# OBS dual format — one cricket show, two layouts

**Decision:** Keep the installed OBS as the 16:9 broadcast. Run a separate, official portable OBS as the 9:16 broadcast. Send each feed to its own YouTube RTMPS key on **one** YouTube event. No Aitum, third-party OBS plugin, virtual audio cable, or cloud relay. Keep YouTube’s own vertical layout as the fallback.

**Status (2026-11-21):** Implemented locally: installed OBS 33.0.1 owns the USB Owl 4K PRO; portable OBS 33.0.2 receives the clean camera and renders 720×1280/30. Portrait is camera-first with no score, alerts, or persistent chrome. Both outputs remain off. Final physical framing, audio/lip sync, channel-specific Studio Encoder availability, encoder capacity, and sustained upload still need rehearsal.

## 1. Architecture impact and alternatives

| Approach | What it delivers | Decision |
| --- | --- | --- |
| One OBS + YouTube **Vertical canvas** (sometimes labeled **Auto**) | One upload. YouTube derives portrait using center crop, fit to phone width, or stacked, with position/zoom controls. | Baseline and fallback. Test the framing on a phone. It cannot independently reflow our scorecard or chat. |
| Installed OBS + portable OBS + YouTube **Encoder** | Two independent compositions and uploads; one shared URL, chat, and subscriber go-live notification. | Build this if both previews, audio, and horizontal health pass rehearsal. |
| One OBS with a native second YouTube output | OBS has canvas APIs and additional-canvas support for Multitrack Video, but the OBS 33.0.2 release notes do not establish a built-in UI for a second independently composed YouTube RTMPS output. | Do not rely on unreleased or unverified UI. Revisit if OBS ships a first-party path. |
| Existing `multistream/`, rescale, or a crop in FFmpeg | Can relay or reframe a finished image but cannot recover omitted content or independently lay out the face, score, and alerts. The current relay also uses the OBS recording path. | Leave it alone. Test coexistence only if Twitch/Kick/Instagram are needed on the same match. |
| Aitum, Restream plugins, or two separate public YouTube events | Common guides use plugins. Separate events can split chat, URLs, and notifications. | Out of scope. |

```text
Camera ─▶ Installed OBS (16:9) ───────────────────▶ YouTube horizontal key ─┐
             └─ OBS Virtual Camera, clean source ─▶ Portable OBS (9:16)    ├─ One event
                                                    └─ RTMPS ─▶ vertical key ┘
Existing score poller ─────────────────────────────▶ landscape only
Existing YouTube chat bridge + explicit Show ──────▶ selected portrait comment
Built-in OBS WebSocket v5, 4455 + 4456 ─────────────▶ local operator controls
```

The horizontal rig owns the camera and remains the production authority. Portable OBS does not open the physical camera again and never publishes Virtual Camera itself. Portrait uses the existing chat bridge through a separate loopback-only read feed; there is no second score poller, chat poller, bot, or upstream viewer counter.

## 2. Files and settings

| Area | Build plan |
| --- | --- |
| `dual-format/` (new) | Opt-in portable launcher, preflight, scene map, health/recovery controller, and example config. Use the existing `obs-websocket-js` dependency. Go-live control: `npm run dual-live` serves a loopback-only page at `127.0.0.1:8768` (override with `DUAL_CONTROL_PORT`). **Go live both** needs arm + confirm within 20 seconds, starts horizontal only if idle, waits for Healthy, then starts portrait. Stop portrait and stop both use the same arm step. Files: `go-live.cjs` (sequencing), `control.cjs` (server), `go-live.html` (page). |
| `dual-format/portrait-overlay.html` and assets | Silent, normally transparent 9:16 Browser Source. `chat-overlay.html` sends a portrait-only event when the operator clicks **Show** on a YouTube message; the landscape score and animations are unchanged. |
| `yt-chat-server.js` | `PORTRAIT_ENABLED=1` enables the loopback read feed. Retain at most one explicitly selected comment for ten seconds; no automatic chat, score, or match events. Restart the chat bridge to apply. |
| `dashboard.html`, `.env.example`, `tests/` | Add clearly separate horizontal/vertical health, documented non-secret defaults, and focused tests. Do not overload the existing single-OBS `metrics` payload. |
| OBS + YouTube Studio (outside Git) | Use a separate writable OBS ZIP directory, profile, scene collection, and WebSocket port for portrait. Keep stream keys in the respective OBS profiles; never store or log them in this repo. Back up the existing horizontal profile/scene collection before any on-machine setup. |

Do not repoint `obs-connect.js` at portrait: it hardcodes 4455 and recreates the landscape source. Do not modify `start-system.bat`, `start-multistream-obs.js`, or `multistream/` for the first release. Keep the stock operator workflow available.

## 3. Execution flow

1. In YouTube Studio → Live Control Room, open an **unlisted rehearsal**. Find the vertical preview’s **Encoder** option, assign a distinct vertical key, and verify each profile has the intended orientation and test key. Confirm YouTube Auto-start/Auto-stop are off for the rehearsal so pushing or briefly losing an ingest is not a publish/end command. If Encoder is unavailable, use YouTube’s vertical layout instead of creating a second public event.
2. Launch the horizontal OBS as usual. Launch the official portable copy from its own `bin/64bit` working directory using `--portable --multi --only-bundled-plugins`. Do not use `--safe-mode` (it disables WebSocket on OBS 33) or `--startstreaming`. Use authenticated WebSockets and connect over loopback; block external access with Windows Firewall if needed. Verify the expected profile, collection, program scene, and dimensions on each endpoint. OBS may reopen the previous scene; confirm the slate manually before sending.
3. In horizontal OBS, set Virtual Camera to a clean camera **Source** or a dedicated camera-only **Scene**, not Program or Studio Mode Preview. In portrait OBS, add OBS Virtual Camera as a Video Capture Device and test that it stays active through scene changes. Confirm the built-in camera is registered before the rehearsal. If it proves unreliable, test built-in Window Capture of a named, clean windowed source projector; reject black frames, focus/minimize dependency, desktop leakage, or unstable framing.
4. **Audio is a separate test:** Virtual Camera carries video only. For the commentary-first rehearsal, try the same named mic in both instances via Windows shared-mode capture, disable portrait’s default Desktop Audio and duplicate mic inputs, mirror the essential OBS filters, and test mute on both. Confirm the existing horizontal mix stays unchanged. If the device cannot be opened twice or the same approved mix/alerts cannot be maintained this way, test a dedicated existing Windows playback endpoint: horizontal **Monitor and Output** for approved sources only, portrait **Audio Output Capture** of that endpoint only. The endpoint must not be captured by horizontal OBS or play unrelated apps; portrait monitor stays off. If neither route gives clean audio and a reliable mute, do not ship Encoder mode. No virtual cable is required or proposed.
5. Switch portrait scenes manually (`Starting`, `Live`, `Break`, `End`, `Technical`). The optional `npm run portrait -- guard` watches the approved horizontal Program scene and shared inputs; repeated camera/mic failures while sending move portrait to its technical slate. Require a tested both-feed privacy mute/slate and an offline fallback (physical mic mute where available, plus native stop controls).
6. Start horizontal test ingest manually and verify its preview. Run `npm run portrait -- status`, then `npm run portrait -- send-vertical --studio-ready` only after checking both distinct keys, framing, and audio. Verify both Studio previews, shared chat and URL before manually clicking **Go live**. At show end, manually end the event and stop both feeds; verify neither is still sending.
   - **One-click alternative:** `npm run dual-live`, then open `http://127.0.0.1:8768/`. **Arm: go live both feeds** followed by **Confirm** within 20 seconds runs the same gates: it starts horizontal only if it is idle, waits for Healthy, then starts portrait. It never retries a rejected command and never stops horizontal when portrait fails. Studio's manual **Go live** click is still required. Use the same rehearsal checks before the first public use.

## 4. Risks and production targets

- **Horizontal is the priority.** Preserve its known-good encoder settings. Start portrait at **720×1280, 30 fps, H.264 CBR, 4 Mbps as an initial rehearsal setting**, 2-second keyframes, AAC stereo, SDR, RTMPS. Test AMD AMF with both outputs and the normal live workload on the Ryzen 7 9700X/Radeon system. If AMF cannot sustain both sessions, test hardware for horizontal plus x264 `veryfast` for portrait before a match. Only trial **1080×1920** after 720p is stable and visibly limiting. Use Studio health to adjust bitrate; 4 Mbps is a pilot value, not a blanket YouTube recommendation.
- **Budget both uploads.** Target no more than ~65% of the lowest repeatable sustained wired upload at match time, counting video, audio, overhead, and any other platform feeds. As a reference, an 8 Mbps horizontal + 4 Mbps portrait pair with two 128 kbps audio tracks is 12.26 Mbps before protocol overhead: target about **20 Mbps or more** sustained. Use the actual horizontal bitrate in the calculation.
- **A green socket is not a healthy broadcast.** Use per-output bitrate from byte deltas, drop/skip/lag counters and actual FPS, OBS recording state, last good program scene/collection, camera availability, mute and mic levels, and the portrait chat-overlay heartbeat. Use OBS Stats/logs and Windows GPU Video Encode/3D/CPU/RAM for capacity; use Studio to verify YouTube ingest separately. Do not claim source presence, silence, or a static frame alone proves a failure.
- **Shared hardware is still shared risk.** A horizontal OBS crash can take the portrait camera or monitor mix down too. Portrait is not a redundant encoder. A portrait-only failure must not restart, reconfigure, or stop horizontal.

## 5. Make the portrait show worth watching

- **Camera edge to edge:** Frame the Owl first, with the eyes roughly one-third down the portrait and room for the chin and shoulders. Tilt/move the physical camera if the raw frame already clips the face. While portrait outputs are off and `Portrait · Live` is open, `npm run portrait -- frame 0.69` pans the crop right for the current setup; run `npm run portrait -- frame` to re-center after moving the camera. Reapply any off-center crop after changing the Virtual Camera resolution. Check both views.
- **One selected comment:** **Show** puts text over the lower-left of the video for ten seconds. Escape, Delete, or a YouTube retraction removes it. No box, no ticker, no vertical score or match animations. Verify text and framing on a real phone with YouTube controls and chat open.
- **Make it easy to join mid-over:** recap in Hinglish around wickets, over ends, and innings breaks. Try a simple chat prompt, e.g. “34 off 18 — batting side or bowling side?” Use the same original commentary in both formats; no match footage or broadcaster audio. After stability, try a local portrait recording to turn an original reaction into a Short, and retest performance with recording enabled.

## 6. Failure handling and recovery

| Failure | Behavior |
| --- | --- |
| Portrait studio/input fails | Alert with cause and last good timestamp. Use a safe portrait slate when OBS is still reachable. Attempt capped recovery for the named portrait source; never touch horizontal. |
| Main OBS or camera/mic disappears | Treat the dependent portrait camera/audio as unhealthy; use a slate and safe audio state instead of showing the wrong window or airing an unmuted input. Revalidate source, route, and mute before restoring portrait. |
| OBS WebSocket disconnect or process restart | Timeout each request, reconnect with bounded exponential backoff/jitter, re-read actual scene/stream/mute state, and resolve sources by name. Use one connection/poll loop per instance; do not blindly replay Start/Stop or an unmute. OBS handles transport reconnect for an already-active output. After a process restart, require operator confirmation to resend RTMPS in v1. |
| Browser Source frozen, refreshes, or Node restarts | Detect missing browser heartbeat separately from quiet chat. Recover portrait with a rate-limited source refresh if the source is active and the bridge is reachable. Rehydrate an unexpired comment after refresh. On disconnect, expiry, or bridge restart, hide the comment without interrupting the camera. |
| One or both feeds drop on YouTube | Distinguish OBS sending, OBS reconnecting, and confirmed Studio ingest. Keep the healthy feed running. Do not switch YouTube formats mid-event or assume YouTube will substitute Auto when Encoder fails. Verify actual one-feed behavior during the rehearsal. |

Expose `Healthy`, `Warning`, `Offline`, and `Recovering` separately for each output. Use bounded, rotated logs with timestamps, feed IDs, reason codes, and retry counts; never log stream keys, WebSocket passwords, or chat contents as diagnostics.

## 7. Implementation order and release gates

| Gate | Must pass before the next step |
| --- | --- |
| **0 · Manual proof** | In a dummy OBS profile and an unlisted event, get both Studio previews. Verify camera and mic routing, close/reopen portrait without touching horizontal, check claps for lip sync, and confirm one chat/video ID. Unlisted is for transport/layout testing, not reach. |
| **1 · Portrait overlay** | Verify the transparent idle layout and one hand-picked comment. Check phone-safe framing, long Hindi/English text, reconnect/refresh, and no score, box, audio or automatic chat. |
| **2 · Operator controls** | Add read-only preflight/health first, then explicitly armed dual-feed control and scene sync. Test mismatched profiles, duplicate commands, unacknowledged commands, unknown scenes, missing devices, and stale health. Test that a control-process crash cannot stop horizontal or accidentally go live. |
| **3 · Unlisted endurance** | Log a horizontal-only baseline, a 30–60 minute dual rehearsal, then a 6-hour soak with normal Browser Sources, alerts, bot and (if intended) local LLM/recording/other outputs. Suggested gates: no unexplained disconnect or sustained overload, no visible lip-sync error, <0.5% dropped/lagged frames per category in steady-state rolling five-minute windows, horizontal within its baseline, and no sustained RAM/DOM/socket growth after warmup. Count deliberate fault-injection windows separately. |
| **4 · Public pilot** | Use a lower-stakes match first. Check phone and desktop with a second account/device and watch the two Studio previews. Do not debut on a marquee India/ICC game. |

Regression suite: parser/score fixtures for T20, ODI, Test, and The Hundred; landscape overlay, shortcuts, alerts, and recording/relay unchanged; integration tests with mock OBS endpoints and mock chat/score; 50,000+ chat-message stress with bounded queues/DOM; deliberate vertical and main OBS restarts, network interruptions, mic/camera unplug, browser crash/reload, Node bridge restart, missing scene, and mute persistence on reconnect. The OBS WebSocket v5 live check should cover `GetVersion`, `GetStats`, `GetVideoSettings`, `GetStreamStatus`, `GetRecordStatus`, scene/item lists, and input mute/volume; reconcile `CurrentProgramSceneChanged`, `StreamStateChanged`, `RecordStateChanged`, collection, scene-item, and mute events. Re-run the exact baseline workflow after rolling back.

## 8. Measure whether it helps this channel

YouTube Help says scheduled streams and Premieres don’t show in the vertical live feed; don’t use a scheduled event as the Shorts-discovery test. Use a **public, unscheduled** pilot, announce the time separately if needed, and don’t confuse a normal phone watch link (which may show landscape) with Shorts playback. Vertical metrics arrive after 24 hours: **Studio → Content → Live → Analytics → Advanced mode → Playback location → Vertical live feed**.

Compare at least two similar matches with Studio-rendered portrait and two with custom portrait. Match format, start time, and promotion where practical. Track vertical watch time per live hour, average view duration, and live views; track overall subscribers and horizontal/watch-page health separately. First decision rule: look for **20% better median vertical average view duration** than Auto without a horizontal quality regression or more operator interventions. Treat sparse samples and match-to-match variance as inconclusive, not failure or guaranteed growth. Continue with Auto if custom portrait adds work but does not measurably help.

## 9. Rollback

- **Before go-live:** stop the portrait feed and disable the new controller. In Studio, select **Vertical canvas/Auto** if it looks good or **Vertical stream off** if it doesn’t. Verify the original horizontal profile, key, audio route, and preview.
- **During a live event:** protect horizontal, try portrait’s safe slate or OBS reconnect, and keep the original URL/chat. Do not end the event or change modes simply to recover portrait. If portrait threatens horizontal, stop the portrait output and manage the existing event in Studio. Select Auto or horizontal-only on the next event.
- **Remove the feature:** stop the new launcher/controller, close the portable OBS, remove its shortcut, restore any rehearsal-only monitoring changes, and use the unchanged horizontal startup. Keep profile backups and test logs outside Git.

## Sources

- Official: [YouTube Dual Stream setup, shared chat and vertical layout modes](https://support.google.com/youtube/answer/2474026), [YouTube Creators’ setup walkthrough](https://www.youtube.com/post/UgkxHfv0V746zZiwcE6Fjl1QxEg9oa7T-iSL), [RTMPS encoder settings](https://support.google.com/youtube/answer/2853702), [vertical feed and scheduled-stream limits](https://support.google.com/youtube/answer/13822251), [per-format analytics](https://support.google.com/youtube/answer/2853833#dualstream_analytics).
- Official OBS: [Portable Mode](https://obsproject.com/kb/portable-mode), [launch flags](https://obsproject.com/kb/launch-parameters), [Virtual Camera](https://obsproject.com/kb/virtual-camera-guide), [projectors](https://obsproject.com/kb/power-of-projectors), [33.0.2 release](https://github.com/obsproject/obs-studio/releases/tag/33.0.2), [WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
- What people do: [OBS forum guide for sharing between two OBS instances](https://obsproject.com/forum/resources/how-to-share-video-and-audio-between-two-or-more-obs-studio-instances.1248/) demonstrates Virtual Camera; its virtual-cable step is not part of this plan. [Stream Designz’s Aitum walkthrough](https://www.streamdesignz.com/blogs/live-streaming/how-to-stream-to-youtube-obs-horizontal-vertical) shows the popular plugin route we’re replacing. [r/NewTubers](https://www.reddit.com/r/NewTubers/comments/1w4h7o8/new_dual_layout_streaming_feature_vertical_and/) and [r/PartneredYoutube](https://www.reddit.com/r/PartneredYoutube/comments/1pzjuvg/has_anyone_tried_new_dual_streams_feature/) report mixed discovery, awkward crops, and bandwidth friction. These are anecdotes, not expected channel results.
- Cricket references: [CricTalks](https://www.youtube.com/watch?v=C2C8OwTdD54) emphasizes score and original Hindi commentary; [Cric Axis](https://www.youtube.com/watch?v=0ShsFPpK8XA) explicitly distinguishes analysis from match footage. These examples inform instant context, not inferred dual-stream performance.
