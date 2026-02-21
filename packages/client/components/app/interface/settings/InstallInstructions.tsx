import { Trans } from "@lingui-solid/solid/macro";

import MdIosShare from "@material-design-icons/svg/outlined/ios_share.svg?component-solid";
import MdRefresh from "@material-design-icons/svg/outlined/refresh.svg?component-solid";
import { useState } from "@revolt/state";
import { Button, iconSize } from "@revolt/ui";
import { createEffect, createSignal, Match, Show, Switch } from "solid-js";
import { styled } from "styled-system/jsx";

const Container = styled("div", {
  base: {
    padding: "15px 0",
    color: "var(--md-sys-color-on-surface)",
    fill: "var(--md-sys-color-on-surface)",

    "& h1": { fontSize: "22px" },
    "& h2": { fontSize: "18px" },

    "& p, & h1, & h2": {
      marginBlockStart: "1.2em",
      marginBlockEnd: ".5em",
    },

    "& *:first-child": {
      margin: 0,
    },
  },
});

const Steps = styled("ol", {
  base: {
    listStyleType: "decimal",
    listStylePosition: "inside",
  },
});

/**
 * Installation Instructions Page
 */
export default function InstallInstructions() {
  const { pwaPrompt, pwaInstalled } = useState();

  const [result, setResult] = createSignal<"accepted" | "dismissed">();
  const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

  createEffect(() => {
    pwaPrompt()?.userChoice?.then((choice) => setResult(choice.outcome));
  });

  return (
    <Container>
      <Show
        when={!pwaInstalled()}
        fallback={<Trans>You've successfully installed Stoat!</Trans>}
      >
        <p>
          <Trans>
            Installing Stoat only takes a few taps. We'll guide you through it.
          </Trans>
        </p>

        <Show when={isFirefox}>
          <p style={{ "font-style": "italic" }}>
            <Trans>
              <b>Warning:</b> Web App support on Firefox is limited- Your
              mileage may vary.
            </Trans>
          </p>
        </Show>

        <Show when={pwaPrompt()}>
          <h1>
            <Trans>Easy Install</Trans>
          </h1>
          <Switch>
            <Match when={!result()}>
              <Button type="button" onPress={() => pwaPrompt()!.prompt()}>
                <Trans>Install</Trans>
              </Button>
            </Match>
            <Match when={result() === "accepted"}>
              <Trans>Installing...</Trans>
            </Match>
            <Match when={result() === "dismissed"}>
              <p>
                <Trans>
                  Looks like you declined the installation... You can refresh
                  the page if you'd like to try again, or try the manual
                  instructions below.
                </Trans>
              </p>
              <p>
                <Button type="button" onPress={() => location.reload()}>
                  <MdRefresh />
                </Button>
              </p>
            </Match>
          </Switch>

          <h1>
            <Trans>Manual Install</Trans>
          </h1>
        </Show>

        <h2>
          <Trans>Android</Trans>
        </h2>
        <Steps>
          <li>
            <Trans>Open this page in Chrome</Trans>
          </li>
          <li>
            <Trans>Press the ⋮ button</Trans>
          </li>
          <li>
            <Trans>Tap "Install app" or "Add to Home screen"</Trans>
          </li>
          <li>
            <Trans>Follow the prompts</Trans>
          </li>
        </Steps>

        <h2>
          <Trans>iOS / iPadOS</Trans>
        </h2>
        <Steps>
          <li>
            <Trans>Open this page in Safari</Trans>
          </li>
          <li>
            <Trans>
              Press the{" "}
              <MdIosShare
                {...iconSize(18)}
                style={{ display: "inline-block" }}
              />{" "}
              button
            </Trans>
          </li>
          <li>
            <Trans>Tap "Add to Home Screen"</Trans>
          </li>
          <li>
            <Trans>Follow the prompts</Trans>
          </li>
        </Steps>
      </Show>
    </Container>
  );
}
