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

**Model:** the single `ScreenShareQualityName` (`"low" | "high" | "text"`) is
replaced by two orthogonal axes:

| Axis | Type | Values | Default |
|---|---|---|---|
| Resolution | `ScreenShareResolutionName` | `"720"`, `"1080"`, `"1440"`, `"source"` | `"720"` |
| Framerate | `ScreenShareFramerateName` | `"5"`, `"15"`, `"30"`, `"60"` | `"30"` |

Both are **string** unions because `Form2.ButtonGroup` takes an
`IFormControl<string>` and `CategoryButton.Select` is keyed by string; the numeric
framerate is derived with `Number()` at the point of use. Keeping `"5"` preserves
upstream's source@5fps text-reading mode as an ordinary framerate choice.

**Touched files:**
- `packages/client/components/state/stores/Voice.ts` — the two persisted axes plus
  validation, and a migration mapping the legacy `screenShareQuality` value
  (`low`→720/30, `high`→1080/30, `text`→source/5) so existing users keep their
  setting instead of silently resetting.
- `packages/client/components/rtc/state.tsx` — `getEnabledScreenShareResolutions()`
  and `getEnabledScreenShareFramerates()` replace
  `getEnabledScreenShareQualities()`. Resolutions are gated by the instance's
  `features.limits.default.video_resolution` (0 on an axis = unconstrained), since
  voice-ingress disconnects publishers exceeding it; framerates are never gated,
  as the server does not police fps. Publishes with an explicit
  `screenShareEncoding` (`maxBitrate`/`maxFramerate`) because livekit ships no
  preset above 1080p30 and an unspecified bitrate leaves high resolutions looking
  soft. The post-publish callback also updates the `RTCRtpSender` encodings, as
  `applyConstraints` only retunes capture, not the publish bitrate.
- `packages/client/components/modal/modals/ScreenSharePicker.tsx`,
  `.../ScreenShareSettings.tsx` — two `Form2.ButtonGroup`s (resolution, framerate).
- `packages/client/components/app/interface/settings/user/voice/ScreenShareOptions.tsx`
  — two `CategoryButton.Select`s.
- `packages/client/components/modal/types.ts` — the modal `callback` signatures take
  `(…, resolutionName, framerateName, audio)` and the single `qualities` prop is
  split into `resolutions` and `framerates`.

**Two upstream bugs fixed in passing** — if upstream fixes them itself, take their
version:
1. `ScreenSharePresets.original.resolution` was **mutated** in place, leaking the
   frameRate/aspectRatio/width/height changes into every later screen share in the
   session. Resolutions are now built fresh each time.
2. The `applyConstraints` height guard tested `resolution.width === 0` instead of
   `height`, so an unconstrained width with a constrained height set a bogus
   height limit.

**Server dependency:** 1440p is only *offered* when the instance's
`video_resolution` limit permits it. The self-hosted `Revolt.toml` must set
`video_resolution = [2560, 1440]` under `[features.limits.default]` (and
`new_user`) or the option correctly stays hidden. This is deliberate — it fails
closed rather than getting streamers disconnected by voice-ingress.

**Conflict guidance:** if upstream reworks the screen-share quality code, preserve
the *two-axis selection + explicit bitrate + 1440p60 ceiling*; re-express it on top
of upstream's new structure rather than reverting to the single-preset model.

<!-- Add further customisations below as they are introduced. -->

---

## Operating the sync pipeline

Not a code customisation, but the sync workflow depends on it, and getting this
wrong stops the pipeline silently.

### `SYNC_PAT` is required

`GITHUB_TOKEN` is **forbidden from creating or updating anything under
`.github/workflows/`**, and no `permissions:` scope can grant it — the `workflows`
scope does not exist for `GITHUB_TOKEN`. So the moment upstream adds or edits a
workflow file, `git push` fails with:

```
! [remote rejected] HEAD -> main (refusing to allow a GitHub App to create or
  update workflow `.github/workflows/<name>.yml` without `workflows` permission)
```

This is exactly what happened on **2026-08-01**, when upstream added
`canary-release.yml`. Ten consecutive daily runs failed and the fork fell 36
commits behind before it was noticed.

**Fix:** create a PAT with the `workflow` scope (classic: `repo` + `workflow`;
fine-grained: Contents *write* + Workflows *write* on this repo) and add it as the
repository secret **`SYNC_PAT`**. The workflow falls back to `GITHUB_TOKEN` when
the secret is absent and emits a warning, so it keeps working right up until
upstream next touches a workflow file.

### Inherited upstream workflows are auto-disabled

A fork inherits upstream's workflows, and a merge can introduce new ones that are
**active by default**. Upstream's `canary-release.yml` triggers on `push` to
`main` — which is what every sync push does — and publishes to upstream's Harbor
registry. After each push the pipeline disables every workflow except
`sync-upstream.yml`, so new arrivals are neutralised automatically.

There is a small race: a workflow added by a merge can fire on the sync push
before that step disables it. If you see one unexpected run immediately after a
sync, that is why; it will not recur.

### Failures always open an issue

Any failed run opens (or comments on) an issue labelled `upstream-sync`, one per
upstream tag. Reporting deliberately lives in the **last** step of the job:
`if: failure()` only fires for steps that have already run, so a reporter placed
before the push cannot catch a push failure. Do not move it, and do not narrow
its condition back to the conflict path.
