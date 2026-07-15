import { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { DenoiseTrackProcessor } from "livekit-rnnoise-processor";
import { createEffect, createRoot, on } from "solid-js";

import { CONFIGURATION } from "@revolt/common";
import { Voice } from "@revolt/state/stores/Voice";

export class VoiceProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = "stoat-voice-processor";
  processedTrack?: MediaStreamTrack;
  private originalTrack?: MediaStreamTrack;
  private audioContext?: AudioContext;
  private settings: Voice;
  private noiseSuppressor?: TrackProcessor<
    Track.Kind.Audio,
    AudioProcessorOptions
  >;
  private sourceNode?: MediaStreamAudioSourceNode;
  private highpassNode?: BiquadFilterNode;
  private preNoiseSuppressionNode?: MediaStreamAudioDestinationNode;
  private postNoiseSuppressionNode?: MediaStreamAudioSourceNode;
  private compressorNode?: DynamicsCompressorNode;
  private gainNode?: GainNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  private disposeSolidjsContext: () => void = () => {};

  constructor(voiceSettings: Voice) {
    this.settings = voiceSettings;

    createRoot((dispose) => {
      createEffect(() => {
        this.setGain(this.getSettings().inputVolume);
      });

      createEffect(
        on(
          () => this.getSettings().noiseSupression,
          (newNoiseSuppresion, oldNoiseSuppression) => {
            if (
              oldNoiseSuppression &&
              oldNoiseSuppression !== newNoiseSuppresion &&
              (newNoiseSuppresion === "enhanced" ||
                oldNoiseSuppression === "enhanced")
            ) {
              console.log("REBUJILDNG");
              this.rebuild();
            }
          },
        ),
      );

      this.disposeSolidjsContext = dispose;
    });
  }

  private getSettings(): Voice {
    return this.settings;
  }

  private setGain(newGain: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = newGain;
    }
  }

  private rebuild() {
    this.updateNoiseSuppression(this.audioContext!);
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    return this.build(opts);
  }

  async destroy(): Promise<void> {
    this.disposeSolidjsContext();
    this.audioContext = undefined;
    return this.teardown();
  }

  private async updateNoiseSuppression(context: AudioContext) {
    if (this.noiseSuppressor) {
      this.noiseSuppressor.destroy();
      this.compressorNode?.disconnect();
      this.postNoiseSuppressionNode?.disconnect();
      this.preNoiseSuppressionNode?.disconnect();
      this.highpassNode?.disconnect();
    }

    if (this.settings.noiseSupression === "enhanced") {
      this.highpassNode = context.createBiquadFilter();
      this.highpassNode.type = "highpass";
      this.highpassNode.frequency.value = 50;
      this.highpassNode.Q.value = Math.SQRT1_2;

      this.preNoiseSuppressionNode = context.createMediaStreamDestination();
      this.highpassNode.connect(this.preNoiseSuppressionNode);

      const track = this.preNoiseSuppressionNode.stream.getAudioTracks()[0];

      this.noiseSuppressor = new DenoiseTrackProcessor({
        workletCDNURL: CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
      });
      let noiseSuppressionFailed = false;
      try {
        await this.noiseSuppressor.init({
          kind: Track.Kind.Audio,
          audioContext: context,
          track: track,
        });
      } catch (error) {
        console.error("Failed to enable noise suppression: ", error);
        noiseSuppressionFailed = true;
      }
      if (noiseSuppressionFailed || !this.noiseSuppressor.processedTrack) {
        this.postNoiseSuppressionNode = this.sourceNode!;
      } else {
        this.sourceNode!.connect(this.highpassNode!);
        this.postNoiseSuppressionNode = context.createMediaStreamSource(
          new MediaStream([this.noiseSuppressor.processedTrack]),
        );
        this.compressorNode = context.createDynamicsCompressor();
        // These values are shamelessly taken from Fluxer code base.
        this.compressorNode.threshold.value = -3;
        this.compressorNode.knee.value = 0;
        this.compressorNode.ratio.value = 20;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.05;
        this.postNoiseSuppressionNode.connect(this.compressorNode);
        this.compressorNode.connect(this.gainNode!);
      }
    } else {
      this.postNoiseSuppressionNode = this.sourceNode!;
      this.postNoiseSuppressionNode.connect(this.gainNode!);
    }
  }

  private async build(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    let context = opts.audioContext;
    if (!context) {
      context = this.audioContext!;
    } else {
      this.audioContext = context;
    }
    if (!context) {
      console.log(
        "Attempted to build voice processor without a context. Ignoring.",
      );
      return;
    }
    this.originalTrack = opts.track;

    this.sourceNode = context.createMediaStreamSource(
      new MediaStream([opts.track]),
    );

    this.gainNode = context.createGain();
    this.gainNode.gain.value = this.settings.inputVolume;
    await this.updateNoiseSuppression(context);
    this.destinationNode = context.createMediaStreamDestination();
    this.gainNode.connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private async teardown() {
    await this.noiseSuppressor?.destroy();
    this.sourceNode?.disconnect();
    this.highpassNode?.disconnect();
    this.preNoiseSuppressionNode?.disconnect();
    this.postNoiseSuppressionNode?.disconnect();
    this.gainNode?.disconnect();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.highpassNode = undefined;
    this.preNoiseSuppressionNode = undefined;
    this.postNoiseSuppressionNode = undefined;
    this.gainNode = undefined;
    this.destinationNode = undefined;
    this.noiseSuppressor = undefined;
  }
}
