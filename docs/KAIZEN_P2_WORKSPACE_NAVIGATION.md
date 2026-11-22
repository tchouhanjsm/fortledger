# Kaizen batch 2 — shared, focus-aware task navigation

The existing Heritage Sky design system already defines navy/ivory/sage/gold tokens, focus-visible outlines, responsive layouts and reduced-motion behavior. Adding a competing style system would make the interface less coherent. This stage addresses one confirmed usability and accessibility defect.

## Confirmed defect

Several dashboard actions set `window.location.hash` and immediately called `scrollIntoView` before the target view was unhidden. The global `hashchange` handler then called `window.scrollTo(0,0)` and could erase the intended scroll. For keyboard users, focus stayed on the Dashboard button even after a screen switch. This particularly affected arrivals, room-cleaning exceptions, urgent maintenance, unlinked restaurant charges and the previously wrong daily-close route.

## Improvement

A standalone framework-free `public/workspace-navigation.js` module owns the route-target handoff:

- Navigate only to defined and permission-accessible workspaces; refuse unknown IDs.
- On cross-workspace navigation, wait for the existing hashchange view render; on same-workspace actions, render immediately because no hashchange will occur.
- After the view is visible and after its scroll reset, focus the actual target heading/section with `preventScroll:true`, then scroll it into view. A hidden, inaccessible or missing target never becomes focusable through this helper.
- Dashboard actions retain their original read-only filters and never mutate a booking, room, payment, closing or restaurant bill. 
- No new framework, dependency, global event bus, or change to navigation URLs.

Unit tests cover same-route and cross-route actions, keyboard focus, missing targets, invalid destinations, permissions and all five affected dashboard work queues. Existing responsive Chromium smoke remains in CI.

## Next work

Improve arrivals/in-house/departures filters (the current code has arrivals/departures but no explicit in-house filter), then extend measured accessibility tests and semantic feedback. The final hotel Mac and staff-phone acceptance remains unverified.
