import { useRef, useState } from "react";
import { CheckCircle2, FileText, LoaderCircle, UploadCloud } from "lucide-react";

function getStoredToken() {
  try {
    const value = JSON.parse(localStorage.getItem("dt-chat-session") || "{}");
    return value?.access_token || value?.token || "";
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

async function resolveWorkbookApiBase() {
  const configured = (
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    ""
  ).replace(/\/$/, "");

  const directBackend = `${window.location.protocol}//${window.location.hostname}:8092`;
  const candidates = unique([
    "",
    configured,
    window.location.protocol === "http:" ? directBackend : null,
  ]);

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/api/workbooks/health`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.service === "workbook-processing" && payload?.status === "ok") {
        return base;
      }
    } catch {
      // Try the next endpoint candidate.
    }
  }

  throw new Error(
    `Workbook API is unavailable. Checked the application origin and ${directBackend}.`
  );
}

export default function WorkbookPdfUploader({ roomId, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [lastUpload, setLastUpload] = useState(null);

  const uploadFile = async (file) => {
    if (!roomId) {
      setError("Save the class details once before uploading a workbook.");
      return;
    }
    if (!file || (!file.name?.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")) {
      setError("Select a PDF workbook.");
      return;
    }

    const token = getStoredToken();
    if (!token) {
      setError("Your login session is unavailable. Log in again.");
      return;
    }

    setUploading(true);
    setProgress(0);
    setError("");
    setLastUpload(null);

    let apiBase = "";
    try {
      apiBase = await resolveWorkbookApiBase();
    } catch (serviceError) {
      setUploading(false);
      setError(serviceError.message || "Cannot reach the workbook processing service.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("title", file.name.replace(/\.pdf$/i, ""));
    form.append("description", "Uploaded and processed before the live class");

    const endpoint = `${apiBase}/api/rooms/${roomId}/workbooks/upload`;
    const request = new XMLHttpRequest();
    request.open("POST", endpoint);
    request.timeout = 180000;
    request.setRequestHeader("Authorization", `Bearer ${token}`);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      setUploading(false);
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch {
        payload = {};
      }

      if (request.status < 200 || request.status >= 300) {
        setError(payload.detail || `Workbook upload failed with HTTP ${request.status}.`);
        return;
      }

      setProgress(100);
      setLastUpload(payload);
      onUploaded?.(payload);
      if (inputRef.current) inputRef.current.value = "";
    };

    request.onerror = () => {
      setUploading(false);
      setError(`Cannot reach the workbook processing service at ${endpoint}.`);
    };

    request.ontimeout = () => {
      setUploading(false);
      setError("Workbook processing exceeded three minutes. Try a smaller PDF.");
    };

    request.send(form);
  };

  return (
    <section className="workbook-pdf-uploader">
      <input
        ref={inputRef}
        className="workbook-pdf-input"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => void uploadFile(event.target.files?.[0])}
      />

      <button
        type="button"
        className="workbook-pdf-action"
        disabled={uploading || !roomId}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <LoaderCircle size={20} className="workbook-spin" />
        ) : (
          <UploadCloud size={20} />
        )}
        <span>
          <strong>{uploading ? `Processing PDF ${progress}%` : "Upload PDF workbook"}</strong>
          <small>Extract every page now for MCQs, transcript grounding, and doubt clarification</small>
        </span>
      </button>

      {uploading && (
        <div className="workbook-pdf-progress" aria-label={`Upload ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {lastUpload && (
        <div className="workbook-pdf-result">
          {lastUpload.status === "ready" ? <CheckCircle2 size={18} /> : <FileText size={18} />}
          <span>
            <strong>{lastUpload.title}</strong>
            <small>
              {lastUpload.page_count} pages · {lastUpload.extracted_page_count} pages with extracted text
              {lastUpload.status === "needs_ocr" ? " · OCR required" : ""}
            </small>
          </span>
        </div>
      )}

      {error && <p className="workbook-pdf-error">{error}</p>}
    </section>
  );
}
