import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  CornerUpLeft,
  Edit3,
  ExternalLink,
  FileText,
  GraduationCap,
  Image,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareText,
  MoreVertical,
  Paperclip,
  Pin,
  Play,
  Reply,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Stethoscope,
  Trash2,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";

import LiveKitVideoStage from "./LiveKitVideoStage";
import SessionSetupModal from "./SessionSetupModal";
import SessionTimer from "./SessionTimer";
import "./styles.css";
import "./genz-classroom.css";

const API_URL = "";
const WS_URL =
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

async function api(path, options = {}, token = "") {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || "Request failed");
  }
  return response.json();
}

function initials(name = "") {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Login({ onLogin }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("student");
  const [error, setError] = useState("");
  const [classSession, setClassSession] = useState(null);
  const [sessionSetupOpen, setSessionSetupOpen] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [mobileView, setMobileView] = useState("class");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ name, role }),
      });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">DT</div>
        <p className="eyebrow">DOCTUTORIALS</p>
        <h1>Live Session Chat</h1>
        <p className="login-copy">
          Real-time faculty interaction, moderated student discussion, and session announcements.
        </p>
        <form onSubmit={submit}>
          <label>
            Display name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              minLength={2}
              required
            />
          </label>
          <label>
            Demo role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary-button" type="submit">
            Enter live chat
          </button>
        </form>
        <p className="demo-note">
          Demo authentication is included for local testing. Replace it with DocTutorials SSO before production.
        </p>
      </section>
    </main>
  );
}

