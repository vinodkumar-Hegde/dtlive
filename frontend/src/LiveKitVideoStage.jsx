import React, { useEffect, useMemo, useState } from "react";

import {
  ConnectionStateToast,
  ControlBar,
  DisconnectButton,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";

import { Track } from "livekit-client";

import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorUp,
  Radio,
  ShieldCheck,
  Square,
  Users,
  Video,
} from "lucide-react";

import "@livekit/components-styles";
import "./dtlive-media-v22.css";

const LOCAL_LIVEKIT_PORT = String(
  import.meta.env.VITE_LIVEKIT_SIGNAL_PORT || "17900"
);

const BROADCAST_MODES = [
  {
    id: "video",
    title: "Video only",
    description: "Faculty camera fills the main stage.",
    icon: Camera,
  },
  {
    id: "screen",
    title: "Screen only",
    description: "Only the shared screen is shown.",
    icon: Monitor,
  },
  {
    id: "both",
    title: "Video + screen",
    description: "Screen and Faculty camera remain separate.",
    icon: Video,
  },
];

function hasSecureMediaAccess() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

async function createConnection(authToken, roomName) {
  const response = await fetch("/api/livekit/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      room_name: roomName,
    }),
  });

  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({
        detail: "Unable to prepare the live session",
      }));

    throw new Error(
      result.detail || "Unable to prepare the live session"
    );
  }

  return response.json();
}

function resolveLiveKitUrl(apiUrl) {
  const pageProtocol = window.location.protocol;
  const pageHostname = window.location.hostname;

  if (pageProtocol === "http:") {
    return `ws://${pageHostname}:${LOCAL_LIVEKIT_PORT}`;
  }

  if (apiUrl?.startsWith("wss://")) {
    return apiUrl;
  }

  throw new Error(
    "This HTTPS address cannot reach the local video server. " +
      "Use the secure production LiveKit address or open localhost for local testing."
  );
}

function getTrackKey(trackRef) {
  return (
    trackRef?.publication?.trackSid ||
    trackRef?.publication?.sid ||
    `${trackRef?.participant?.identity || "participant"}-${
      trackRef?.source ||
      trackRef?.publication?.source ||
      "track"
    }`
  );
}

function isRenderableTrack(trackRef) {
  const publication = trackRef?.publication;

  if (!publication || publication.isMuted || !publication.track) {
    return false;
  }

  if (trackRef?.participant?.isLocal) {
    return true;
  }

  return publication.isSubscribed !== false;
}

function chooseTrack(trackRefs, canBroadcast) {
  const renderable = trackRefs.filter(isRenderableTrack);

  if (canBroadcast) {
    return (
      renderable.find((trackRef) => trackRef?.participant?.isLocal) ||
      renderable[0] ||
      null
    );
  }

  return (
    renderable.find((trackRef) => !trackRef?.participant?.isLocal) ||
    renderable[0] ||
    null
  );
}

