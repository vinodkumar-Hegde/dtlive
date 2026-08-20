import WorkbookPdfUploader from "./WorkbookPdfUploader";
import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  FileText,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

const EMPTY_RESOURCE = {
  title: "",
  url: "",
  description: "",
};

function cleanInitial(initial, facultyName) {
  return {
    session_title:
      initial?.session_title || "DocTutorials Live Medical Classroom",
    course: initial?.course || "",
    subject: initial?.subject || "",
    topic: initial?.topic || "",
    faculty_name: initial?.faculty_name || facultyName || "",
    scheduled_at: initial?.scheduled_at || "",
    duration_minutes: initial?.duration_minutes || 60,
    overview: initial?.overview || "",
    objectives_text: (initial?.objectives || []).join("\n"),
    workbooks:
      initial?.workbooks?.length > 0
        ? initial.workbooks
        : [{ ...EMPTY_RESOURCE }],
  };
}

export default function SessionSetupModal({
  open,
  initial,
  facultyName,
  saving,
  onClose,
  onSave,
  onSaveAndStart,
}) {
  const [form, setForm] = useState(() =>
    cleanInitial(initial, facultyName)
  );

  useEffect(() => {
    if (open) {
      setForm(cleanInitial(initial, facultyName));
    }
  }, [open, initial, facultyName]);

  const valid = useMemo(
    () =>
      form.session_title.trim().length >= 2 &&
      form.course.trim().length >= 2 &&
      form.subject.trim().length >= 2 &&
      form.topic.trim().length >= 2,
    [form]
  );

  if (!open) return null;

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateWorkbook(index, key, value) {
    setForm((current) => ({
      ...current,
      workbooks: current.workbooks.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      ),
    }));
  }

  function addWorkbook() {
    setForm((current) => ({
      ...current,
      workbooks: [...current.workbooks, { ...EMPTY_RESOURCE }],
    }));
  }

  function removeWorkbook(index) {
    setForm((current) => {
      const next = current.workbooks.filter(
        (_, itemIndex) => itemIndex !== index
      );
      return {
        ...current,
        workbooks: next.length ? next : [{ ...EMPTY_RESOURCE }],
      };
    });
  }

  function payload() {
    return {
      session_title: form.session_title.trim(),
      course: form.course.trim(),
      subject: form.subject.trim(),
      topic: form.topic.trim(),
      scheduled_at: form.scheduled_at || null,
      duration_minutes: Number(form.duration_minutes) || 60,
      overview: form.overview.trim(),
      objectives: form.objectives_text
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      workbooks: form.workbooks
        .map((item) => ({
          title: item.title.trim(),
          url: item.url.trim(),
          description: item.description.trim(),
        }))
        .filter((item) => item.title && item.url),
    };
  }

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true">
      <section className="setup-modal">
        <header className="setup-header">
          <div className="setup-title-icon">
            <Sparkles size={20} />
          </div>

          <div>
            <span>FACULTY SESSION BUILDER</span>
            <h2>Prepare the live medical classroom</h2>
            <p>
              Students will see these details, learning outcomes, and
              workbooks as soon as you save.
            </p>
          </div>

          <button
            type="button"
            className="setup-close"
            onClick={onClose}
            aria-label="Close setup"
          >
            <X size={20} />
          </button>
        </header>

        <div className="setup-scroll">
          <section className="setup-section">
            <div className="setup-section-heading">
              <span>01</span>
              <div>
                <strong>Class identity</strong>
                <small>What students are attending</small>
              </div>
            </div>

            <div className="setup-grid two">
              <label>
                Session title
                <input
                  value={form.session_title}
                  onChange={(event) =>
                    update("session_title", event.target.value)
                  }
                  placeholder="Clinical approach to acute chest pain"
                />
              </label>

              <label>
                Faculty
                <input value={form.faculty_name} disabled />
              </label>

              <label>
                Course
                <input
                  list="dt-course-options"
                  value={form.course}
                  onChange={(event) =>
                    update("course", event.target.value)
                  }
                  placeholder="NEET PG"
                />
                <datalist id="dt-course-options">
                  <option value="NEET PG" />
                  <option value="INI-CET" />
                  <option value="FMGE" />
                  <option value="NEET SS" />
                  <option value="MBBS Professional" />
                </datalist>
              </label>

              <label>
                Subject
                <input
                  list="dt-subject-options"
                  value={form.subject}
                  onChange={(event) =>
                    update("subject", event.target.value)
                  }
                  placeholder="Medicine"
                />
                <datalist id="dt-subject-options">
                  <option value="Anatomy" />
                  <option value="Physiology" />
                  <option value="Biochemistry" />
                  <option value="Pathology" />
                  <option value="Pharmacology" />
                  <option value="Microbiology" />
                  <option value="Forensic Medicine" />
                  <option value="PSM" />
                  <option value="Medicine" />
                  <option value="Surgery" />
                  <option value="Obstetrics and Gynaecology" />
                  <option value="Paediatrics" />
                  <option value="Orthopaedics" />
                  <option value="Radiology" />
                </datalist>
              </label>

              <label className="setup-wide">
                Topic
                <input
                  value={form.topic}
                  onChange={(event) =>
                    update("topic", event.target.value)
                  }
                  placeholder="Acute coronary syndrome: diagnosis and initial management"
                />
              </label>
            </div>
          </section>

          <section className="setup-section">
            <div className="setup-section-heading">
              <span>02</span>
              <div>
                <strong>Schedule and class brief</strong>
                <small>Context displayed above the Faculty stream</small>
              </div>
            </div>

            <div className="setup-grid schedule">
              <label>
                <span className="field-icon">
                  <CalendarDays size={15} />
                  Date and time
                </span>
                <input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={(event) =>
                    update("scheduled_at", event.target.value)
                  }
                />
              </label>

              <label>
                <span className="field-icon">
                  <Clock3 size={15} />
                  Duration
                </span>
                <select
                  value={form.duration_minutes}
                  onChange={(event) =>
                    update("duration_minutes", event.target.value)
                  }
                >
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={90}>90 minutes</option>
                  <option value={120}>120 minutes</option>
                </select>
              </label>

              <label className="setup-wide">
                Class overview
                <textarea
                  rows={3}
                  value={form.overview}
                  onChange={(event) =>
                    update("overview", event.target.value)
                  }
                  placeholder="A concise description of what will be covered and why it matters clinically."
                />
              </label>

              <label className="setup-wide">
                Learning outcomes
                <textarea
                  rows={4}
                  value={form.objectives_text}
                  onChange={(event) =>
                    update("objectives_text", event.target.value)
                  }
                  placeholder={
                    "Recognise high-risk clinical features\nInterpret the first-line investigations\nChoose the appropriate initial management"
                  }
                />
                <small>Enter one outcome per line.</small>
              </label>
            </div>
          </section>

          <section className="setup-section">
            <div className="setup-section-heading resource-heading">
              <span>03</span>
              <div>
                <strong>Class workbooks</strong>
                <small>
                  Add PDF, Drive, LMS, or future S3 resource links
                </small>
              </div>

              <button
                type="button"
                className="add-resource"
                onClick={addWorkbook}
              >
                <Plus size={15} />
                Add workbook
              </button>
            </div>

            <WorkbookPdfUploader
              roomId={initial?.room_id}
              onUploaded={(uploaded) => {
                setForm((current) => ({
                  ...current,
                  workbooks: [
                    ...current.workbooks.filter(
                      (item) => item.title || item.url || item.description
                    ),
                    {
                      title: uploaded.title,
                      url: uploaded.file_url,
                      description: `${uploaded.page_count} pages · PDF processed for live AI`,
                    },
                  ],
                }));
              }}
            />

            <div className="workbook-builder">
              {form.workbooks.map((workbook, index) => (
                <article className="workbook-editor" key={index}>
                  <div className="workbook-number">
                    <BookOpen size={17} />
                    {String(index + 1).padStart(2, "0")}
                  </div>

                  <div className="workbook-fields">
                    <label>
                      Workbook title
                      <input
                        value={workbook.title}
                        onChange={(event) =>
                          updateWorkbook(
                            index,
                            "title",
                            event.target.value
                          )
                        }
                        placeholder="ACS rapid revision workbook"
                      />
                    </label>

                    <label>
                      <span className="field-icon">
                        <Link2 size={14} />
                        Resource URL
                      </span>
                      <input
                        type="url"
                        value={workbook.url}
                        onChange={(event) =>
                          updateWorkbook(
                            index,
                            "url",
                            event.target.value
                          )
                        }
                        placeholder="https://..."
                      />
                    </label>

                    <label className="setup-wide">
                      Student instruction
                      <input
                        value={workbook.description}
                        onChange={(event) =>
                          updateWorkbook(
                            index,
                            "description",
                            event.target.value
                          )
                        }
                        placeholder="Complete pages 1–5 after the class"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    className="remove-resource"
                    onClick={() => removeWorkbook(index)}
                    aria-label="Remove workbook"
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>

            <div className="resource-note">
              <FileText size={16} />
              Local prototype stores resource links. AWS deployment can
              replace this with direct workbook upload to S3.
            </div>
          </section>
        </div>

        <footer className="setup-actions">
          <button
            type="button"
            className="setup-secondary"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            type="button"
            className="setup-save"
            disabled={!valid || saving}
            onClick={() => onSave(payload())}
          >
            <Check size={17} />
            {saving ? "Saving…" : "Save class"}
          </button>

          <button
            type="button"
            className="setup-start"
            disabled={!valid || saving}
            onClick={() => onSaveAndStart(payload())}
          >
            <Sparkles size={17} />
            {saving ? "Preparing…" : "Save and start"}
          </button>
        </footer>
      </section>
    </div>
  );
}
