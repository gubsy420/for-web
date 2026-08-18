import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  JSX,
  Setter,
  useContext,
} from "solid-js";
import {
  RoomContext,
  TrackReferenceOrPlaceholder,
  useTracks,
} from "solid-livekit-components";

// ScreenSharePresets is intentionally NOT imported: this fork builds fresh
// VideoResolution objects instead of mutating the shared presets (see
// FORK_CUSTOMISATIONS.md). DenoiseTrackProcessor moved to VoiceProcessor in
// upstream v0.15.0.
import {
  LocalTrackPublication,
  Room,
  Track,
  VideoResolution,
} from "livekit-client";
import { Channel } from "stoat.js";

import { SoundController, useSound } from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { ModalController, useModals } from "@revolt/modal";
import { useState } from "@revolt/state";
import {
  NoiseSuppresionState,
  ScreenShareFramerateName,
  ScreenShareFramerateNames,
  ScreenShareResolutionName,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { VoiceProcessor } from "./VoiceProcessor";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

type ScreenShareResolutionOption = {
  name: ScreenShareResolutionName;
  fullName: string;
  /** 0 means "unconstrained" — the instance imposes no limit on this axis */
  width: number;
  height: number;
};

type ScreenShareFramerateOption = {
  name: ScreenShareFramerateName;
  fullName: string;
  frameRate: number;
};

/**
 * Baseline bitrate for each resolution at 30fps. Screen share is published with
 * an explicit encoding because livekit ships no preset above 1080p30, and
 * without a bitrate a high resolution negotiates a default far too low to stay
 * sharp.
 */
const SCREEN_SHARE_BASE_BITRATE: Record<ScreenShareResolutionName, number> = {
  "720": 1_500_000,
  "1080": 3_000_000,
  "1440": 6_000_000,
  source: 6_000_000,
};

/**
 * Scale the baseline bitrate by how much motion the chosen framerate implies.
 */
function screenShareBitrate(
  resolution: ScreenShareResolutionName,
  frameRate: number,
): number {
  const scale =
    frameRate <= 5 ? 0.4 : frameRate <= 15 ? 0.7 : frameRate <= 30 ? 1 : 1.7;

  return Math.round(SCREEN_SHARE_BASE_BITRATE[resolution] * scale);
}

/**
 * Pick the content hint that suits the chosen framerate. Low framerates are
 * chosen to read text, high framerates to watch movement.
 */
function screenShareContentHint(frameRate: number): string {
  return frameRate <= 5 ? "text" : frameRate <= 15 ? "detail" : "motion";
}

class Voice {
  #settings: VoiceSettings;

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  vidTracks: Accessor<TrackReferenceOrPlaceholder[]>;

  state: Accessor<State>;
  #setState: Setter<State>;

  deafen: Accessor<boolean>;
  microphone: Accessor<boolean>;

  video: Accessor<boolean>;
  #setVideo: Setter<boolean>;

  screenshare: Accessor<boolean>;
  #setScreenshare: Setter<boolean>;

  fullscreen: Accessor<boolean>;
  #setFullscreen: Setter<boolean>;

  focusId: Accessor<string | undefined>;
  #setFocus: Setter<string | undefined>;

  showBar: Accessor<boolean>;
  #setShowBar: Setter<boolean>;

  private sound: SoundController;
  private device: Device;

  private openModal;
  private config;
  private limits;
  private screenShareTracks: Set<string>;
  private voiceProcessor?: VoiceProcessor;

  constructor(
    voiceSettings: VoiceSettings,
    modals: ModalController,
    sound: SoundController,
    device: Device,
  ) {
    this.#settings = voiceSettings;
    this.sound = sound;
    this.device = device;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    this.vidTracks = () => [];

    const [state, setState] = createSignal<State>("READY");
    this.state = state;
    this.#setState = setState;

    this.deafen = () => voiceSettings.deafen;
    this.microphone = () => voiceSettings.micOn && !voiceSettings.deafen;

    const [video, setVideo] = createSignal(false);
    this.video = video;
    this.#setVideo = setVideo;

    const [screenshare, setScreenshare] = createSignal(false);
    this.screenshare = screenshare;
    this.#setScreenshare = setScreenshare;

    const [fullscreen, setFullscreen] = createSignal(false);
    this.fullscreen = fullscreen;
    this.#setFullscreen = setFullscreen;

    const [focus, setFocus] = createSignal<string>();
    this.focusId = focus;
    this.#setFocus = setFocus;

    const [showBar, setShowBar] = createSignal(true);
    this.showBar = showBar;
    this.#setShowBar = setShowBar;

    const inst = useInstance();
    this.config = inst.config;
    this.limits = inst.limits;
    this.openModal = modals.openModal;

    this.screenShareTracks = new Set();

    // Setup settings listeners
    this.settingsListeners();
  }

  // Dynamically set echo cancellation and gain control when the settings are changed
  // These functions are needed to maintain reactivity. Don't ask me why but if you make them not functions it breaks.
  private settingsListeners() {
    const getSettings = () => this.#settings;

    const setEchoCancellation = (echoCancellation: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.echoCancellation = echoCancellation;
      }
    };

    const setAutoGainControl = (autoGainControl: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.autoGainControl = autoGainControl;
      }
    };

    const setNoiseSuppression = (noiseSuppression: NoiseSuppresionState) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        if (noiseSuppression === "browser") {
          track.constraints.noiseSuppression = true;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = true;
        } else {
          track.constraints.noiseSuppression = false;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = false;
        }
      }
    };

    const restartTrack = () => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.restartTrack();
      }
    };

    createEffect(() => {
      setEchoCancellation(getSettings().echoCancellation ?? true);
      setAutoGainControl(getSettings().autoGainControl ?? true);
      setNoiseSuppression(getSettings().noiseSupression ?? "browser");
      restartTrack();
    });
  }

  async connect(channel: Channel, auth?: { url: string; token: string }) {
    this.disconnect();

    this.device.setWakeLocked();

    const room = new Room({
      audioCaptureDefaults: {
        deviceId: this.#settings.preferredAudioInputDevice,
        echoCancellation: this.#settings.echoCancellation,
        noiseSuppression: this.#settings.noiseSupression === "browser",
        autoGainControl: this.#settings.autoGainControl,
        voiceIsolation: this.#settings.noiseSupression === "browser",
      },
      audioOutput: {
        deviceId: this.#settings.preferredAudioOutputDevice,
      },
      videoCaptureDefaults: {
        deviceId: this.#settings.preferredVideoDevice,
      },
    });

    this.vidTracks = useTracks(
      [
        { source: Track.Source.Camera, withPlaceholder: true },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ],
      { room, onlySubscribed: false },
    );

    batch(() => {
      this.#setRoom(room);
      this.#setChannel(channel);
      this.#setState("CONNECTING");
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      if (this.speakingPermission)
        room.localParticipant
          .setMicrophoneEnabled(this.#settings.micOn)
          .then((track) => {
            this.#settings.micOn = track != null;
          });
      for (const p of room.remoteParticipants.values()) {
        const screenShareTrack = p.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (screenShareTrack) {
          this.screenShareTracks.add(screenShareTrack.trackSid);
        }
      }
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("disconnected", () => this.#setState("DISCONNECTED"));

    room.addListener("localTrackPublished", (pub) => {
      if (pub.audioTrack && pub.audioTrack.source === Track.Source.Microphone) {
        if (!pub.audioTrack.getProcessor()) {
          pub.audioTrack?.setProcessor(
            (this.voiceProcessor = new VoiceProcessor(this.#settings)),
          );
        }
      }
    });

    room.addListener("participantConnected", () => {
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("participantDisconnected", () => {
      this.sound.playSound("userLeaveVoice");
    });

    room.addListener("trackPublished", (pub) => {
      if (pub.source === Track.Source.ScreenShare) {
        pub.once("subscribed", (track) => {
          // Play the sound once playback starts, which might be quite a bit after subscription
          // as it starts paused for the screen share settings modal.
          track.once("videoPlaybackStarted", () => {
            this.sound.playSound("streamStart");
            if (track.sid) {
              this.screenShareTracks.add(track.sid);
            }
          });
        });
      }
    });

    room.addListener("trackUnpublished", (unpub) => {
      if (this.screenShareTracks.has(unpub.trackSid)) {
        this.sound.playSound("streamEnd");
        this.screenShareTracks.delete(unpub.trackSid);
      }
    });

    // Gather latency
    const selected = await Promise.any(
      this.config.features.livekit.nodes.map(async (node) => {
        return fetch(node.public_url.replace("wss", "https")).then(() => {
          return node.name;
        });
      }),
    );

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
    });
  }

  disconnect() {
    this.device.releaseWakeLock();
    try {
      const room = this.room();
      if (!room) return;

      room.removeAllListeners();
      room.disconnect();

      batch(() => {
        this.#setState("READY");
        this.#setRoom();
        this.#setChannel();
        this.#setFullscreen(false);
        this.vidTracks = () => [];
      });

      this.screenShareTracks = new Set();

      this.sound.playSound("userLeaveVoice");
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleDeafen(fromMute?: boolean) {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        (this.#settings.micOn || !!fromMute) &&
          !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.deafen = !this.#settings.deafen;
      if (fromMute) {
        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
      }
      if (this.#settings.deafen) {
        this.sound.playSound("deafen");
      } else {
        this.sound.playSound("undeafen");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleMute() {
    if (this.#settings.deafen) {
      this.toggleDeafen(true);
      return;
    }
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;

      if (this.#settings.micOn) {
        this.sound.playSound("unmute");
      } else {
        this.sound.playSound("mute");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleCamera() {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
      );

      this.#setVideo(room.localParticipant.isCameraEnabled);
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Get the instance's screen share resolution limit, as [width, height].
   * A 0 on either axis means that axis is unconstrained.
   *
   * TODO: Use new user limits if the user is new - I don't think there's a way to do that now?
   */
  private screenShareLimit(): [number, number] | undefined {
    // v0.15.0 replaced useClient()/configuration with useInstance()'s reactive
    // limits(), which resolves the correct tier itself — so the old
    // `configured()` guard and the `.features.limits.default` path are gone.
    return this.limits().video_resolution as [number, number] | undefined;
  }

  /**
   * Get the enabled screen share resolutions. 720p is always enabled; anything
   * larger is offered only if the instance permits it, since voice-ingress
   * disconnects publishers whose track exceeds the configured limit.
   *
   * TODO: Translate the fullNames here, I can't figure out how to do it.
   *
   * @returns Resolution options, always containing at least 720p.
   */
  getEnabledScreenShareResolutions(): ScreenShareResolutionOption[] {
    const resolutions: ScreenShareResolutionOption[] = [
      { name: "720", fullName: `720p`, width: 1280, height: 720 },
    ];

    const limit = this.screenShareLimit();
    if (!limit) return resolutions;

    /** Whether the instance permits publishing at the given size */
    const permits = (width: number, height: number) =>
      (limit[0] === 0 || limit[0] >= width) &&
      (limit[1] === 0 || limit[1] >= height);

    if (permits(1920, 1080)) {
      resolutions.push({
        name: "1080",
        fullName: `1080p`,
        width: 1920,
        height: 1080,
      });
    }

    if (permits(2560, 1440)) {
      resolutions.push({
        name: "1440",
        fullName: `1440p`,
        width: 2560,
        height: 1440,
      });
    }

    // Source captures the display's native resolution, clamped to the limit.
    resolutions.push({
      name: "source",
      fullName: `Source`,
      width: limit[0],
      height: limit[1],
    });

    return resolutions;
  }

  /**
   * Get the enabled screen share framerates. Framerate is not policed by the
   * server — only resolution is — so every option is always available.
   *
   * @returns Framerate options.
   */
  getEnabledScreenShareFramerates(): ScreenShareFramerateOption[] {
    return ScreenShareFramerateNames.map((name) => ({
      name,
      fullName: `${name} FPS`,
      frameRate: Number(name),
    }));
  }

  /**
   * Build the capture resolution for a resolution/framerate pair.
   *
   * Always returns a fresh object — the shared livekit presets must not be
   * mutated, as that leaks the mutation into every later screen share.
   */
  private screenShareResolution(
    resolutionName: ScreenShareResolutionName,
    framerateName: ScreenShareFramerateName,
  ): VideoResolution {
    const resolutions = this.getEnabledScreenShareResolutions();
    const resolution =
      resolutions.find((r) => r.name === resolutionName) ?? resolutions[0];

    const framerates = this.getEnabledScreenShareFramerates();
    const framerate =
      framerates.find((f) => f.name === framerateName) ??
      framerates.find((f) => f.name === "30")!;

    return {
      width: resolution.width,
      height: resolution.height,
      frameRate: framerate.frameRate,
      // Only meaningful when both axes are constrained
      aspectRatio:
        resolution.width !== 0 && resolution.height !== 0
          ? resolution.width / resolution.height
          : 0,
    };
  }

  async toggleScreenshare() {
    const room = this.room();
    if (!room) throw "invalid state";

    if (this.screenshare()) {
      await room.localParticipant.setScreenShareEnabled(false);

      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

      this.sound.playSound("streamEnd");
    } else {
      const resolutions = this.getEnabledScreenShareResolutions();
      const framerates = this.getEnabledScreenShareFramerates();
      const options = {
        resolutions: resolutions.map(({ name, fullName }) => ({
          name,
          fullName,
        })),
        framerates: framerates.map(({ name, fullName }) => ({
          name,
          fullName,
        })),
      };

      let screenPickerResolutionName: ScreenShareResolutionName | undefined;
      let screenPickerFramerateName: ScreenShareFramerateName | undefined;
      let screenPickerAudio: boolean | undefined;

      // Register the modal on screen picker handler if it exists
      if (window.native && window.native.onceScreenPicker) {
        window.native.onceScreenPicker((sources) => {
          this.openModal({
            type: "screen_share_picker",
            onCancel: () => {
              window.native.screenPickerCallback(-1, false);
            },
            callback: (
              idx: number,
              resolutionName: ScreenShareResolutionName,
              framerateName: ScreenShareFramerateName,
              audio: boolean,
            ) => {
              window.native.screenPickerCallback(idx, audio);
              screenPickerResolutionName = resolutionName;
              screenPickerFramerateName = framerateName;
              screenPickerAudio = audio;
            },
            sources: sources,
            ...options,
          });
        });
      }

      const initialResolutionName =
        this.#settings.screenShareResolution || "720";
      const initialFramerateName = this.#settings.screenShareFramerate || "30";

      try {
        const localTrack = await room.localParticipant.setScreenShareEnabled(
          true,
          {
            resolution: this.screenShareResolution(
              initialResolutionName,
              initialFramerateName,
            ),
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              voiceIsolation: false,
              restrictOwnAudio: true,
            },
          },
          {
            screenShareEncoding: {
              maxBitrate: screenShareBitrate(
                initialResolutionName,
                Number(initialFramerateName),
              ),
              maxFramerate: Number(initialFramerateName),
            },
          },
        );

        const screenAudioTrack = room.localParticipant.getTrackPublication(
          Track.Source.ScreenShareAudio,
        );

        this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

        if (localTrack) {
          // This event is only fired if the screen share is ended by closing the window being streamed.
          // This catches the ending and disables screen sharing on our side. If this weren't here,
          // livekit would still share stream audio after closing the window being streamed.
          localTrack.on("ended", () => {
            this.toggleScreenshare();
            const oldAudioTrack = room.localParticipant.getTrackPublication(
              Track.Source.ScreenShareAudio,
            );
            if (oldAudioTrack && oldAudioTrack.track) {
              room.localParticipant.unpublishTrack(oldAudioTrack.track);
            }
          });

          const callback = async (
            resolutionName: ScreenShareResolutionName,
            framerateName: ScreenShareFramerateName,
            audio: boolean,
          ) => {
            const resolution = this.screenShareResolution(
              resolutionName,
              framerateName,
            );
            const frameRate = resolution.frameRate!;

            if (localTrack.videoTrack) {
              await localTrack.videoTrack.mediaStreamTrack.applyConstraints({
                frameRate: { max: frameRate },
                // upstream #1497 added `ideal` so the stream starts at or
                // below the target instead of starting high and scaling down.
                // Kept, expressed against this fork's two-axis resolution.
                // NB: upstream's own height branch reads `ideal:
                // quality.resolution.width` — a copy-paste bug we do not carry.
                width:
                  resolution.width === 0
                    ? undefined
                    : { ideal: resolution.width, max: resolution.width },
                height:
                  resolution.height === 0
                    ? undefined
                    : { ideal: resolution.height, max: resolution.height },
              });
              localTrack.videoTrack.mediaStreamTrack.contentHint =
                screenShareContentHint(frameRate);

              // applyConstraints only retunes capture. The publish encoding
              // lives on the sender, and without updating it a higher
              // resolution stays starved of bitrate and looks soft.
              const sender = localTrack.videoTrack.sender;
              if (sender) {
                const params = sender.getParameters();
                if (params.encodings?.length) {
                  const maxBitrate = screenShareBitrate(
                    resolutionName,
                    frameRate,
                  );

                  for (const encoding of params.encodings) {
                    encoding.maxBitrate = maxBitrate;
                    encoding.maxFramerate = frameRate;
                  }

                  await sender.setParameters(params);
                }
              }

              if (!audio && screenAudioTrack?.track) {
                room.localParticipant.unpublishTrack(screenAudioTrack.track);
              }
              this.sound.playSound("streamStart");
            }
          };

          if (screenPickerResolutionName) {
            callback(
              screenPickerResolutionName,
              screenPickerFramerateName || "30",
              screenPickerAudio || false,
            );
          } else if (this.#settings.screenShareQualityAsk) {
            if (resolutions.length > 1 || framerates.length > 1) {
              localTrack.pauseUpstream();
              screenAudioTrack?.pauseUpstream();
              this.openModal({
                onCancel: async () => {
                  await room.localParticipant.setScreenShareEnabled(false);
                  this.#setScreenshare(
                    room.localParticipant.isScreenShareEnabled,
                  );
                },
                type: "screen_share_settings",
                trackReference: {
                  participant: room.localParticipant,
                  publication: localTrack,
                  source: Track.Source.ScreenShare,
                },
                ...options,
                audio: !!screenAudioTrack,
                callback: async (resolutionName, framerateName, audio) => {
                  callback(resolutionName, framerateName, audio);
                  localTrack.resumeUpstream();
                  if (audio) {
                    screenAudioTrack?.resumeUpstream();
                  }
                },
              });
            } else {
              callback(
                initialResolutionName,
                initialFramerateName,
                this.#settings.screenShareAudio,
              );
            }
          }
        }
      } catch (e) {
        this.onErr(e);
      }
    }
  }

  toggleFullscreen(fullscreen: boolean = !this.fullscreen()) {
    this.#setFullscreen(fullscreen);
  }

  trackId(t: TrackReferenceOrPlaceholder) {
    return `${t.source}_${t.participant.sid}`;
  }

  toggleFocus(t?: TrackReferenceOrPlaceholder) {
    const id = t ? this.trackId(t) : undefined;
    this.#setFocus(
      this.focusId() === id || this.vidTracks().length < 2 ? undefined : id,
    );
  }

  isFocus(t: TrackReferenceOrPlaceholder) {
    return this.trackId(t) === this.focusId();
  }

  focusTrack() {
    const id = this.focusId();
    return id
      ? this.vidTracks().find((t) => this.trackId(t) === id)
      : undefined;
  }

  toggleShowBar() {
    this.#setShowBar((s) => !s);
  }

  getConnectedUser(userId: string) {
    return this.room()?.getParticipantByIdentity(userId);
  }

  showCard(channel: Channel) {
    return (
      channel.isVoice &&
      (this.channel()?.id === channel.id ||
        channel.type === "TextChannel" ||
        !!channel.voiceParticipants.size)
    );
  }

  getMicrophoneTrack(): LocalTrackPublication | undefined {
    const track = this.room()?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    return track;
  }

  get listenPermission() {
    return !!this.channel()?.havePermission("Listen");
  }

  get speakingPermission() {
    return !!this.channel()?.havePermission("Speak");
  }

  private onErr(e: unknown) {
    if ((e as Error).name !== "NotAllowedError")
      this.openModal({ type: "error2", error: e });
  }
}

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const modals = useModals();
  const sound = useSound();
  const device = useDevice();
  const voice = new Voice(state.voice, modals, sound, device);

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
        </InRoom>
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
