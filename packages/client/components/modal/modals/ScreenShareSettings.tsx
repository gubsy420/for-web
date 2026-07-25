import { Trans, useLingui } from "@lingui-solid/solid/macro";
import { createFormControl, createFormGroup } from "solid-forms";

import { useState } from "@revolt/state";
import {
  ScreenShareFramerateName,
  ScreenShareResolutionName,
} from "@revolt/state/stores/Voice";
import { Column, Dialog, DialogProps, Form2 } from "@revolt/ui";
import { VideoTrack } from "solid-livekit-components";

import { Show } from "solid-js";
import { Modals } from "../types";

export function ScreenShareSettingsModal(
  props: DialogProps & Modals & { type: "screen_share_settings" },
) {
  const { voice } = useState();
  const { t } = useLingui();

  const group = createFormGroup({
    resolutionName: createFormControl<ScreenShareResolutionName>(
      voice.screenShareResolution || "720",
      { required: true },
    ),
    framerateName: createFormControl<ScreenShareFramerateName>(
      voice.screenShareFramerate || "30",
      { required: true },
    ),
    audio: createFormControl(props.audio && voice.screenShareAudio, {
      disabled: !props.audio,
    }),
    dontAsk: createFormControl(false),
  });

  async function onSubmit() {
    if (group.controls.dontAsk.value) {
      voice.screenShareResolution = group.controls.resolutionName.value;
      voice.screenShareFramerate = group.controls.framerateName.value;
      voice.screenShareQualityAsk = false;
      voice.screenShareAudio = group.controls.audio.value;
    }

    props.callback(
      group.controls.resolutionName.value,
      group.controls.framerateName.value,
      group.controls.audio.value && props.audio,
    );
    props.onClose();
  }

  const submit = Form2.useSubmitHandler(group, onSubmit);

  return (
    <Dialog
      minWidth={420}
      show={props.show}
      onClose={() => {
        props.onCancel();
        props.onClose();
      }}
      title={t`Screen Share Settings`}
      actions={[
        { text: <Trans>Cancel</Trans> },
        {
          text: <Trans>Go</Trans>,
          onClick: () => {
            onSubmit();
            return false;
          },
        },
      ]}
    >
      <VideoTrack
        trackRef={props.trackReference}
        style={{
          padding: "var(--gap-md)",
          "border-radius": "var(--borderRadius-lg)",
          "max-height": "400px",
          "justify-self": "center",
        }}
      />
      <form onSubmit={submit}>
        <Column>
          <Form2.ButtonGroup
            control={group.controls.resolutionName}
            buttonDefinitions={props.resolutions.map((resolution) => {
              return {
                children: resolution.fullName,
                value: resolution.name,
              };
            })}
          />
          <Form2.ButtonGroup
            control={group.controls.framerateName}
            buttonDefinitions={props.framerates.map((framerate) => {
              return {
                children: framerate.fullName,
                value: framerate.name,
              };
            })}
          />
          <Show when={props.audio}>
            <Form2.Checkbox control={group.controls.audio}>
              <Trans>Share audio</Trans>
            </Form2.Checkbox>
          </Show>
          <Form2.Checkbox control={group.controls.dontAsk}>
            <Trans>Don't ask me again</Trans>
          </Form2.Checkbox>
          <Show when={!props.audio}>
            <small>
              <Trans>Audio disabled by browser</Trans>
            </small>
          </Show>
        </Column>
      </form>
    </Dialog>
  );
}
