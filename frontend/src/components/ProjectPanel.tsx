import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLensStore } from "../stores/lensStore";
import type { ProjectMeta, ProjectFull } from "../types/api";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchProjects(): Promise<ProjectMeta[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json();
}

async function apiSaveProject(body: {
  name: string;
  params: object;
  target_image: string;
  height_field: number[][] | null;
}): Promise<ProjectMeta> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(d.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiLoadProject(id: string): Promise<ProjectFull> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error("Project not found");
  return res.json();
}

async function apiUpdateProject(id: string, body: {
  name: string;
  params: object;
  target_image: string;
  height_field: number[][] | null;
}): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(d.detail ?? `HTTP ${res.status}`);
  }
}

async function apiDeleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

async function apiRenameProject(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Rename failed");
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const css: Record<string, React.CSSProperties> = {
  root: {
    borderBottom: "1px solid #e0e0e0",
    background: "#ffffff",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px 10px",
    cursor: "pointer",
    userSelect: "none",
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#888",
  },
  chevron: (open: boolean): React.CSSProperties => ({
    fontSize: 10,
    color: "#aaa",
    transform: open ? "rotate(180deg)" : "rotate(0deg)",
    transition: "transform 0.15s",
  }),
  body: {
    padding: "0 16px 14px",
  },
  saveRow: {
    display: "flex",
    gap: 6,
    marginBottom: 10,
  },
  nameInput: {
    flex: 1,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    border: "1px solid #e0e0e0",
    outline: "none",
    padding: "5px 8px",
    color: "#0a0a0a",
    background: "#fafafa",
    borderRadius: 0,
    minWidth: 0,
  },
  btn: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    border: "1px solid #0a0a0a",
    background: "#0a0a0a",
    color: "#f8f8f6",
    padding: "5px 12px",
    cursor: "pointer",
    outline: "none",
    whiteSpace: "nowrap" as const,
    borderRadius: 0,
    flexShrink: 0,
  },
  btnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    maxHeight: 200,
    overflowY: "auto" as const,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 8px",
    border: "1px solid #e0e0e0",
    cursor: "pointer",
    background: "#fafafa",
    transition: "background 0.1s",
  },
  itemName: {
    flex: 1,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    color: "#0a0a0a",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    minWidth: 0,
  },
  itemMeta: {
    fontSize: 10,
    color: "#aaa",
    fontFamily: "'JetBrains Mono', monospace",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#bbb",
    fontSize: 13,
    padding: "0 2px",
    lineHeight: 1,
    flexShrink: 0,
  },
  empty: {
    fontSize: 11,
    color: "#ccc",
    fontFamily: "'JetBrains Mono', monospace",
    padding: "6px 0",
    textAlign: "center" as const,
    letterSpacing: "0.06em",
  },
  error: {
    fontSize: 10,
    color: "#ff5500",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: 4,
  },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProjectPanel() {
  const [open, setOpen] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const { targetImage, params, computeResult, currentProjectId, currentProjectName, setTargetImage, setRawImage, setParam, setComputeResult, setCurrentProjectName, setCurrentProjectId } = useLensStore();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 10_000,
  });

  const saveMutation = useMutation({
    mutationFn: apiSaveProject,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setSaveName("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiUpdateProject(id, {
        name,
        params,
        target_image: targetImage!,
        height_field: computeResult?.height_field ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const loadMutation = useMutation({
    mutationFn: apiLoadProject,
    onSuccess: (proj) => {
      // Restore params
      (Object.keys(proj.params) as Array<keyof typeof proj.params>).forEach((k) => {
        setParam(k, proj.params[k] as never);
      });
      // Restore image
      const url = `data:image/png;base64,${proj.target_image}`;
      setRawImage(proj.target_image);
      setTargetImage(proj.target_image, url);
      setCurrentProjectName(proj.name);
      setCurrentProjectId(proj.id);
      // Restore height field if present
      if (proj.height_field) {
        const ny = proj.height_field.length;
        const nx = proj.height_field[0]?.length ?? 0;
        setComputeResult({
          height_field: proj.height_field,
          width: nx,
          height: ny,
          height_field_id: "",   // not in store — user needs to re-compute for STL/sim
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: apiDeleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiRenameProject(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setRenamingId(null);
    },
  });

  const canSave = targetImage !== null && saveName.trim().length > 0;

  return (
    <div style={css.root}>
      {/* Collapsible header */}
      <div style={css.header} onClick={() => setOpen((o) => !o)}>
        <span style={css.headerLabel}>Projects</span>
        <span style={css.chevron(open)}>▼</span>
      </div>

      {open && (
        <div style={css.body}>
          {/* Update open project */}
          {currentProjectId && targetImage && (
            <div style={{ marginBottom: 10 }}>
              <button
                style={{ ...css.btn, width: "100%" }}
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ id: currentProjectId, name: currentProjectName ?? "untitled" })}
              >
                {updateMutation.isPending ? "…" : `↑ Save "${currentProjectName}"`}
              </button>
              {updateMutation.error && (
                <div style={css.error}>{(updateMutation.error as Error).message}</div>
              )}
            </div>
          )}

          {/* Save as new */}
          <div style={css.saveRow}>
            <input
              style={css.nameInput}
              placeholder="project name…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) {
                  saveMutation.mutate({
                    name: saveName.trim(),
                    params,
                    target_image: targetImage!,
                    height_field: computeResult?.height_field ?? null,
                  });
                }
              }}
            />
            <button
              style={{ ...css.btn, ...(canSave ? {} : css.btnDisabled) }}
              disabled={!canSave || saveMutation.isPending}
              onClick={() => {
                if (!canSave) return;
                saveMutation.mutate({
                  name: saveName.trim(),
                  params,
                  target_image: targetImage!,
                  height_field: computeResult?.height_field ?? null,
                });
              }}
            >
              {saveMutation.isPending ? "…" : "Save"}
            </button>
          </div>

          {saveMutation.error && (
            <div style={css.error}>{(saveMutation.error as Error).message}</div>
          )}
          {loadMutation.error && (
            <div style={css.error}>{(loadMutation.error as Error).message}</div>
          )}

          {/* Project list */}
          <div style={css.list}>
            {isLoading && <div style={css.empty}>loading…</div>}
            {!isLoading && (!projects || projects.length === 0) && (
              <div style={css.empty}>no saved projects</div>
            )}
            {projects?.map((p) => (
              <div key={p.id}>
                {renamingId === p.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      ref={renameRef}
                      style={{ ...css.nameInput, marginBottom: 0 }}
                      value={renameVal}
                      autoFocus
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && renameVal.trim()) {
                          renameMutation.mutate({ id: p.id, name: renameVal.trim() });
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                    <button
                      style={css.btn}
                      onClick={() => {
                        if (renameVal.trim()) renameMutation.mutate({ id: p.id, name: renameVal.trim() });
                      }}
                    >
                      ok
                    </button>
                  </div>
                ) : (
                  <div
                    style={css.item}
                    onClick={() => loadMutation.mutate(p.id)}
                    title={`Load "${p.name}"`}
                  >
                    <span style={css.itemName}>{p.name}</span>
                    <span style={css.itemMeta}>
                      {p.resolution ? `${p.resolution}px` : ""}
                    </span>
                    <span style={css.itemMeta}>{fmtDate(p.created_at)}</span>
                    <button
                      style={css.iconBtn}
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(p.id);
                        setRenameVal(p.name);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      style={{ ...css.iconBtn, color: "#ff5500" }}
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
