import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLensStore } from "../stores/lensStore";
import { ControlBar } from "./ControlBar";
import { ImageUpload } from "./ImageUpload";
import { ParamPanel } from "./ParamPanel";
import { ThreeViewer } from "./ThreeViewer";
import { CausticPreview } from "./CausticPreview";
import { HeightFieldStats } from "./HeightFieldStats";
import { SetupDiagram } from "./SetupDiagram";
import { ProjectPanel } from "./ProjectPanel";
import { ImageEditor } from "./ImageEditor";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1 }, mutations: { retry: 0 } },
});

// ── Collapsible section wrapper ────────────────────────────────────────────────

function LeftSection({ label, children, defaultOpen = true }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #e8e8e8", background: "#fff" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 20px",
          cursor: "pointer",
          userSelect: "none",
          background: "#fafafa",
        }}
      >
        <span style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: "#999",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 9, color: "#bbb",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 0.15s",
          display: "inline-block",
        }}>▼</span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────

function AppInner() {
  const { computeResult, params } = useLensStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#f0f0ee" }}>
      <ControlBar />
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "minmax(360px, 50%) 1fr",
        overflow: "hidden",
      }}>
        {/* Left panel */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #e0e0e0",
          overflowY: "auto",
          overflowX: "hidden",
          background: "#fff",
        }}>
          <ProjectPanel />

          <LeftSection label="Image">
            <ImageUpload />
            <ImageEditor />
          </LeftSection>

          <ParamPanel />

          <LeftSection label="Setup Diagram" defaultOpen={false}>
            <div style={{ padding: "12px 16px 16px" }}>
              <SetupDiagram />
            </div>
          </LeftSection>

          <LeftSection label="Height Field Stats" defaultOpen={false}>
            <HeightFieldStats result={computeResult} thickness={params.thickness} />
          </LeftSection>
        </div>

        {/* Right: previews stacked horizontally (wide + short) */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, borderBottom: "1px solid #e0e0e0", overflow: "hidden" }}>
            <ThreeViewer
              heightField={computeResult?.height_field ?? null}
              physicalSizeX={params.physical_size_x}
              physicalSizeY={params.physical_size_y}
            />
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <CausticPreview />
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <AppInner />
    </QueryClientProvider>
  );
}
