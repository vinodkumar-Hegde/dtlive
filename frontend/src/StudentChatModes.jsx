import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertTriangle,
  Bot,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Eraser,
  LoaderCircle,
  LockKeyhole,
  Send,
  Users,
  Zap,
  Square,
} from "lucide-react";

function storageKey(userId, roomId) {
  return `dt-ai-clean-v1:${userId}:${roomId}`;
}

function loadMessages(key) {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(key) ||
        "[]"
    );

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function parseStreamLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function inlineMarkup(
  value,
  keyPrefix
) {
  return String(value || "")
    .split(
      /(\*\*[^*]+\*\*|`[^`]+`)/
    )
    .filter(Boolean)
    .map((part, index) => {
      const key =
        `${keyPrefix}-${index}`;

      if (
        part.startsWith("**") &&
        part.endsWith("**")
      ) {
        return (
          <strong key={key}>
            {part.slice(2, -2)}
          </strong>
        );
      }

      if (
        part.startsWith("`") &&
        part.endsWith("`")
      ) {
        return (
          <code key={key}>
            {part.slice(1, -1)}
          </code>
        );
      }

      return (
        <React.Fragment key={key}>
          {part}
        </React.Fragment>
      );
    });
}

function AcademicAnswer({ text }) {
  const raw = String(text || "")
    .replace(/\r/g, "")
    .replace(
      /^(Workbook source:|Source type:).*$/gim,
      ""
    )
    .trim();

  if (!raw) return null;

  let lines = raw
    .split("\n")
    .map((line) => line.trim());

  if (
    lines.length === 1 &&
    raw.length > 220
  ) {
    const sentences =
      raw.match(
        /[^.!?]+[.!?]+|[^.!?]+$/g
      ) || [raw];

    lines = [];

    for (
      let index = 0;
      index < sentences.length;
      index += 2
    ) {
      lines.push(
        sentences
          .slice(index, index + 2)
          .join(" ")
          .trim()
      );
    }
  }

  return (
    <div className="dtai2-answer">
      {lines.map((line, index) => {
        if (!line) {
          return (
            <span
              key={`space-${index}`}
              className="dtai2-space"
            />
          );
        }

        const heading = line.match(
          /^(#{1,3})\s+(.+)$/
        );

        if (heading) {
          return (
            <h4
              key={`heading-${index}`}
            >
              {inlineMarkup(
                heading[2],
                `heading-${index}`
              )}
            </h4>
          );
        }

        const bullet = line.match(
          /^[-*•]\s+(.+)$/
        );

        if (bullet) {
          return (
            <div
              key={`bullet-${index}`}
              className="dtai2-bullet"
            >
              <i aria-hidden="true" />
              <span>
                {inlineMarkup(
                  bullet[1],
                  `bullet-${index}`
                )}
              </span>
            </div>
          );
        }

        const numbered = line.match(
          /^(\d+)[.)]\s+(.+)$/
        );

        if (numbered) {
          return (
            <div
              key={`number-${index}`}
              className="dtai2-number"
            >
              <b>{numbered[1]}</b>
              <span>
                {inlineMarkup(
                  numbered[2],
                  `number-${index}`
                )}
              </span>
            </div>
          );
        }

        const labelled = line.match(
          /^([A-Za-z][A-Za-z /-]{2,32}):\s*(.+)$/
        );

        if (labelled) {
          const label =
            labelled[1].toLowerCase();

          return (
            <div
              key={`label-${index}`}
              className={`dtai2-callout ${
                label.includes(
                  "direct answer"
                )
                  ? "is-direct"
                  : ""
              }`}
            >
              <strong>
                {labelled[1]}
              </strong>
              <span>
                {inlineMarkup(
                  labelled[2],
                  `label-${index}`
                )}
              </span>
            </div>
          );
        }

        return (
          <p
            key={`paragraph-${index}`}
          >
            {inlineMarkup(
              line,
              `paragraph-${index}`
            )}
          </p>
        );
      })}
    </div>
  );
}