function RoomItem({ room, active, onClick }) {
  return (
    <button className={`room-item ${active ? "active" : ""}`} onClick={onClick}>
      <div className={`room-avatar ${room.room_type}`}>
        {room.room_type === "announcement" ? <Bell size={20} /> : initials(room.title)}
      </div>
      <div className="room-copy">
        <div className="room-row">
          <strong>{room.title}</strong>
          <span>{room.last_message ? formatTime(room.last_message.created_at) : ""}</span>
        </div>
        <div className="room-row">
          <p>
            {room.last_message
              ? `${room.last_message.author.name}: ${room.last_message.body}`
              : room.description}
          </p>
          {room.unread_count > 0 && <b className="unread">{room.unread_count}</b>}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({
  message,
  currentUser,
  onReply,
  onReact,
  onDelete,
  onEdit,
  onPin,
}) {
  const mine = message.author.id === currentUser.id;
  const canModerate = ["faculty", "moderator", "admin"].includes(currentUser.role);
  const canEdit = mine || ["moderator", "admin"].includes(currentUser.role);
  const [showActions, setShowActions] = useState(false);

  return (
    <article
      className={`message-row ${mine ? "mine" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!mine && <div className="message-avatar">{initials(message.author.name)}</div>}
      <div className={`message-bubble ${message.is_deleted ? "deleted" : ""}`}>
        {!mine && (
          <div className="message-author">
            <strong>{message.author.name}</strong>
            <span className={`role-chip ${message.author.role}`}>{message.author.role}</span>
          </div>
        )}

        {message.reply_to && (
          <button className="reply-preview">
            <strong>{message.reply_to.author_name}</strong>
            <span>{message.reply_to.body}</span>
          </button>
        )}

        {message.is_pinned && (
          <div className="pinned-label">
            <Pin size={12} /> Pinned
          </div>
        )}

        <p className="message-body">{message.body}</p>

        {message.attachment_url && (
          <a className="attachment" href={message.attachment_url} target="_blank" rel="noreferrer">
            <Paperclip size={15} /> Open attachment
          </a>
        )}

        <div className="message-meta">
          {message.edited_at && <span>edited</span>}
          <span>{formatTime(message.created_at)}</span>
          {mine && <Check size={14} />}
        </div>

        {message.reactions.length > 0 && (
          <div className="reaction-list">
            {message.reactions.map((reaction) => (
              <button key={reaction.emoji} onClick={() => onReact(message.id, reaction.emoji)}>
                {reaction.emoji} {reaction.count}
              </button>
            ))}
          </div>
        )}

        {showActions && !message.is_deleted && (
          <div className={`message-actions ${mine ? "left" : "right"}`}>
            <button title="Reply" onClick={() => onReply(message)}>
              <CornerUpLeft size={16} />
            </button>
            <button title="React" onClick={() => onReact(message.id, "👍")}>
              <SmilePlus size={16} />
            </button>
            {canEdit && (
              <button title="Edit" onClick={() => onEdit(message)}>
                <Edit3 size={16} />
              </button>
            )}
            {canModerate && (
              <button title="Pin" onClick={() => onPin(message.id)}>
                <Pin size={16} />
              </button>
            )}
            {canEdit && (
              <button title="Delete" onClick={() => onDelete(message.id)}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function App() {
  const [chatVisible, setChatVisible] = useState(true);
  const [resourcesVisible, setResourcesVisible] = useState(
    () => window.innerWidth > 960
  );

  const [classSession, setClassSession] = useState(null);
  const [sessionSetupOpen, setSessionSetupOpen] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [mobileView, setMobileView] = useState("class");

  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("dt-chat-session");
    return saved ? JSON.parse(saved) : null;
  });
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const messageEndRef = useRef(null);

  const activeRoom = rooms.find((room) => room.id === activeRoomId);
  const pinnedMessage = useMemo(
    () => [...messages].reverse().find((message) => message.is_pinned && !message.is_deleted),
    [messages]
  );

  function handleLogin(data) {
    const next = { token: data.access_token, user: data.user };
    localStorage.setItem("dt-chat-session", JSON.stringify(next));
    setSession(next);
  }

  function logout() {
    socketRef.current?.close();
    localStorage.removeItem("dt-chat-session");
    setSession(null);
    setRooms([]);
    setMessages([]);
  }

  useEffect(() => {
    if (!session) return;
    api("/api/rooms", {}, session.token)
      .then((data) => {
        setRooms(data);
        if (!activeRoomId && data.length) setActiveRoomId(data[0].id);
      })
      .catch((err) => {
        setError(err.message);
        if (err.message.toLowerCase().includes("token")) logout();
      });
  }, [session]);

  useEffect(() => {
    if (!session || !activeRoomId) return;

    setError("");
    setSearchTerm("");
    setSearching(false);

    api(`/api/rooms/${activeRoomId}/messages`, {}, session.token)
      .then((data) => {
        setMessages(data);
        const latest = data.at(-1)?.id;
        return api(
          `/api/rooms/${activeRoomId}/read`,
          { method: "POST", body: JSON.stringify({ message_id: latest || null }) },
          session.token
        );
      })
      .then(() => {
        setRooms((current) =>
          current.map((room) =>
            room.id === activeRoomId ? { ...room, unread_count: 0 } : room
          )
        );
      })
      .catch((err) => setError(err.message));

    const socket = new WebSocket(
      `${WS_URL}/ws/rooms/${activeRoomId}?token=${encodeURIComponent(session.token)}`
    );
    socketRef.current = socket;

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (["message_created", "message_updated", "message_deleted", "reaction_updated"].includes(data.type)) {
        const incoming = data.message;
        setMessages((current) => {
          const exists = current.some((message) => message.id === incoming.id);
          if (exists) {
            return current.map((message) => (message.id === incoming.id ? incoming : message));
          }
          return [...current, incoming];
        });
      }

      if (data.type === "presence") {
        setOnlineCount(data.online_count);
      }

      if (data.type === "typing" && data.user.id !== session.user.id) {
        setTypingUsers((current) => {
          const next = { ...current };
          if (data.is_typing) next[data.user.id] = data.user.name;
          else delete next[data.user.id];
          return next;
        });
      }

      if (data.type === "room_updated") {
        setRooms((current) =>
          current.map((room) => (room.id === data.room.id ? { ...room, ...data.room } : room))
        );
      }

      if (data.type === "session_updated") {
        setClassSession(data.session);
      }
    };

    return () => socket.close();
  }, [activeRoomId, session]);

  useEffect(() => {
    if (!session || !activeRoomId) {
      setClassSession(null);
      return;
    }

    api(`/api/rooms/${activeRoomId}/session`, {}, session.token)
      .then(setClassSession)
      .catch((err) => setError(err.message));
  }, [activeRoomId, session]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUsers]);

  async function sendMessage(event) {
    event.preventDefault();
    if (!draft.trim() || !activeRoomId) return;
    setError("");

    if (editing) {
      try {
        await api(
          `/api/messages/${editing.id}`,
          { method: "PATCH", body: JSON.stringify({ body: draft }) },
          session.token
        );
        setEditing(null);
        setDraft("");
      } catch (err) {
        setError(err.message);
      }
      return;
    }

    const body = draft;
    setDraft("");
    try {
      await api(
        `/api/rooms/${activeRoomId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            body,
            reply_to_id: replyTo?.id || null,
          }),
        },
        session.token
      );
      setReplyTo(null);
    } catch (err) {
      setDraft(body);
      setError(err.message);
    }
  }

  function sendTyping(value) {
    setDraft(value);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "typing", is_typing: true }));
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        socketRef.current?.send(JSON.stringify({ type: "typing", is_typing: false }));
      }, 900);
    }
  }

  async function react(messageId, emoji) {
    try {
      await api(
        `/api/messages/${messageId}/reactions`,
        { method: "POST", body: JSON.stringify({ emoji }) },
        session.token
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(messageId) {
    if (!window.confirm("Delete this message?")) return;
    try {
      await api(`/api/messages/${messageId}`, { method: "DELETE" }, session.token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function pin(messageId) {
    try {
      await api(`/api/messages/${messageId}/pin`, { method: "POST" }, session.token);
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(message) {
    setEditing(message);
    setReplyTo(null);
    setDraft(message.body);
  }

  async function search(event) {
    event.preventDefault();
    if (searchTerm.trim().length < 2) return;
    try {
      setSearching(true);
      const results = await api(
        `/api/rooms/${activeRoomId}/search?q=${encodeURIComponent(searchTerm)}`,
        {},
        session.token
      );
      setMessages(results.reverse());
    } catch (err) {
      setError(err.message);
    }
  }

  async function clearSearch() {
    setSearchTerm("");
    setSearching(false);
    const data = await api(`/api/rooms/${activeRoomId}/messages`, {}, session.token);
    setMessages(data);
  }

  async function saveClassSession(payload, startAfterSave = false) {
    if (!activeRoomId) return;

    try {
      setSessionSaving(true);
      setError("");

      const saved = await api(
        `/api/rooms/${activeRoomId}/session`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
        session.token
      );

      setClassSession(saved);

      if (startAfterSave) {
        const started = await api(
          `/api/rooms/${activeRoomId}/session/start`,
          {
            method: "POST",
          },
          session.token
        );
        setClassSession(started);
      }

      setSessionSetupOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSessionSaving(false);
    }
  }

  async function startPreparedSession() {
    if (!activeRoomId) return;

    try {
      setSessionSaving(true);
      setError("");
      const started = await api(
        `/api/rooms/${activeRoomId}/session/start`,
        {
          method: "POST",
        },
        session.token
      );
      setClassSession(started);
    } catch (err) {
      setError(err.message);
      setSessionSetupOpen(true);
    } finally {
      setSessionSaving(false);
    }
  }

  async function endPreparedSession() {
    if (!activeRoomId) return;
    if (!window.confirm("End this live class?")) return;

    try {
      setSessionSaving(true);
      const ended = await api(
        `/api/rooms/${activeRoomId}/session/end`,
        {
          method: "POST",
        },
        session.token
      );
      setClassSession(ended);
    } catch (err) {
      setError(err.message);
    } finally {
      setSessionSaving(false);
    }
  }

  if (!session) return <Login onLogin={handleLogin} />;

  const isFaculty = session.user.role === "faculty";
  const sessionStatus = classSession?.status || "draft";
  const sessionConfigured = Boolean(
    classSession?.course &&
      classSession?.subject &&
      classSession?.topic
  );
  const workbooks = classSession?.workbooks || [];
  const objectives = classSession?.objectives || [];
  const typingNames = Object.values(typingUsers);

  const formattedSchedule = classSession?.scheduled_at
    ? new Date(classSession.scheduled_at).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Schedule not added";

  return (
    <main className="med-classroom">
      <header className="med-topbar">
        <div className="med-brand">
          <div className="med-brand-mark med-brand-logo">
            <img
              src="/doctutorials-logo.png"
              alt="DocTutorials"
            />
          </div>

          <div className="med-brand-copy">
            <span>DOCTUTORIALS</span>
            <strong>Live Medical Classroom</strong>
            <small>Learn. Discuss. Apply clinically.</small>
          </div>
        </div>

        <div className="med-session-heading">
          <span>
            {sessionStatus === "live"
              ? "LIVE NOW"
              : isFaculty
                ? "FACULTY STUDIO"
                : "UPCOMING CLASS"}
          </span>

          <h1>
            {classSession?.session_title ||
              activeRoom?.title ||
              "Live Medical Classroom"}
          </h1>

          <div className="med-breadcrumbs">
            <strong>{classSession?.course || "Course"}</strong>
            <ChevronRight size={12} />
            <strong>{classSession?.subject || "Subject"}</strong>
            <ChevronRight size={12} />
            <strong>{classSession?.topic || "Topic awaiting Faculty"}</strong>
          </div>
        </div>

        <div className="med-top-actions">
          {!isFaculty && (
            <div className="med-panel-toggles" aria-label="Classroom layout">
              <button
                type="button"
                className={`med-layout-toggle ${
                  resourcesVisible ? "active" : ""
                }`}
                onClick={() =>
                  setResourcesVisible((current) => !current)
                }
                title={
                  resourcesVisible
                    ? "Hide class resources"
                    : "Show class resources"
                }
              >
                <Menu size={16} />
                <span>Resources</span>
              </button>

              <button
                type="button"
                className={`med-layout-toggle ${
                  chatVisible ? "active" : ""
                }`}
                onClick={() => setChatVisible((current) => !current)}
                title={chatVisible ? "Hide class chat" : "Show class chat"}
              >
                <MessageCircle size={16} />
                <span>Chat</span>
              </button>
            </div>
          )}
          <span className="med-online">{onlineCount} online</span>

          <div className="med-profile-chip">
            <div className="med-profile-avatar">
              {initials(session.user.name)}
            </div>

            <div className="med-profile-copy">
              <strong>{session.user.name}</strong>
              <span>{session.user.role}</span>
            </div>
          </div>

          <button
            type="button"
            className="med-logout"
            title="Log out"
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="med-room-strip" aria-label="Live classroom spaces">
        {rooms.map((room) => (
          <button
            type="button"
            key={room.id}
            className={`med-room-button ${
              room.id === activeRoomId ? "active" : ""
            }`}
            onClick={() => setActiveRoomId(room.id)}
          >
            {room.room_type === "announcement" ? (
              <Bell size={14} />
            ) : (
              <MessageCircle size={14} />
            )}
            {room.title}
            {room.unread_count > 0 && <b>{room.unread_count}</b>}
          </button>
        ))}

        <span className={`med-status ${sessionStatus}`}>
          {sessionStatus === "live" && <Play size={11} />}
          {sessionStatus}
        </span>
        <SessionTimer
          status={sessionStatus}
          startedAt={classSession?.started_at}
          scheduledAt={classSession?.scheduled_at}
          durationMinutes={classSession?.duration_minutes || 60}
        />

        {isFaculty && (
          <button
            type="button"
            className="med-faculty-edit"
            onClick={() => setSessionSetupOpen(true)}
          >
            <Settings2 size={14} />
            Configure class
          </button>
        )}
      </nav>

      <section
        className={`med-workspace ${
          resourcesVisible ? "resources-visible" : "resources-hidden"
        } ${chatVisible ? "chat-visible" : "chat-hidden"}`}
        data-mobile-view={mobileView}
      >
        {!isFaculty && resourcesVisible && (
          <button
            type="button"
            className="med-resource-scrim"
            aria-label="Close class resources"
            onClick={() => setResourcesVisible(false)}
          />
        )}
        <aside className="med-resource-rail">
          <header className="med-panel-header">
            <div className="med-panel-title">
              <div className="med-panel-icon">
                <GraduationCap size={18} />
              </div>
              <div>
                <strong>Class companion</strong>
                <span>Details, outcomes and resources</span>
              </div>
            </div>
          </header>

          {!sessionConfigured ? (
            <div className="med-session-empty">
              <div className="med-session-empty-icon">
                <Sparkles size={27} />
              </div>
              <strong>
                {isFaculty
                  ? "Prepare this class"
                  : "Faculty is preparing the class"}
              </strong>
              <span>
                Course, Subject, Topic, learning outcomes, and workbooks
                will appear here.
              </span>

              {isFaculty && (
                <button
                  type="button"
                  onClick={() => setSessionSetupOpen(true)}
                >
                  <Settings2 size={15} />
                  Open session builder
                </button>
              )}
            </div>
          ) : (
            <div className="med-resource-scroll">
              <article className="med-topic-card">
                <span>CLASS TOPIC</span>
                <h2>{classSession.topic}</h2>
                <p>
                  {classSession.overview ||
                    "Faculty will guide the clinical discussion and key exam applications."}
                </p>
              </article>

              <div className="med-detail-grid">
                <article className="med-detail-tile">
                  <CalendarDays size={16} />
                  <span>Schedule</span>
                  <strong>{formattedSchedule}</strong>
                </article>

                <article className="med-detail-tile">
                  <Clock3 size={16} />
                  <span>Duration</span>
                  <strong>
                    {classSession.duration_minutes || 60} minutes
                  </strong>
                </article>

                <article className="med-detail-tile">
                  <GraduationCap size={16} />
                  <span>Course</span>
                  <strong>{classSession.course}</strong>
                </article>

                <article className="med-detail-tile">
                  <Stethoscope size={16} />
                  <span>Subject</span>
                  <strong>{classSession.subject}</strong>
                </article>
              </div>

              <div className="med-section-label">
                <span>Learning outcomes</span>
                <b>{objectives.length}</b>
              </div>

              {objectives.length ? (
                <ul className="med-objective-list">
                  {objectives.map((objective, index) => (
                    <li key={`${objective}-${index}`}>{objective}</li>
                  ))}
                </ul>
              ) : (
                <div className="med-empty-card">
                  Faculty has not added learning outcomes yet.
                </div>
              )}

              <div className="med-section-label">
                <span>Class workbooks</span>
                <b>{workbooks.length}</b>
              </div>

              {workbooks.length ? (
                <div className="med-workbook-list">
                  {workbooks.map((workbook, index) => (
                    <a
                      key={`${workbook.url}-${index}`}
                      className="med-workbook-card"
                      href={workbook.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="med-workbook-icon">
                        <FileText size={17} />
                      </div>

                      <div>
                        <strong>{workbook.title}</strong>
                        <span>
                          {workbook.description ||
                            "Open class resource"}
                        </span>
                      </div>

                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="med-empty-card">
                  No workbook has been attached to this class.
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="med-stage-column">
          <div className="med-stage-context">
            <div>
              <strong>
                {classSession?.topic || "Faculty broadcast stage"}
              </strong>
              <span>
                {isFaculty
                  ? "Your camera, audio and presentation controls"
                  : "Faculty screen and video"}
              </span>
            </div>

            <span className="med-stage-badge">
              <Video size={13} />
              {isFaculty ? "Faculty broadcast" : "Watch only"}
            </span>
          </div>

          {isFaculty && sessionConfigured && sessionStatus !== "live" ? (
            <div className="med-session-empty">
              <div className="med-session-empty-icon">
                <Video size={27} />
              </div>
              <strong>Class setup is ready</strong>
              <span>
                Start the class to publish Faculty video, microphone, and
                screen sharing.
              </span>
              <button
                type="button"
                disabled={sessionSaving}
                onClick={startPreparedSession}
              >
                <Play size={15} />
                {sessionSaving ? "Starting…" : "Start live class"}
              </button>
            </div>
          ) : !isFaculty && sessionStatus !== "live" ? (
            <div className="med-session-empty">
              <div className="med-session-empty-icon">
                <Clock3 size={27} />
              </div>
              <strong>Faculty has not started yet</strong>
              <span>
                Stay in the classroom. The Faculty screen and video will
                become available when the session starts.
              </span>
            </div>
          ) : (
            <LiveKitVideoStage
              token={session.token}
              currentUser={session.user}
              sessionName={
                activeRoom?.live_session_id ||
                `dt-room-${activeRoomId || "general"}`
              }
              roomTitle={
                classSession?.session_title ||
                activeRoom?.title ||
                "DocTutorials Live Session"
              }
            />
          )}

          {isFaculty && sessionStatus === "live" && (
            <button
              type="button"
              className="med-end-session"
              onClick={endPreparedSession}
              disabled={sessionSaving}
            >
              End live class
            </button>
          )}
        </section>

        <aside className="med-chat-column">
          <header className="med-chat-header">
            <div className="med-chat-title">
              <div className="med-chat-title-icon">
                <MessageCircle size={17} />
              </div>
              <div>
                <strong>Class chat</strong>
                <span>
                  {typingNames.length
                    ? `${typingNames.join(", ")} typing`
                    : "Ask, discuss and respond"}
                </span>
              </div>
            </div>

            <form className="med-chat-search" onSubmit={search}>
              <Search size={17} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search"
              />
            </form>
          </header>

          {pinnedMessage && (
            <div className="med-pinned">
              <Pin size={14} />
              <span>{pinnedMessage.body}</span>
            </div>
          )}

          <section className="med-message-list message-list">
            <div className="date-chip">Today</div>

            {searching && (
              <div className="search-result-label">
                Search results for “{searchTerm}”
                <button type="button" onClick={clearSearch}>
                  Clear
                </button>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                currentUser={session.user}
                onReply={(item) => {
                  setReplyTo(item);
                  setEditing(null);
                }}
                onReact={react}
                onDelete={remove}
                onEdit={edit}
                onPin={pin}
              />
            ))}

            {typingNames.length > 0 && (
              <div className="typing-indicator">
                <span />
                <span />
                <span />
                {typingNames.join(", ")} typing
              </div>
            )}

            <div ref={messageEndRef} />
          </section>

          {error && (
            <div className="med-error-banner">
              <span>{error}</span>
              <button type="button" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}

          <footer className="med-composer-shell">
            {(replyTo || editing) && (
              <div className="med-composer-context">
                <div>
                  <strong>
                    {editing
                      ? "Editing message"
                      : `Replying to ${replyTo.author.name}`}
                  </strong>
                  <span>{editing ? editing.body : replyTo.body}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(null);
                    setEditing(null);
                    setDraft("");
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <form className="med-composer" onSubmit={sendMessage}>
              <button type="button" title="Attach workbook or file">
                <Paperclip size={17} />
              </button>

              <textarea
                rows={1}
                value={draft}
                onChange={(event) => sendTyping(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage(event);
                  }
                }}
                placeholder={
                  activeRoom?.is_locked &&
                  session.user.role === "student"
                    ? "This space is read-only"
                    : "Ask a clinical doubt or share an answer"
                }
                disabled={
                  activeRoom?.is_locked &&
                  session.user.role === "student"
                }
              />

              <button
                className="med-send"
                type="submit"
                disabled={!draft.trim()}
              >
                <Send size={17} />
              </button>
            </form>
          </footer>
        </aside>
      </section>



      <nav className="med-mobile-nav">
        <button
          type="button"
          className={!resourcesVisible && chatVisible ? "active" : ""}
          onClick={() => {
            setResourcesVisible(false);
            setChatVisible(true);
            setMobileView("class");
          }}
        >
          <MessageCircle size={17} />
          Live + Chat
        </button>

        <button
          type="button"
          className={!resourcesVisible && !chatVisible ? "active" : ""}
          onClick={() => {
            setResourcesVisible(false);
            setChatVisible(false);
            setMobileView("class");
          }}
        >
          <Video size={17} />
          Focus Video
        </button>

        <button
          type="button"
          className={resourcesVisible ? "active" : ""}
          onClick={() => {
            setResourcesVisible((current) => !current);
            setMobileView("class");
          }}
        >
          <Menu size={17} />
          Resources
        </button>
      </nav>

      <SessionSetupModal
        open={sessionSetupOpen}
        initial={classSession}
        facultyName={session.user.name}
        saving={sessionSaving}
        onClose={() => setSessionSetupOpen(false)}
        onSave={(payload) => saveClassSession(payload, false)}
        onSaveAndStart={(payload) => saveClassSession(payload, true)}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
