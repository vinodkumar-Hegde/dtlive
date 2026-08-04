import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Grip,
  LogIn,
  LogOut,
  MonitorUp,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Users,
  Video,
} from "lucide-react";

import "@livekit/components-styles";
import "./livekit-premium.css";

import.meta.env.VITE_LIVEKIT_SIGNAL_PORT || "17900";

const API_URL =
  import.meta.env.VITE_API_URL || "";

const LOCAL_LIVEKIT_PORT = String(
  import.meta.env.VITE_LIVEKIT_SIGNAL_PORT || "17900"
);

function hasSecureMediaAccess() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

async function createConnection(authToken, roomName) {
  const response = await fetch(`${API_URL}/api/livekit/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ room_name: roomName }),
  });

  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({ detail: "Unable to prepare the live session" }));

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
      "Open the app through the secure production classroom address."
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

function FloatingFacultyOverlay({ trackRef, visible, onHide }) {
  const shellRef = useRef(null);
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const [position, setPosition] = useState(null);

  function placeDefault() {
    const shell = shellRef.current;
    const panel = panelRef.current;

    if (!shell || !panel) return;

    const x = Math.max(12, shell.clientWidth - panel.offsetWidth - 12);
    const y = 12;
    setPosition({ x, y });
  }

  useEffect(() => {
    if (!visible) return;

    const timer = window.setTimeout(placeDefault, 30);
    window.addEventListener("resize", placeDefault);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", placeDefault);
    };
  }, [visible]);

  useEffect(() => {
    function move(event) {
      if (!dragRef.current) return;
      const shell = shellRef.current;
      const panel = panelRef.current;
      if (!shell || !panel) return;

      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      const nextX =
        event.clientX - shellRect.left - dragRef.current.offsetX;
      const nextY =
        event.clientY - shellRect.top - dragRef.current.offsetY;

      const clampedX = Math.min(
        Math.max(12, nextX),
        Math.max(12, shellRect.width - panelRect.width - 12)
      );

      const clampedY = Math.min(
        Math.max(12, nextY),
        Math.max(12, shellRect.height - panelRect.height - 12)
      );

      setPosition({ x: clampedX, y: clampedY });
    }

    function stop() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  function startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();

    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    event.preventDefault();
  }

  return (
    <>
      <div className="dt-overlay-anchor" ref={shellRef} />

      {visible ? (
        <div
          ref={panelRef}
          className="dt-floating-faculty"
          style={
            position
              ? {
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                }
              : undefined
          }
        >
          <div
            className="dt-floating-faculty-bar"
            onPointerDown={startDrag}
          >
            <span>
              <Grip size={12} />
              Faculty
            </span>

            <button
              type="button"
              onClick={onHide}
              title="Hide faculty video"
            >
              <EyeOff size={13} />
            </button>
          </div>

          <div className="dt-floating-faculty-body">
            <VideoTrack
              key={getTrackKey(trackRef)}
              trackRef={trackRef}
              manageSubscription={false}
            />
            <span>
              {trackRef.participant?.name || "Faculty"}
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="dt-overlay-show"
          onClick={() => onHide(false)}
        >
          <Eye size={14} />
          Show faculty
        </button>
      )}
    </>
  );
}

function FacultyScreenShareControl() {
  const {
    localParticipant,
    isScreenShareEnabled,
  } = useLocalParticipant();

  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState("");

  async function toggleScreenShare() {
    if (busy) return;

    setBusy(true);
    setShareError("");

    try {
      await localParticipant.setScreenShareEnabled(
        !isScreenShareEnabled,
        isScreenShareEnabled
          ? undefined
          : {
              audio: false,
              contentHint: "detail",
              resolution: {
                width: 1920,
                height: 1080,
                frameRate: 15,
              },
              selfBrowserSurface: "exclude",
              surfaceSwitching: "include",
              systemAudio: "exclude",
              video: true,
            },
        isScreenShareEnabled
          ? undefined
          : {
              videoCodec: "vp8",
              simulcast: false,
              degradationPreference: "maintain-resolution",
              videoEncoding: {
                maxBitrate: 4000000,
                maxFramerate: 15,
              },
            }
      );
    } catch (error) {
      setShareError(
        error?.message ||
          "Screen sharing could not start. Choose Entire Screen or a browser tab."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dt-faculty-share-control">
      <button
        type="button"
        className={isScreenShareEnabled ? "sharing" : ""}
        onClick={toggleScreenShare}
        disabled={busy}
      >
        {isScreenShareEnabled ? (
          <Square size={16} />
        ) : (
          <MonitorUp size={16} />
        )}

        <span>
          {busy
            ? "Preparing…"
            : isScreenShareEnabled
              ? "Stop sharing"
              : "Share presentation"}
        </span>
      </button>

      {!isScreenShareEnabled && (
        <small>
          Choose Entire Screen or Chrome Tab. Keep the shared window open.
        </small>
      )}

      {shareError && (
        <div className="dt-share-error">
          <RefreshCw size={13} />
          {shareError}
        </div>
      )}
    </div>
  );
}

function FacultyBroadcastStage({ canBroadcast }) {
  const participants = useParticipants();

  const tracks = useTracks(
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

  const screenTracks = tracks.filter(
    (trackRef) =>
      trackRef.publication?.source === Track.Source.ScreenShare ||
      trackRef.source === Track.Source.ScreenShare
  );

  const cameraTracks = tracks.filter(
    (trackRef) =>
      trackRef.publication?.source === Track.Source.Camera ||
      trackRef.source === Track.Source.Camera
  );

  function isRenderable(trackRef) {
    const publication = trackRef?.publication;

    if (!publication || publication.isMuted) {
      return false;
    }

    if (trackRef.participant?.isLocal) {
      return Boolean(publication.track);
    }

    return Boolean(
      publication.isSubscribed &&
        publication.track
    );
  }

  const screenTrack =
    [...screenTracks]
      .reverse()
      .find(isRenderable) || null;

  const primaryCameraTrack =
    [...cameraTracks]
      .reverse()
      .find(isRenderable) || null;

  const primaryTrack =
    screenTrack || primaryCameraTrack;

  const [overlayVisible, setOverlayVisible] = useState(true);

  useEffect(() => {
    if (!screenTrack) {
      setOverlayVisible(true);
    }
  }, [screenTrack]);

  return (
    <div className="dt-broadcast-shell">
      <div className="dt-broadcast-status">
        <span className="dt-broadcast-live">
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

      <div
        className={`dt-broadcast-canvas ${
          screenTrack ? "has-screen-share" : "camera-only"
        }`}
      >
        {primaryTrack ? (
          <div
            className={`dt-media-layout ${
              screenTrack ? "screen-layout" : "camera-layout"
            }`}
          >
            <div
              className={`dt-primary-video ${
                screenTrack ? "screen-mode" : "camera-mode"
              }`}
            >
              <VideoTrack
                key={getTrackKey(primaryTrack)}
                trackRef={primaryTrack}
                manageSubscription={false}
              />

              <div className="dt-faculty-caption">
                <strong>
                  {primaryTrack.participant?.name ||
                    "DocTutorials Faculty"}
                </strong>
                <span>
                  {screenTrack
                    ? "Presenting screen"
                    : "Faculty video"}
                </span>
              </div>
            </div>

            {screenTrack && primaryCameraTrack && (
              <FloatingFacultyOverlay
                trackRef={primaryCameraTrack}
                visible={overlayVisible}
                onHide={(nextValue) => {
                  if (typeof nextValue === "boolean") {
                    setOverlayVisible(nextValue);
                    return;
                  }
                  setOverlayVisible(false);
                }}
              />
            )}
          </div>
        ) : (
          <div className="dt-waiting-stage">
            <div className="dt-waiting-icon">
              <Video size={31} />
            </div>

            <strong>
              {canBroadcast
                ? "Starting Faculty camera"
                : "Waiting for Faculty video"}
            </strong>

            <span>
              {canBroadcast
                ? "Allow camera and microphone access when the browser asks."
                : "The Faculty stream will appear automatically when broadcasting starts."}
            </span>
          </div>
        )}
      </div>

      <RoomAudioRenderer />
      <StartAudio label="Enable Faculty audio" />

      {canBroadcast ? (
        <div className="dt-faculty-control-shell">
          <FacultyScreenShareControl />

          <ControlBar
            variation="minimal"
            saveUserChoices
            controls={{
              microphone: true,
              camera: true,
              screenShare: false,
              chat: false,
              leave: true,
            }}
          />
        </div>
      ) : (
        <div className="dt-viewer-controls">
          <span>
            <Eye size={15} />
            View only
          </span>

          <DisconnectButton stopTracks title="Leave live video">
            <LogOut size={15} />
            <span>Leave</span>
          </DisconnectButton>
        </div>
      )}

      <ConnectionStateToast />
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

    if (canBroadcast && !secureMediaAvailable) {
      setError(
        "Faculty camera and microphone require HTTPS or localhost. " +
          "Open the AWS classroom HTTPS address, or use " +
          "http://localhost:5192 on the same Mac."
      );
      return;
    }

    setConnecting(true);

    try {
      const result = await createConnection(token, sessionName);
      const resolvedServerUrl = resolveLiveKitUrl(
        result.server_url
      );

      setConnection({
        ...result,
        server_url: resolvedServerUrl,
      });
    } catch (joinError) {
      setError(
        joinError.message || "Unable to join the live session"
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section
      className={`dt-video-panel ${
        connection ? "connected" : ""
      } ${expanded ? "" : "collapsed"}`}
    >
      <header className="dt-video-header">
        <div className="dt-video-identity">
          <div className="dt-video-logo">
            <Video size={19} />
          </div>

          <div>
            <span>DOCTUTORIALS LIVE</span>
            <strong>{roomTitle}</strong>
            <small>
              {canBroadcast
                ? "Faculty broadcast controls"
                : "Student watch-only classroom"}
            </small>
          </div>
        </div>

        <button
          type="button"
          className="dt-video-collapse"
          onClick={() => setExpanded((value) => !value)}
          aria-label={
            expanded ? "Collapse video" : "Expand video"
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
        <div className="dt-broadcast-entry">
          <div className="dt-entry-icon">
            {canBroadcast ? (
              <Video size={27} />
            ) : (
              <Eye size={27} />
            )}
          </div>

          <div>
            <span className="dt-entry-label">
              {canBroadcast
                ? "FACULTY BROADCAST"
                : "STUDENT VIEWER"}
            </span>

            <h2>
              {canBroadcast
                ? "Start Faculty video"
                : "Join the Faculty live stream"}
            </h2>

            <p>
              {canBroadcast
                ? secureMediaAvailable
                  ? "Camera and microphone start automatically. Screen sharing remains under Faculty control."
                  : "Open this Faculty studio through HTTPS or localhost to enable camera, microphone, and screen sharing."
                : "Your camera and microphone remain disabled. Faculty video and audio subscribe automatically."}
            </p>
          </div>

          <button
            type="button"
            className="dt-video-join"
            onClick={joinSession}
            disabled={connecting}
          >
            <LogIn size={18} />
            {connecting
              ? "Connecting…"
              : canBroadcast
                ? secureMediaAvailable
                  ? "Start broadcast"
                  : "HTTPS required"
                : "Watch live"}
          </button>
        </div>
      )}

      {expanded && connection && (
        <div
          className="dt-livekit-room"
          data-lk-theme="default"
        >
          <LiveKitRoom
            serverUrl={connection.server_url}
            token={connection.participant_token}
            connect
            audio={canBroadcast && secureMediaAvailable}
            video={
              canBroadcast && secureMediaAvailable
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
                degradationPreference: "maintain-resolution",
                screenShareEncoding: {
                  maxBitrate: 4000000,
                  maxFramerate: 15,
                },
              },
            }}
            onDisconnected={() => setConnection(null)}
            onError={(roomError) =>
              setError(
                roomError?.message || "Media connection failed"
              )
            }
            onMediaDeviceFailure={(failure, kind) => {
              if (canBroadcast) {
                setError(
                  `Faculty ${kind || "media"} could not start: ${
                    failure || "permission denied"
                  }`
                );
              }
            }}
          >
            <FacultyBroadcastStage
              canBroadcast={canBroadcast}
            />
          </LiveKitRoom>
        </div>
      )}

      {expanded && error && (
        <div className="dt-video-error" role="alert">
          <strong>Video connection failed</strong>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
