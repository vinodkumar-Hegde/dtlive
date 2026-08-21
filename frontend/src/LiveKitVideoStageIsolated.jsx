import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ConnectionStateToast,
  DisconnectButton,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Camera,
  CameraOff,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Radio,
  ShieldCheck,
  Square,
  Users,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import "@livekit/components-styles";
import styles from "./LiveKitVideoStageIsolated.module.css";

const SIGNAL_PORT = String(
  import.meta.env.VITE_LIVEKIT_SIGNAL_PORT || "17900",
);

const MODES = [
  {
    id: "video",
    title: "Video only",
    description: "Large square Faculty video",
    Icon: Camera,
  },
  {
    id: "screen",
    title: "Screen only",
    description: "Full-screen presentation",
    Icon: MonitorUp,
  },
  {
    id: "both",
    title: "Video + screen",
    description: "Full screen with floating video",
    Icon: Video,
  },
];

function isSecureMediaContext() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function",
  );
}

async function requestConnection(authToken, roomName) {
  const response = await fetch("/api/livekit/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ room_name: roomName }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.detail || "Unable to prepare the live session.",
    );
  }

  return response.json();
}

function resolveServerUrl(serverUrl) {
  if (window.location.protocol === "http:") {
    return `ws://${window.location.hostname}:${SIGNAL_PORT}`;
  }

  if (String(serverUrl || "").startsWith("wss://")) {
    return serverUrl;
  }

  throw new Error(
    "A secure WSS LiveKit address is required when the page uses HTTPS.",
  );
}

function canRender(trackRef) {
  const publication = trackRef?.publication;

  if (!publication || publication.isMuted || !publication.track) {
    return false;
  }

  if (trackRef?.participant?.isLocal) {
    return true;
  }

  return publication.isSubscribed !== false;
}

function selectTrack(trackRefs, preferLocal) {
  const available = trackRefs.filter(canRender);

  if (preferLocal) {
    return (
      available.find((item) => item?.participant?.isLocal) ||
      available[0] ||
      null
    );
  }

  return (
    available.find((item) => !item?.participant?.isLocal) ||
    available[0] ||
    null
  );
}

function trackKey(trackRef) {
  return (
    trackRef?.publication?.trackSid ||
    `${trackRef?.participant?.identity || "participant"}-${
      trackRef?.source ||
      trackRef?.publication?.source ||
      "track"
    }`
  );
}

