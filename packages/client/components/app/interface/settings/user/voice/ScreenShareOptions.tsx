import { Trans } from "@lingui-solid/solid/macro";

import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import {
  ScreenShareFramerateName,
  ScreenShareResolutionName,
} from "@revolt/state/stores/Voice";
import {
  CategoryButton,
  CategorySelectOption,
  Checkbox,
  Column,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

export function ScreenShareOptions() {
  const { voice } = useState();
  const voiceContext = useVoice();

  const resolutions = voiceContext.getEnabledScreenShareResolutions();
  const framerates = voiceContext.getEnabledScreenShareFramerates();

  return (
    <Column>
      <Text class="title">
        <Trans>Screen Share Settings</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton.Select
          icon={<Symbol>screen_share</Symbol>}
          title={<Trans>Select screen share resolution</Trans>}
          options={
            Object.fromEntries(
              resolutions.map(({ name, fullName }) => [
                name,
                { title: fullName },
              ]),
            ) as { [key in ScreenShareResolutionName]: CategorySelectOption }
          }
          value={voice.screenShareResolution}
          onUpdate={(ns) => (voice.screenShareResolution = ns)}
        />
        <CategoryButton.Select
          icon={<Symbol>60fps</Symbol>}
          title={<Trans>Select screen share framerate</Trans>}
          options={
            Object.fromEntries(
              framerates.map(({ name, fullName }) => [
                name,
                { title: fullName },
              ]),
            ) as { [key in ScreenShareFramerateName]: CategorySelectOption }
          }
          value={voice.screenShareFramerate}
          onUpdate={(ns) => (voice.screenShareFramerate = ns)}
        />
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.screenShareQualityAsk} />}
          onClick={() =>
            (voice.screenShareQualityAsk = !voice.screenShareQualityAsk)
          }
        >
          <Trans>Always Ask for Screen Share Quality</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