export default function StudentChatModes({
  session,
  roomId,
}) {
  const isStudent =
    session?.user?.role === "student";

  const authToken =
    session?.token ||
    session?.access_token ||
    "";

  const key = useMemo(
    () =>
      storageKey(
        session?.user?.id ||
          "student",
        roomId || "room"
      ),
    [
      session?.user?.id,
      roomId,
    ]
  );

  const [mode, setMode] =
    useState("live");

  const [quality, setQuality] =
    useState("balanced");

  const [messages, setMessages] =
    useState([]);

  const [draft, setDraft] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const listRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!isStudent) return;

    setMessages(
      loadMessages(key)
    );
  }, [isStudent, key]);

  useEffect(() => {
    if (!isStudent) return;

    try {
      window.localStorage.setItem(
        key,
        JSON.stringify(
          messages
            .filter(
              (message) =>
                !message.pending
            )
            .slice(-30)
        )
      );
    } catch {
      // Local persistence is optional.
    }
  }, [
    isStudent,
    key,
    messages,
  ]);

  useEffect(() => {
    if (mode !== "ai") return;

    window.requestAnimationFrame(
      () => {
        listRef.current?.scrollTo({
          top:
            listRef.current
              .scrollHeight,
          behavior: "smooth",
        });
      }
    );
  }, [mode, messages, busy]);

  useEffect(
    () => () =>
      abortRef.current?.abort(),
    []
  );

  if (!isStudent) {
    return null;
  }

  function updateAssistant(
    messageId,
    updater
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? updater(message)
          : message
      )
    );
  }

  async function submit(event) {
    event.preventDefault();

    const question =
      draft.trim();

    if (
      !question ||
      busy ||
      !roomId
    ) {
      return;
    }

    if (!authToken) {
      setMessages((current) => [
        ...current,
        {
          id: `auth-${Date.now()}`,
          role: "assistant",
          error: true,
          content:
            "Your classroom login has expired.",
          detail:
            "Log out and sign in again as Student.",
        },
      ]);
      return;
    }

    const requestId =
      Date.now();

    const assistantId =
      `assistant-${requestId}`;

    const userMessage = {
      id: `user-${requestId}`,
      role: "user",
      content: question,
    };

    const assistantMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      pending: true,
      sourceType: "",
      sources: [],
      model: "",
      latency: null,
      confidence: "",
    };

    setMessages((current) => [
      ...current,
      userMessage,
      assistantMessage,
    ]);

    setDraft("");
    setBusy(true);

    const controller =
      new AbortController();

    abortRef.current =
      controller;

    try {
      const response = await fetch(
        "/api/ai/tutor/stream",
        {
          method: "POST",
          signal:
            controller.signal,
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            room_id: roomId,
            question,
            quality_mode: quality,
            history: messages
              .filter(
                (message) =>
                  !message.error &&
                  !message.pending &&
                  message.content
              )
              .slice(-4)
              .map((message) => ({
                role: message.role,
                content:
                  message.content,
              })),
          }),
        }
      );

      if (!response.ok) {
        const failure =
          await response
            .json()
            .catch(() => ({
              detail:
                "AI Tutor request failed",
            }));

        throw new Error(
          failure.detail ||
            "AI Tutor request failed"
        );
      }

      if (!response.body) {
        throw new Error(
          "Streaming response was unavailable"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let buffer = "";
      let finished = false;

      function handleEvent(
        eventData
      ) {
        if (!eventData) return;

        if (
          eventData.type ===
          "meta"
        ) {
          updateAssistant(
            assistantId,
            (message) => ({
              ...message,
              sourceType:
                eventData.source_type,
              sources:
                eventData.sources ||
                [],
            })
          );
        }

        if (
          eventData.type ===
          "delta"
        ) {
          updateAssistant(
            assistantId,
            (message) => ({
              ...message,
              content:
                message.content +
                (
                  eventData.content ||
                  ""
                ),
              pending: true,
            })
          );
        }

        if (
          eventData.type ===
          "done"
        ) {
          updateAssistant(
            assistantId,
            (message) => ({
              ...message,
              pending: false,
              model:
                eventData.model,
              latency:
                eventData
                  .latency_seconds,
              confidence:
                eventData.confidence,
              sourceType:
                eventData
                  .source_type ||
                message.sourceType,
              sources:
                eventData.sources ||
                message.sources,
            })
          );
        }

        if (
          eventData.type ===
          "error"
        ) {
          throw new Error(
            eventData.detail ||
              "Local AI generation failed"
          );
        }
      }

      while (!finished) {
        const {
          value,
          done,
        } = await reader.read();

        finished = done;

        buffer += decoder.decode(
          value ||
            new Uint8Array(),
          {
            stream: !done,
          }
        );

        const lines =
          buffer.split("\n");

        buffer =
          lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          handleEvent(
            parseStreamLine(line)
          );
        }
      }

      if (buffer.trim()) {
        handleEvent(
          parseStreamLine(buffer)
        );
      }

      updateAssistant(
        assistantId,
        (message) => ({
          ...message,
          pending: false,
          content:
            message.content ||
            "The local model returned no answer.",
        })
      );
    } catch (requestError) {
      if (
        requestError?.name ===
        "AbortError"
      ) {
        updateAssistant(
          assistantId,
          (message) => ({
            ...message,
            pending: false,
            content:
              message.content ||
              "Answer stopped.",
          })
        );
      } else {
        updateAssistant(
          assistantId,
          (message) => ({
            ...message,
            pending: false,
            error: true,
            content:
              message.content ||
              "The private AI Tutor could not complete this answer.",
            detail:
              requestError?.message ||
              "Unknown local AI error",
          })
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function clearHistory() {
    abortRef.current?.abort();
    setMessages([]);

    try {
      window.localStorage.removeItem(
        key
      );
    } catch {
      // Optional.
    }
  }

  return (
    <div className="dtai2-root">
      <div className="dtai2-tabs">
        <button
          type="button"
          className={
            mode === "live"
              ? "active"
              : ""
          }
          onClick={() =>
            setMode("live")
          }
        >
          <Users size={15} />
          <span>Live Mode</span>
        </button>

        <button
          type="button"
          className={
            mode === "ai"
              ? "active ai"
              : ""
          }
          onClick={() =>
            setMode("ai")
          }
        >
          <Bot size={16} />
          <span>AI Tutor</span>
          <i>Private</i>
        </button>
      </div>

      {mode === "ai" && (
        <section className="dtai2-panel">
          <header className="dtai2-header">
            <div>
              <span className="dtai2-logo">
                <Bot size={20} />
              </span>

              <div>
                <strong>
                  DocTutorials AI Tutor
                </strong>
                <small>
                  Private academic clarification
                </small>
              </div>
            </div>

            <button
              type="button"
              className="dtai2-clear"
              onClick={clearHistory}
              disabled={
                !messages.length
              }
              title="Clear AI conversation"
            >
              <Eraser size={15} />
            </button>
          </header>

          <div className="dtai2-private">
            <LockKeyhole size={13} />
            This conversation is not posted to Live Mode.
          </div>

          <div className="dtai2-quality">
            <button
              type="button"
              className={
                quality ===
                "balanced"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setQuality(
                  "balanced"
                )
              }
            >
              <Zap size={13} />
              Quick Answer
            </button>

            <button
              type="button"
              className={
                quality === "deep"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setQuality("deep")
              }
            >
              <BrainCircuit
                size={13}
              />
              Detailed
            </button>
          </div>

          <div
            className="dtai2-list"
            ref={listRef}
          >
            {!messages.length && (
              <div className="dtai2-empty">
                <span>
                  <Zap size={26} />
                </span>

                <strong>
                  Ask an academic question
                </strong>

                <p>
                  The answer streams progressively and is organised into a direct answer, key points and source information.
                </p>
              </div>
            )}

            {messages.map(
              (message) => (
                <article
                  key={message.id}
                  className={`dtai2-message ${
                    message.role
                  } ${
                    message.error
                      ? "error"
                      : ""
                  }`}
                >
                  <div className="dtai2-author">
                    {message.role ===
                    "assistant" ? (
                      <>
                        <Bot
                          size={14}
                        />
                        <span>
                          DocTutorials AI
                        </span>
                      </>
                    ) : (
                      <span>You</span>
                    )}
                  </div>

                  <div className="dtai2-copy">
                    {message.role ===
                      "assistant" &&
                    message.content ? (
                      <AcademicAnswer
                        text={
                          message.content
                        }
                      />
                    ) : (
                      message.content
                    )}

                    {message.pending &&
                      !message.content && (
                        <span className="dtai2-loading">
                          <LoaderCircle
                            size={14}
                            className="dtai2-spin"
                          />
                          Preparing the first words…
                        </span>
                      )}

                    {message.pending &&
                      message.content && (
                        <span className="dtai2-cursor" />
                      )}
                  </div>

                  {message.error && (
                    <details className="dtai2-error-detail">
                      <summary>
                        <AlertTriangle
                          size={13}
                        />
                        Technical details
                      </summary>
                      <code>
                        {message.detail}
                      </code>
                    </details>
                  )}

                  {message.role ===
                    "assistant" &&
                    !message.error &&
                    !message.pending && (
                      <>
                        <div
                          className={`dtai2-source ${
                            message.sourceType
                          }`}
                        >
                          {message.sourceType ===
                          "workbook" ? (
                            <BookOpen
                              size={13}
                            />
                          ) : (
                            <BrainCircuit
                              size={13}
                            />
                          )}

                          <span>
                            {message.sourceType ===
                            "workbook"
                              ? `${
                                  message
                                    .sources?.[0]
                                    ?.title ||
                                  "Workbook"
                                } · Page ${
                                  message
                                    .sources?.[0]
                                    ?.page_number ||
                                  ""
                                }`
                              : "General academic model knowledge"}
                          </span>
                        </div>

                        <footer className="dtai2-meta">
                          <span>
                            <CheckCircle2
                              size={12}
                            />
                            {message.confidence ||
                              "Completed"}
                          </span>

                          <span>
                            {message.model}
                            {message.latency
                              ? ` · ${message.latency}s`
                              : ""}
                          </span>
                        </footer>
                      </>
                    )}
                </article>
              )
            )}
          </div>

          <form
            className="dtai2-composer"
            onSubmit={submit}
          >
            <textarea
              value={draft}
              onChange={(event) =>
                setDraft(
                  event.target.value
                )
              }
              onKeyDown={(
                event
              ) => {
                if (
                  event.key ===
                    "Enter" &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask a private academic question…"
              rows={2}
              disabled={busy}
            />

            <button
              type={
                busy
                  ? "button"
                  : "submit"
              }
              onClick={
                busy
                  ? () =>
                      abortRef.current?.abort()
                  : undefined
              }
              disabled={
                !busy &&
                !draft.trim()
              }
              title={
                busy
                  ? "Stop answer"
                  : "Send to AI Tutor"
              }
            >
              {busy ? (
                <Square size={17} />
              ) : (
                <Send size={17} />
              )}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