function ModeSelector({
  mode,
  onChange,
  compact = false,
}) {
  return (
    <div
      className={
        compact ? styles.modeCompact : styles.modeSelector
      }
    >
      {MODES.map(
        ({ id, title, description, Icon }) => (
          <button
            type="button"
            key={id}
            className={
              mode === id ? styles.modeActive : ""
            }
            onClick={() => onChange(id)}
          >
            <Icon size={compact ? 15 : 21} />

            <span>
              <strong>{title}</strong>
              {!compact && <small>{description}</small>}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

function MediaModeController({ mode }) {
  const { localParticipant } = useLocalParticipant();
  const previousMode = useRef(null);

  useEffect(() => {
    if (
      !localParticipant ||
      previousMode.current === mode
    ) {
      return;
    }

    previousMode.current = mode;
    let cancelled = false;

    async function synchronise() {
      try {
        if (mode === "video") {
          await localParticipant.setScreenShareEnabled(false);

          if (!cancelled) {
            await localParticipant.setCameraEnabled(true);
          }

          return;
        }

        if (mode === "screen") {
          await localParticipant.setCameraEnabled(false);
          return;
        }

        if (mode === "both") {
          await localParticipant.setCameraEnabled(true);
        }
      } catch {
        // Persistent controls remain available after permission errors.
      }
    }

    void synchronise();

    return () => {
      cancelled = true;
    };
  }, [localParticipant, mode]);

  return null;
}

async function toggleScreenShare(
  localParticipant,
  active,
) {
  if (!window.isSecureContext) {
    throw new Error(
      "Use http://localhost:5192 or HTTPS for screen sharing.",
    );
  }

  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getDisplayMedia !==
      "function"
  ) {
    throw new Error(
      "This browser does not support screen sharing.",
    );
  }

  await localParticipant.setScreenShareEnabled(!active);
}

function ScreenShareAction({
  active,
  compact = false,
}) {
  const { localParticipant } = useLocalParticipant();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle() {
    if (!localParticipant || busy) return;

    setBusy(true);
    setMessage("");

    try {
      await toggleScreenShare(
        localParticipant,
        active,
      );
    } catch (error) {
      setMessage(
        error?.message ||
          "Screen sharing could not start.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        compact
          ? styles.shareActionCompact
          : styles.shareAction
      }
    >
      <button
        type="button"
        className={
          active ? styles.shareStop : styles.shareStart
        }
        disabled={busy}
        onClick={toggle}
      >
        {active ? (
          <Square size={17} />
        ) : (
          <MonitorUp size={17} />
        )}

        {busy
          ? "Opening picker…"
          : active
            ? "Stop sharing"
            : "Share screen"}
      </button>

      {message && <span>{message}</span>}
    </div>
  );
}

function SquareCamera({
  trackRef,
  size,
  onSizeChange,
  overlay = false,
  visible = true,
  onToggleVisible,
}) {
  const minimum = overlay ? 220 : 340;
  const maximum = overlay ? 520 : 760;

  if (!visible) {
    return null;
  }

  return (
    <section
      className={
        overlay
          ? styles.squareCameraOverlay
          : styles.squareCamera
      }
      style={{
        "--faculty-video-size": `${size}px`,
      }}
    >
      <header>
        <div>
          <strong>
            {trackRef?.participant?.name ||
              "DocTutorials Faculty"}
          </strong>

          <span>
            {size} × {size} square video
          </span>
        </div>

        {overlay && (
          <button
            type="button"
            title="Hide Faculty video"
            onClick={onToggleVisible}
          >
            <EyeOff size={15} />
          </button>
        )}
      </header>

      <div className={styles.cameraMedia}>
        {trackRef ? (
          <VideoTrack
            key={trackKey(trackRef)}
            trackRef={trackRef}
            manageSubscription={false}
          />
        ) : (
          <div className={styles.mediaWaiting}>
            <CameraOff size={29} />
            <strong>Faculty camera is off</strong>
            <span>
              Use the Camera control below to display it.
            </span>
          </div>
        )}
      </div>

      <footer>
        <button
          type="button"
          title="Reduce Faculty video"
          disabled={size <= minimum}
          onClick={() =>
            onSizeChange(
              Math.max(minimum, size - 40),
            )
          }
        >
          <Minimize2 size={15} />
        </button>

        <input
          type="range"
          min={minimum}
          max={maximum}
          step="10"
          value={size}
          aria-label="Faculty video size"
          onChange={(event) =>
            onSizeChange(
              Number(event.target.value),
            )
          }
        />

        <button
          type="button"
          title="Enlarge Faculty video"
          disabled={size >= maximum}
          onClick={() =>
            onSizeChange(
              Math.min(maximum, size + 40),
            )
          }
        >
          <Maximize2 size={15} />
        </button>
      </footer>
    </section>
  );
}

function ScreenCanvas({
  trackRef,
  faculty,
  mode,
}) {
  return (
    <section className={styles.screenCanvas}>
      {trackRef ? (
        <div className={styles.screenMedia}>
          <VideoTrack
            key={trackKey(trackRef)}
            trackRef={trackRef}
            manageSubscription={false}
          />
        </div>
      ) : (
        <div className={styles.screenWaiting}>
          <MonitorUp size={48} />

          <strong>
            {faculty
              ? "Share your screen"
              : "Waiting for Faculty screen"}
          </strong>

          <span>
            {faculty
              ? "Use the blue Share screen control in the top bar or bottom dock."
              : "The presentation will fill this complete area."}
          </span>

          {faculty && mode !== "video" && (
            <ScreenShareAction />
          )}
        </div>
      )}
    </section>
  );
}

function FacultyControlDock({
  mode,
  cameraOverlayVisible,
  onToggleCameraOverlay,
}) {
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();

  const [busy, setBusy] = useState("");

  async function run(
    action,
    label,
  ) {
    if (!localParticipant || busy) return;

    setBusy(label);

    try {
      await action();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.facultyDock}>
      <button
        type="button"
        className={
          isMicrophoneEnabled
            ? styles.controlActive
            : styles.controlMuted
        }
        disabled={Boolean(busy)}
        onClick={() =>
          run(
            () =>
              localParticipant.setMicrophoneEnabled(
                !isMicrophoneEnabled,
              ),
            "microphone",
          )
        }
      >
        {isMicrophoneEnabled ? (
          <Mic size={18} />
        ) : (
          <MicOff size={18} />
        )}

        <span>
          {isMicrophoneEnabled
            ? "Mute"
            : "Unmute"}
        </span>
      </button>

      {mode !== "screen" && (
        <button
          type="button"
          className={
            isCameraEnabled
              ? styles.controlActive
              : styles.controlMuted
          }
          disabled={Boolean(busy)}
          onClick={() =>
            run(
              () =>
                localParticipant.setCameraEnabled(
                  !isCameraEnabled,
                ),
              "camera",
            )
          }
        >
          {isCameraEnabled ? (
            <Camera size={18} />
          ) : (
            <CameraOff size={18} />
          )}

          <span>
            {isCameraEnabled
              ? "Camera off"
              : "Camera on"}
          </span>
        </button>
      )}

      {mode !== "video" && (
        <button
          type="button"
          className={
            isScreenShareEnabled
              ? styles.controlDanger
              : styles.controlShare
          }
          disabled={Boolean(busy)}
          onClick={() =>
            run(
              () =>
                toggleScreenShare(
                  localParticipant,
                  isScreenShareEnabled,
                ),
              "screen",
            )
          }
        >
          {isScreenShareEnabled ? (
            <Square size={18} />
          ) : (
            <MonitorUp size={18} />
          )}

          <span>
            {isScreenShareEnabled
              ? "Stop share"
              : "Share screen"}
          </span>
        </button>
      )}

      {mode === "both" && (
        <button
          type="button"
          className={styles.controlNeutral}
          onClick={onToggleCameraOverlay}
        >
          {cameraOverlayVisible ? (
            <EyeOff size={18} />
          ) : (
            <Eye size={18} />
          )}

          <span>
            {cameraOverlayVisible
              ? "Hide video"
              : "Show video"}
          </span>
        </button>
      )}

      <DisconnectButton
        stopTracks
        className={styles.leaveButton}
      >
        <LogOut size={18} />
        <span>Leave</span>
      </DisconnectButton>
    </div>
  );
}

function ConnectedStudio({
  faculty,
  selectedMode,
  onModeChange,
}) {
  const participants = useParticipants();
  const room = useRoomContext();

  const trackRefs = useTracks(
    [
      {
        source: Track.Source.Camera,
        withPlaceholder: false,
      },
      {
        source: Track.Source.ScreenShare,
        withPlaceholder: false,
      },
    ],
    {
      onlySubscribed: false,
    },
  );

  const cameraTrack = selectTrack(
    trackRefs.filter(
      (item) =>
        item?.source === Track.Source.Camera ||
        item?.publication?.source ===
          Track.Source.Camera,
    ),
    faculty,
  );

  const screenTrack = selectTrack(
    trackRefs.filter(
      (item) =>
        item?.source === Track.Source.ScreenShare ||
        item?.publication?.source ===
          Track.Source.ScreenShare,
    ),
    faculty,
  );

  const studentMode = screenTrack
    ? cameraTrack
      ? "both"
      : "screen"
    : "video";

  const mode = faculty
    ? selectedMode
    : studentMode;

  const [videoSize, setVideoSize] =
    useState(620);
  const [overlaySize, setOverlaySize] =
    useState(300);
  const [
    cameraOverlayVisible,
    setCameraOverlayVisible,
  ] = useState(true);

  const [viewerAudioMuted, setViewerAudioMuted] =
    useState(true);
  const [isFullscreen, setIsFullscreen] =
    useState(false);

  const liveShellRef = useRef(null);
  const audioRootRef = useRef(null);

  useEffect(() => {
    if (faculty) return;

    function syncAudioElements() {
      const audioElements =
        audioRootRef.current?.querySelectorAll("audio") || [];

      audioElements.forEach((audio) => {
        audio.muted = viewerAudioMuted;

        if (!viewerAudioMuted) {
          audio.play().catch(() => {});
        }
      });
    }

    syncAudioElements();

    const root = audioRootRef.current;

    if (!root) return;

    const observer = new MutationObserver(
      syncAudioElements,
    );

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [faculty, viewerAudioMuted]);

  useEffect(() => {
    function updateFullscreenState() {
      setIsFullscreen(
        document.fullscreenElement === liveShellRef.current,
      );
    }

    document.addEventListener(
      "fullscreenchange",
      updateFullscreenState,
    );

    return () =>
      document.removeEventListener(
        "fullscreenchange",
        updateFullscreenState,
      );
  }, []);

  async function toggleViewerAudio() {
    if (faculty) return;

    const nextMuted = !viewerAudioMuted;

    if (!nextMuted) {
      try {
        await room?.startAudio?.();
      } catch {
        // The explicit student interaction below still
        // allows browser audio elements to attempt playback.
      }
    }

    setViewerAudioMuted(nextMuted);
  }

  async function toggleViewerFullscreen() {
    const element = liveShellRef.current;

    if (!element) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (element.requestFullscreen) {
        await element.requestFullscreen();
      }
    } catch {
      // Fullscreen support varies between mobile browsers.
    }
  }

  return (
    <div
      ref={liveShellRef}
      className={styles.liveShell}
    >
      {faculty && (
        <MediaModeController mode={mode} />
      )}

      <div className={styles.liveToolbar}>
        <div className={styles.liveStatus}>
          <span className={styles.liveIndicator}>
            <Radio size={13} />
            Live
          </span>

          <span>
            <Users size={14} />
            {participants.length} connected
          </span>

          <span>
            <ShieldCheck size={14} />
            Students watch only
          </span>
        </div>

        {faculty && (
          <div className={styles.facultyActions}>
            <ModeSelector
              mode={mode}
              onChange={onModeChange}
              compact
            />

            {mode !== "video" && (
              <ScreenShareAction
                active={Boolean(screenTrack)}
                compact
              />
            )}
          </div>
        )}
      </div>

      <div className={styles.stage}>
        {mode === "video" && (
          <div className={styles.videoOnly}>
            <SquareCamera
              trackRef={cameraTrack}
              size={videoSize}
              onSizeChange={setVideoSize}
            />
          </div>
        )}

        {mode === "screen" && (
          <ScreenCanvas
            trackRef={screenTrack}
            faculty={faculty}
            mode={mode}
          />
        )}

        {mode === "both" && (
          <div className={styles.screenWithOverlay}>
            <ScreenCanvas
              trackRef={screenTrack}
              faculty={faculty}
              mode={mode}
            />

            <SquareCamera
              trackRef={cameraTrack}
              size={overlaySize}
              onSizeChange={setOverlaySize}
              overlay
              visible={cameraOverlayVisible}
              onToggleVisible={() =>
                setCameraOverlayVisible(false)
              }
            />

            {!cameraOverlayVisible && (
              <button
                type="button"
                className={styles.restoreCamera}
                onClick={() =>
                  setCameraOverlayVisible(true)
                }
              >
                <Eye size={16} />
                Show Faculty video
              </button>
            )}
          </div>
        )}
      </div>

      <div
        ref={audioRootRef}
        className={styles.audioRenderer}
      >
        <RoomAudioRenderer />
      </div>

      {faculty && (
        <StartAudio label="Enable classroom audio" />
      )}

      {faculty ? (
        <FacultyControlDock
          mode={mode}
          cameraOverlayVisible={
            cameraOverlayVisible
          }
          onToggleCameraOverlay={() =>
            setCameraOverlayVisible(
              (current) => !current,
            )
          }
        />
      ) : (
        <div className={styles.viewerDock}>
          <span className={styles.viewerStatus}>
            <Eye size={16} />
            Watch only
          </span>

          <div className={styles.viewerControls}>
            <button
              type="button"
              className={
                viewerAudioMuted
                  ? styles.viewerMuted
                  : styles.viewerActive
              }
              onClick={toggleViewerAudio}
            >
              {viewerAudioMuted ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}

              <span>
                {viewerAudioMuted
                  ? "Unmute"
                  : "Mute"}
              </span>
            </button>

            <button
              type="button"
              className={styles.viewerControl}
              onClick={toggleViewerFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 size={17} />
              ) : (
                <Maximize2 size={17} />
              )}

              <span>
                {isFullscreen
                  ? "Exit full"
                  : "Fullscreen"}
              </span>
            </button>

            <DisconnectButton
              stopTracks
              className={styles.viewerLeave}
            >
              <LogOut size={17} />
              <span>Leave</span>
            </DisconnectButton>
          </div>
        </div>
      )}

      <ConnectionStateToast />
    </div>
  );
}

function PreJoin({
  faculty,
  mode,
  onModeChange,
  connecting,
  onJoin,
}) {
  return (
    <div
      className={`${styles.preJoin} ${
        faculty ? "" : styles.studentPreJoin
      }`}
    >
      {faculty && (
        <ModeSelector
          mode={mode}
          onChange={onModeChange}
        />
      )}

      <div className={styles.preview}>
        {mode === "video" && (
          <div className={styles.previewVideo}>
            <Camera size={46} />
            <strong>
              Large square Faculty video
            </strong>
            <span>
              Resize after the broadcast connects.
            </span>
          </div>
        )}

        {mode === "screen" && (
          <div className={styles.previewScreen}>
            <MonitorUp size={48} />
            <strong>
              Full-screen presentation
            </strong>
            <span>
              The shared screen fills the complete stage.
            </span>
          </div>
        )}

        {mode === "both" && (
          <div className={styles.previewScreen}>
            <MonitorUp size={48} />
            <strong>
              Full-screen presentation
            </strong>
            <span>
              Faculty video floats above the screen.
            </span>

            <div className={styles.previewOverlay}>
              <Camera size={28} />
              <strong>Faculty video</strong>
              <span>Resizable and hideable</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.preJoinAction}>
        <div>
          <strong>
            {faculty
              ? MODES.find(
                  (item) => item.id === mode,
                )?.title
              : "Student viewer"}
          </strong>

          <span>
            {faculty && mode !== "video"
              ? "Start the broadcast. Share screen and all media controls remain visible."
              : "Camera and microphone start after connection."}
          </span>
        </div>

        <button
          type="button"
          onClick={onJoin}
          disabled={connecting}
        >
          <LogIn size={18} />

          {connecting
            ? "Connecting…"
            : faculty
              ? "Start broadcast"
              : "Watch live"}
        </button>
      </div>
    </div>
  );
}

export default function LiveKitVideoStageIsolated({
  token,
  currentUser,
  sessionName,
  roomTitle,
}) {
  const [connection, setConnection] =
    useState(null);
  const [connecting, setConnecting] =
    useState(false);
  const [mode, setMode] =
    useState("both");
  const [error, setError] =
    useState("");

  const faculty = useMemo(
    () => currentUser?.role === "faculty",
    [currentUser?.role],
  );

  const secureMedia = useMemo(
    () => isSecureMediaContext(),
    [],
  );

  async function joinRoom() {
    if (connecting) return;

    setError("");

    if (faculty && !secureMedia) {
      setError(
        "Faculty camera, microphone, and screen sharing require localhost or HTTPS.",
      );
      return;
    }

    setConnecting(true);

    try {
      const result =
        await requestConnection(
          token,
          sessionName,
        );

      setConnection({
        ...result,
        server_url: resolveServerUrl(
          result.server_url,
        ),
      });
    } catch (joinError) {
      setError(
        joinError?.message ||
          "Unable to join the live classroom.",
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <Video size={19} />

        <div>
          <strong>{roomTitle}</strong>

          <span>
            {faculty
              ? "Choose Video, Screen, or Video + Screen"
              : "Student watch-only classroom"}
          </span>
        </div>
      </header>

      {!connection ? (
        <PreJoin
          faculty={faculty}
          mode={faculty ? mode : "both"}
          onModeChange={setMode}
          connecting={connecting}
          onJoin={joinRoom}
        />
      ) : (
        <div
          className={styles.room}
          data-lk-theme="default"
        >
          <LiveKitRoom
            serverUrl={connection.server_url}
            token={connection.participant_token}
            connect
            audio={faculty && secureMedia}
            video={
              faculty &&
              secureMedia &&
              mode !== "screen"
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
                  "Media connection failed.",
              )
            }
          >
            <ConnectedStudio
              faculty={faculty}
              selectedMode={mode}
              onModeChange={setMode}
            />
          </LiveKitRoom>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <strong>Broadcast error</strong>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