function ModeSelector({
  value,
  onChange,
  compact = false,
}) {
  return (
    <div
      className={`dt22-mode-selector ${
        compact ? "compact" : ""
      }`}
      role="group"
      aria-label="Faculty broadcast mode"
    >
      {BROADCAST_MODES.map((mode) => {
        const Icon = mode.icon;

        return (
          <button
            type="button"
            key={mode.id}
            className={value === mode.id ? "selected" : ""}
            onClick={() => onChange(mode.id)}
          >
            <Icon size={compact ? 15 : 20} />
            <span>
              <strong>{mode.title}</strong>
              {!compact && <small>{mode.description}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BroadcastModeSync({ mode }) {
  const {
    localParticipant,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    let cancelled = false;

    async function syncMode() {
      try {
        if (mode === "video") {
          if (isScreenShareEnabled) {
            await localParticipant.setScreenShareEnabled(false);
          }

          if (!cancelled && !isCameraEnabled) {
            await localParticipant.setCameraEnabled(true);
          }

          return;
        }

        if (mode === "screen") {
          if (isCameraEnabled) {
            await localParticipant.setCameraEnabled(false);
          }

          return;
        }

        if (mode === "both" && !isCameraEnabled) {
          await localParticipant.setCameraEnabled(true);
        }
      } catch {
        // The media controls remain available if a device permission fails.
      }
    }

    void syncMode();

    return () => {
      cancelled = true;
    };
  }, [
    isCameraEnabled,
    isScreenShareEnabled,
    localParticipant,
    mode,
  ]);

  return null;
}

function FacultyScreenShareButton({
  mode,
  screenActive,
}) {
  const {
    localParticipant,
  } = useLocalParticipant();

  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState("");

  if (mode === "video") {
    return null;
  }

  async function toggleScreenShare() {
    if (busy || !localParticipant) return;

    setBusy(true);
    setShareError("");

    try {
      await localParticipant.setScreenShareEnabled(
        !screenActive
      );
    } catch (error) {
      setShareError(
        error?.message ||
          "Screen sharing could not start. Select the required screen or browser tab."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dt22-share-control">
      <button
        type="button"
        className={
          screenActive
            ? "active"
            : "attention"
        }
        disabled={busy}
        onClick={toggleScreenShare}
      >
        {screenActive ? (
          <Square size={17} />
        ) : (
          <MonitorUp size={17} />
        )}

        <span>
          {busy
            ? "Please wait"
            : screenActive
              ? "Stop screen sharing"
              : "Share screen"}
        </span>
      </button>

      {shareError && (
        <span className="dt22-share-error">{shareError}</span>
      )}
    </div>
  );
}

function FacultyCameraDock({
  cameraTrack,
  canBroadcast,
}) {
  const [visible, setVisible] = useState(true);
  const [size, setSize] = useState("medium");

  const sizeLabel = {
    small: "Small",
    medium: "Medium",
    large: "Large",
  }[size];

  if (!visible) {
    return (
      <div className="dt22-camera-dock-hidden">
        <button
          type="button"
          onClick={() => setVisible(true)}
        >
          <Eye size={15} />
          Show Faculty video
        </button>
      </div>
    );
  }

  return (
    <div className="dt22-camera-dock-row">
      <section
        className={`dt22-camera-dock size-${size}`}
        aria-label="Resizable Faculty camera"
      >
        <header className="dt22-camera-dock-header">
          <div>
            <strong>
              {cameraTrack?.participant?.name ||
                "DocTutorials Faculty"}
            </strong>
            <span>Faculty video · {sizeLabel}</span>
          </div>

          <div className="dt22-camera-dock-actions">
            <button
              type="button"
              title="Small Faculty video"
              className={size === "small" ? "selected" : ""}
              onClick={() => setSize("small")}
            >
              <Minimize2 size={14} />
            </button>

            <button
              type="button"
              title="Medium Faculty video"
              className={size === "medium" ? "selected" : ""}
              onClick={() => setSize("medium")}
            >
              <Video size={14} />
            </button>

            <button
              type="button"
              title="Large Faculty video"
              className={size === "large" ? "selected" : ""}
              onClick={() => setSize("large")}
            >
              <Maximize2 size={14} />
            </button>

            <button
              type="button"
              title="Hide Faculty video"
              onClick={() => setVisible(false)}
            >
              <EyeOff size={14} />
            </button>
          </div>
        </header>

        <div className="dt22-camera-dock-media">
          {cameraTrack ? (
            <VideoTrack
              key={getTrackKey(cameraTrack)}
              trackRef={cameraTrack}
              manageSubscription={false}
            />
          ) : (
            <div className="dt22-camera-off">
              <Camera size={24} />
              <strong>Faculty camera is off</strong>
              <span>
                {canBroadcast
                  ? "Use Video only or Video + screen mode."
                  : "Waiting for the Faculty camera."}
              </span>
            </div>
          )}
        </div>

        <span className="dt22-resize-note">
          Use the size buttons above
        </span>
      </section>
    </div>
  );
}

function PresentationCanvas({
  screenTrack,
  canBroadcast,
  mode,
}) {
  return (
    <section
      className="dt22-presentation-canvas"
      aria-label="Screen sharing canvas"
    >
      <div className="dt22-canvas-label">
        <strong>Screen share</strong>
        <span>Separate presentation canvas</span>
      </div>

      {screenTrack ? (
        <div className="dt22-presentation-media">
          <VideoTrack
            key={getTrackKey(screenTrack)}
            trackRef={screenTrack}
            manageSubscription={false}
          />
        </div>
      ) : (
        <div className="dt22-screen-waiting">
          <MonitorUp size={36} />

          <strong>
            {canBroadcast
              ? "Screen sharing is ready"
              : "Waiting for Faculty screen"}
          </strong>

          <span>
            {canBroadcast
              ? mode === "screen"
                ? "Press Share screen below. Only the selected screen will be shown."
                : "Press Share screen below. Faculty video will remain in a separate dock."
              : "The shared screen appears here automatically."}
          </span>
        </div>
      )}
    </section>
  );
}

function StableBroadcastStage({
  canBroadcast,
  mode,
  onModeChange,
}) {
  const participants = useParticipants();

  const trackRefs = useTracks(
    [
      {
        source: Track.Source.ScreenShare,
        withPlaceholder: false,
      },
      {
        source: Track.Source.Camera,
        withPlaceholder: false,
      },
    ],
    {
      onlySubscribed: false,
    }
  );

  const cameraTracks = trackRefs.filter(
    (trackRef) =>
      trackRef?.source === Track.Source.Camera ||
      trackRef?.publication?.source === Track.Source.Camera
  );

  const screenTracks = trackRefs.filter(
    (trackRef) =>
      trackRef?.source === Track.Source.ScreenShare ||
      trackRef?.publication?.source === Track.Source.ScreenShare
  );

  const cameraTrack = chooseTrack(
    cameraTracks,
    canBroadcast
  );

  const screenTrack = chooseTrack(
    screenTracks,
    canBroadcast
  );

  const screenActive = Boolean(screenTrack);

  return (
    <div className="dt22-shell">
      <BroadcastModeSync mode={mode} />

      <div className="dt22-live-topbar">
        <div className="dt22-live-status">
          <span className="dt22-live">
            <Radio size={13} />
            Live classroom
          </span>

          <span>
            <Users size={14} />
            {participants.length} connected
          </span>

          <span>
            <ShieldCheck size={14} />
            Students are watch-only
          </span>
        </div>

        {canBroadcast && (
          <ModeSelector
            value={mode}
            onChange={onModeChange}
            compact
          />
        )}
      </div>

      <div className={`dt22-stage mode-${mode}`}>
        {mode === "video" && (
          cameraTrack ? (
            <section className="dt22-video-only-stage">
              <div className="dt22-video-only-media">
                <VideoTrack
                  key={getTrackKey(cameraTrack)}
                  trackRef={cameraTrack}
                  manageSubscription={false}
                />
              </div>

              <div className="dt22-video-caption">
                <strong>
                  {cameraTrack?.participant?.name ||
                    "DocTutorials Faculty"}
                </strong>
                <span>Faculty video</span>
              </div>
            </section>
          ) : (
            <div className="dt22-camera-waiting">
              <Camera size={36} />
              <strong>Faculty camera is not active</strong>
              <span>
                Allow camera permission and enable the camera
                from the controls below.
              </span>
            </div>
          )
        )}

        {mode === "screen" && (
          <PresentationCanvas
            screenTrack={screenTrack}
            canBroadcast={canBroadcast}
            mode={mode}
          />
        )}

        {mode === "both" && (
          <>
            <PresentationCanvas
              screenTrack={screenTrack}
              canBroadcast={canBroadcast}
              mode={mode}
            />

            <FacultyCameraDock
              cameraTrack={cameraTrack}
              canBroadcast={canBroadcast}
            />
          </>
        )}
      </div>

      <RoomAudioRenderer />
      <StartAudio label="Enable classroom audio" />

      {canBroadcast ? (
        <div className="dt22-faculty-controls">
          <FacultyScreenShareButton
            mode={mode}
            screenActive={screenActive}
          />

          <ControlBar
            variation="minimal"
            saveUserChoices
            controls={{
              microphone: true,
              camera: mode !== "screen",
              screenShare: false,
              chat: false,
              leave: true,
            }}
          />
        </div>
      ) : (
        <div className="dt22-viewer-controls">
          <span>
            <Eye size={15} />
            View only
          </span>

          <DisconnectButton
            stopTracks
            title="Leave live video"
          >
            <LogOut size={15} />
            <span>Leave</span>
          </DisconnectButton>
        </div>
      )}

      <ConnectionStateToast />
    </div>
  );
}

function EntryPreview({ mode }) {
  return (
    <div className={`dt22-entry-preview mode-${mode}`}>
      {mode === "video" && (
        <div className="dt22-preview-video">
          <Camera size={38} />
          <strong>Faculty video</strong>
          <span>Camera will fill the main stage.</span>
        </div>
      )}

      {mode === "screen" && (
        <div className="dt22-preview-screen">
          <MonitorUp size={38} />
          <strong>Screen share</strong>
          <span>Only the selected screen will be shown.</span>
        </div>
      )}

      {mode === "both" && (
        <>
          <div className="dt22-preview-screen">
            <MonitorUp size={34} />
            <strong>Screen share</strong>
            <span>Main presentation canvas</span>
          </div>

          <div className="dt22-preview-camera">
            <Camera size={28} />
            <strong>Faculty video</strong>
            <span>Separate resizable dock</span>
          </div>
        </>
      )}
    </div>
  );
}

function EntryWorkspace({
  canBroadcast,
  secureMediaAvailable,
  connecting,
  joinSession,
  mode,
  onModeChange,
}) {
  const selectedMode = BROADCAST_MODES.find(
    (item) => item.id === mode
  );

  return (
    <div className="dt22-entry-workspace">
      {canBroadcast && (
        <ModeSelector
          value={mode}
          onChange={onModeChange}
        />
      )}

      <EntryPreview
        mode={canBroadcast ? mode : "both"}
      />

      <div className="dt22-entry-actionbar">
        <div>
          <span>
            {canBroadcast
              ? "SELECTED BROADCAST MODE"
              : "STUDENT VIEWER"}
          </span>

          <strong>
            {canBroadcast
              ? selectedMode?.title
              : "Watch Faculty broadcast"}
          </strong>

          <small>
            {canBroadcast
              ? mode === "video"
                ? "Camera starts with the broadcast."
                : "After connecting, press Share screen once to select the required screen or window."
              : "Student camera and microphone remain disabled."}
          </small>
        </div>

        <button
          type="button"
          className="dt22-start-button"
          onClick={joinSession}
          disabled={connecting}
        >
          <LogIn size={18} />

          {connecting
            ? "Connecting…"
            : canBroadcast
              ? "Start broadcast"
              : "Watch live"}
        </button>
      </div>

      {canBroadcast && !secureMediaAvailable && (
        <div className="dt22-entry-warning">
          Faculty camera and microphone require HTTPS or localhost.
        </div>
      )}
    </div>
  );
}

export default function LiveKitVideoStage({
  token,
  currentUser,
  sessionName,
  roomTitle,
}) {
  const [connection, setConnection] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState("");
  const [broadcastMode, setBroadcastMode] = useState("both");

  const canBroadcast = useMemo(
    () => currentUser?.role === "faculty",
    [currentUser?.role]
  );

  const secureMediaAvailable = useMemo(
    () => hasSecureMediaAccess(),
    []
  );

  async function joinSession() {
    if (connecting) return;

    setError("");

    if (
      canBroadcast &&
      broadcastMode !== "screen" &&
      !secureMediaAvailable
    ) {
      setError(
        "Faculty camera and microphone require HTTPS or localhost."
      );
      return;
    }

    setConnecting(true);

    try {
      const result = await createConnection(
        token,
        sessionName
      );

      setConnection({
        ...result,
        server_url: resolveLiveKitUrl(
          result.server_url
        ),
      });
    } catch (joinError) {
      setError(
        joinError?.message ||
          "Unable to join the live session"
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section
      className={`dt-video-panel dt22-panel ${
        connection ? "connected" : ""
      } ${expanded ? "" : "collapsed"}`}
    >
      <header className="dt22-header">
        <div className="dt22-header-identity">
          <div className="dt22-header-icon">
            <Video size={18} />
          </div>

          <div>
            <span>DOCTUTORIALS LIVE</span>
            <strong>{roomTitle}</strong>
            <small>
              {canBroadcast
                ? "Choose Video, Screen, or Video + Screen"
                : "Student watch-only classroom"}
            </small>
          </div>
        </div>

        <button
          type="button"
          className="dt22-collapse-button"
          onClick={() =>
            setExpanded((value) => !value)
          }
          aria-label={
            expanded
              ? "Collapse video"
              : "Expand video"
          }
        >
          {expanded ? (
            <ChevronUp size={18} />
          ) : (
            <ChevronDown size={18} />
          )}
        </button>
      </header>

      {expanded && !connection && (
        <EntryWorkspace
          canBroadcast={canBroadcast}
          secureMediaAvailable={
            secureMediaAvailable
          }
          connecting={connecting}
          joinSession={joinSession}
          mode={broadcastMode}
          onModeChange={setBroadcastMode}
        />
      )}

      {expanded && connection && (
        <div
          className="dt22-room"
          data-lk-theme="default"
        >
          <LiveKitRoom
            serverUrl={connection.server_url}
            token={connection.participant_token}
            connect
            audio={
              canBroadcast &&
              secureMediaAvailable
            }
            video={
              canBroadcast &&
              secureMediaAvailable &&
              broadcastMode !== "screen"
                ? {
                    facingMode: "user",
                    resolution: {
                      width: 1280,
                      height: 720,
                      frameRate: 24,
                    },
                  }
                : false
            }
            connectOptions={{
              autoSubscribe: true,
            }}
            options={{
              adaptiveStream: false,
              dynacast: false,
              publishDefaults: {
                videoCodec: "vp8",
                simulcast: false,
                degradationPreference:
                  "maintain-resolution",
                screenShareEncoding: {
                  maxBitrate: 4000000,
                  maxFramerate: 15,
                },
              },
            }}
            onDisconnected={() =>
              setConnection(null)
            }
            onError={(roomError) =>
              setError(
                roomError?.message ||
                  "Media connection failed"
              )
            }
            onMediaDeviceFailure={(
              failure,
              kind
            ) => {
              if (canBroadcast) {
                setError(
                  `Faculty ${
                    kind || "media"
                  } could not start: ${
                    failure ||
                    "permission denied"
                  }`
                );
              }
            }}
          >
            <StableBroadcastStage
              canBroadcast={canBroadcast}
              mode={broadcastMode}
              onModeChange={setBroadcastMode}
            />
          </LiveKitRoom>
        </div>
      )}

      {expanded && error && (
        <div
          className="dt22-error"
          role="alert"
        >
          <strong>Video connection failed</strong>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
