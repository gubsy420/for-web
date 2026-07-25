# Fork customisations

This file is the source of truth for everything this fork changes relative to
upstream `stoatchat/for-web`. The automated upstream-sync workflow points Claude
at this file when it resolves merge conflicts, so **keep it accurate** — an
out-of-date entry here is how an AI merge silently drops a customisation.

For each customisation: what it does, which files it touches, and the *intent*
(so a reviewer or the AI can re-apply it against refactored upstream code).

---

## 1. Selectable screen-share resolution and framerate (up to 1440p60)

**Intent:** let users pick screen-share resolution and framerate independently in
the share modal, raising the ceiling from the stock 1080p30 to 1440p60. Upstream
hardcodes three fixed presets (720p30 / 1080p30 / source@5fps) with no framerate
choice.

**Touched files (see the implementation plan for specifics):**
- `packages/client/components/state/stores/Voice.ts` — replaces the single
  `screenShareQuality` setting with two persisted axes (`screenShareResolution`,
  `screenShareFramerate`) plus validation.
- `packages/client/components/rtc/state.tsx` — resolution/framerate option sources
  gated by the server `video_resolution` limit; publishes with an explicit
  `screenShareEncoding` bitrate; builds a fresh `VideoResolution` (does not mutate
  the shared `ScreenSharePresets`).
- `packages/client/components/modal/modals/ScreenSharePicker.tsx`,
  `.../ScreenShareSettings.tsx` — two `Form2.ButtonGroup`s (resolution, framerate).
- `packages/client/components/app/interface/settings/user/voice/ScreenShareOptions.tsx`
  — two selects.
- `packages/client/components/modal/types.ts` — modal callback/prop signatures.

**Conflict guidance:** if upstream reworks the screen-share quality code, preserve
the *two-axis selection + explicit bitrate + 1440p60 ceiling*; re-express it on top
of upstream's new structure rather than reverting to the single-preset model.

<!-- Add further customisations below as they are introduced. -->
