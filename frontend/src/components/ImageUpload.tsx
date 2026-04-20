import { useCallback, useState } from "react";
import { useLensStore } from "../stores/lensStore";

const styles: Record<string, React.CSSProperties> = {
  root: {
    padding: "0 20px 16px",
    background: "#ffffff",
  },
  label: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#888",
    marginBottom: 16,
    display: "block",
  },
  dropzone: {
    border: "1px dashed #e0e0e0",
    minHeight: 120,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    position: "relative" as const,
    overflow: "hidden",
    transition: "border-color 0.15s",
  },
  dropzoneActive: {
    border: "1px dashed #ff5500",
  },
  preview: {
    width: "100%",
    display: "block",
    objectFit: "contain" as const,
    maxHeight: 200,
  },
  hint: {
    fontSize: 12,
    color: "#888",
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: "center" as const,
    userSelect: "none" as const,
  },
  input: {
    position: "absolute" as const,
    inset: 0,
    opacity: 0,
    cursor: "pointer",
    width: "100%",
    height: "100%",
  },
  error: {
    fontSize: 11,
    color: "#ff5500",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: 8,
  },
};

export function ImageUpload() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { targetImageUrl, setTargetImage, setRawImage } = useLensStore();

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Only image files accepted.");
        return;
      }
      const maxMB = 8;
      if (file.size > maxMB * 1024 * 1024) {
        setError(`Image too large (max ${maxMB}MB).`);
        return;
      }
      setError(null);

      const url = URL.createObjectURL(file);
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.split(",")[1];
        // Get natural image dimensions
        const img = new window.Image();
        img.onload = () => {
          setRawImage(b64);
          setTargetImage(b64, url, { w: img.naturalWidth, h: img.naturalHeight });
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    },
    [setTargetImage, setRawImage],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <div style={styles.root}>
      <div
        style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={styles.input}
          onChange={onChange}
        />
        {targetImageUrl ? (
          <img src={targetImageUrl} alt="Target" style={styles.preview} />
        ) : (
          <span style={styles.hint}>Drop image or click — PNG / JPG / WEBP</span>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}
