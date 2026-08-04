import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Radio } from "lucide-react";

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  return [minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export default function SessionTimer({
  status,
  startedAt,
  scheduledAt,
  durationMinutes = 60,
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const details = useMemo(() => {
    const started = parseDate(startedAt);
    const scheduled = parseDate(scheduledAt);

    if (status === "live" && started) {
      return {
        mode: "live",
        label: "Class time",
        value: formatDuration((now - started.getTime()) / 1000),
      };
    }

    if (
      status !== "ended" &&
      scheduled &&
      scheduled.getTime() > now
    ) {
      return {
        mode: "scheduled",
        label: "Starts in",
        value: formatDuration((scheduled.getTime() - now) / 1000),
      };
    }

    if (status === "ended" && started) {
      return {
        mode: "ended",
        label: "Completed",
        value: `${Number(durationMinutes || 60)} min`,
      };
    }

    return {
      mode: "ready",
      label: "Duration",
      value: `${Number(durationMinutes || 60)} min`,
    };
  }, [status, startedAt, scheduledAt, durationMinutes, now]);

  return (
    <div
      className={`dt-session-timer ${details.mode}`}
      aria-label={`${details.label}: ${details.value}`}
    >
      <div className="dt-timer-icon">
        {details.mode === "live" ? (
          <Radio size={13} />
        ) : (
          <Clock3 size={13} />
        )}
      </div>

      <div className="dt-timer-copy">
        <span>{details.label}</span>
        <strong>{details.value}</strong>
      </div>
    </div>
  );
}
