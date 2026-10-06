# Membership Implementation Plan

## 1. Z-Index Fix for Show Comment Popup
- **File:** `chat-overlay.html`
- **Action:** Update `#show-comment` CSS rule `z-index` from 100 to 2000 so that it renders above `#scorecard` (which has a z-index of 1000).

## 2. Identify Members in Chat
- **File:** `yt-chat-server.js`
- **Action:** In `parseChatAction()`, add logic to parse `renderer.authorBadges`. If a badge corresponds to a member (e.g. tooltip contains 'member' or iconType='MEMBER'), set an `isMember: true` flag. Include `isMember: isMember` in the returned object payload.

## 3. Style Members in Chat Overlay (Panel and Popup)
- **File:** `chat-overlay.html`
- **Action:** 
  - Ensure regular messages sent by members display with a green tag and styling. In `addMsg()`, check for the `isMember` property. We can inject the "Member" badge conditionally. We will explicitly make the message div inherit the `.membership` visual styles (green border, green background).
  - Modify `showUserComment()` to apply identical membership CSS to the popup. If `data.isMember` is true, we add `.membership` format into `#show-comment` so the popup highlights green.

## 4. Full-Screen Join Animation
- **File:** `chat-overlay.html` (and optionally separated JS if needed, but injecting into `chat-overlay.html` avoids changing loading logic).
- **Action:** 
  - Define HTML structure for `#member-join-overlay` (hidden by default) with `z-index: 9999`, leveraging hardware acceleration `will-change: transform, opacity`.
  - Add highly optimized CSS animations lasting 10s for the member join event. No layout thrashing (use `transform: translate3d/scale3d` and `opacity` only).
  - In `handleWsMessage` or `addMsg()`, when receiving a message where `data.msgType === 'membership'`, trigger `showMemberJoin(data.name)`.
  - The function `showMemberJoin(name)` sets the name in the overlay, adds an `.active` class for the 10s animation cycle, then resets.
