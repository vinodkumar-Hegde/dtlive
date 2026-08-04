import React, { useMemo, useState } from "react";
import {
  ConnectionStateToast,
  ControlBar,
  DisconnectButton,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  LogIn,
  LogOut,
  Radio,
  ShieldCheck,
  Users,
  Video,
} from "lucide-react";
import "@livekit/components-styles";
import "./livekit-premium.css";

const API_URL = "";
const LOCAL_LIVEKIT_PORT = import.meta.env.VITE_LIVEKIT_SIGNAL_PORT || "17900";

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
    throw new Error(result.detail || "Unable to prepare the live session");
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
      "Open the app through http://localhost:5192 or the Mac Wi-Fi address. " +
      "Public video requires a WSS LiveKit deployment."
  );
}

function getTrackKey(trackRef) {
  return (
    trackRef?.publication?.trackSid ||
    `${trackRef?.participant?.identity || "participant"}-${trackRef?.source || "track"}`
  );
}

function FacultyBroadcastStage({ canBroadcast }) {
  const participants = useParticipants();

  const tracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
    { source: Track.Source.Camera, withPlaceholder: false },
  ]);

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

  const primaryTrack = screenTracks[0] || cameraTracks[0] || null;

  const pictureInPictureTrack =
    screenTracks.length > 0
      ? cameraTracks.find(
          (trackRef) =>
            trackRef.participant.identity ===
            screenTracks[0]?.participant?.identity
        ) ||
        cameraTracks[0] ||
        null
      : null;

  const excludedTracks = new Set(
    [primaryTrack, pictureInPictureTrack]
      .filter(Boolean)
      .map(getTrackKey)
  );

  const secondaryTracks = cameraTracks.filter(
    (trackRef) => !excludedTracks.has(getTrackKey(trackRef))
  );

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

      <div className="dt-broadcast-canvas">
        {primaryTrack ? (
          <div
            className={`dt-primary-video ${
              screenTracks.length > 0 ? "screen-mode" : "camera-mode"
            }`}
          >
            <VideoTrack trackRef={primaryTrack} />

            <div className="dt-faculty-caption">
              <strong>
                {primaryTrack.participant?.name || "DocTutorials Faculty"}
              </strong>
              <span>
                {screenTracks.length > 0 ? "Presenting screen" : "Faculty"}
              </span>
            </div>

            {pictureInPictureTrack && (
              <div className="dt-faculty-pip">
                <VideoTrack trackRef={pictureInPictureTrack} />
                <span>
                  {pictureInPictureTrack.participant?.name || "Faculty"}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="dt-waiting-stage">
            <div className="dt-waiting-icon">
              <Video size={31} />
            </div>

            <strong>
              {canBroadcast
                ? "Starting faculty camera"
                : "Waiting for faculty video"}
            </strong>

            <span>
              {canBroadcast
                ? "Allow camera and microphone access when the browser asks."
                : "Keep this page open. The faculty video will appear automatically."}
            </span>
          </div>
        )}

        {secondaryTracks.length > 0 && (
          <div className="dt-faculty-strip">
            {secondaryTracks.map((trackRef) => (
              <div
                className="dt-faculty-thumbnail"
                key={getTrackKey(trackRef)}
              >
                <VideoTrack trackRef={trackRef} />
                <span>{trackRef.participant?.name || "Faculty"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <RoomAudioRenderer />
      <StartAudio label="Enable faculty audio" />

      {canBroadcast ? (
        <ControlBar
          variation="minimal"
          saveUserChoices
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            chat: false,
            leave: true,
          }}
        />
      ) : (
        <div className="dt-viewer-controls">
          <span>
            <Eye size={16} />
            Watch-only mode
          </span>

          <DisconnectButton stopTracks>
            <LogOut size={16} />
            Leave video
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

  async function joinSession() {
    if (connecting) return;

    setConnecting(true);
    setError("");

    try {
      const result = await createConnection(token, sessionName);
      const resolvedServerUrl = resolveLiveKitUrl(result.server_url);

      setConnection({
        ...result,
        server_url: resolvedServerUrl,
      });
    } catch (joinError) {
      setError(joinError.message || "Unable to join the live session");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section
      className={`dt-video-panel ${connection ? "connected" : ""} ${
        expanded ? "" : "collapsed"
      }`}
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
          aria-label={expanded ? "Collapse video" : "Expand video"}
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </header>

      {expanded && !connection && (
        <div className="dt-broadcast-entry">
          <div className="dt-entry-icon">
            {canBroadcast ? <Video size={27} /> : <Eye size={27} />}
          </div>

          <div>
            <span className="dt-entry-label">
              {canBroadcast ? "FACULTY BROADCAST" : "STUDENT VIEWER"}
            </span>

            <h2>
              {canBroadcast
                ? "Start faculty video"
                : "Join the faculty live stream"}
            </h2>

            <p>
              {canBroadcast
                ? "Camera and microphone start automatically after you enter the studio. Screen sharing remains under faculty control."
                : "Your camera and microphone remain disabled. Faculty video and audio will be subscribed automatically."}
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
                ? "Start broadcast"
                : "Watch live"}
          </button>
        </div>
      )}

      {expanded && connection && (
        <div className="dt-livekit-room" data-lk-theme="default">
          <LiveKitRoom
            serverUrl={connection.server_url}
            token={connection.participant_token}
            connect
            audio={canBroadcast}
            video={
              canBroadcast
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
              dynacast: true,
            }}
            onDisconnected={() => setConnection(null)}
            onError={(roomError) =>
              setError(roomError?.message || "Media connection failed")
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
            <FacultyBroadcastStage canBroadcast={canBroadcast} />
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
