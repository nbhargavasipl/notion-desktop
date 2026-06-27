import { useState, useRef } from "react";

interface TranscriptResult {
  input_language: string;
  detected_language: string;
  original_transcript: string;
  translated_transcript: string;
  confidence: number | null;
  low_confidence: boolean;
  request_id: string;
}

function loadConfig() {
  return {
    apiUrl: localStorage.getItem("apiUrl") || "",
    apiKey: localStorage.getItem("apiKey") || "",
    targetLanguage: localStorage.getItem("targetLanguage") || "en",
  };
}

export default function Transcribe() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const transcribe = async () => {
    const { apiUrl, apiKey, targetLanguage } = loadConfig();
    if (!apiUrl || !apiKey) {
      setError("Please configure your API URL and API key in Settings first.");
      return;
    }
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const url = `${apiUrl.replace(/\/$/, "")}/?target_language=${targetLanguage}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-API-Key": apiKey },
        body: form,
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || `Error ${res.status}`);
      } else {
        setResult(data);
        // Save to local history
        const history = JSON.parse(localStorage.getItem("history") || "[]");
        history.unshift({ ...data, filename: file.name, timestamp: Date.now() });
        localStorage.setItem("history", JSON.stringify(history.slice(0, 50)));
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Transcribe Audio</h2>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${file ? "#4ade80" : "#333"}`,
          borderRadius: 12, padding: 48, textAlign: "center",
          cursor: "pointer", background: "#1a1a1a", marginBottom: 24,
          transition: "border-color 0.2s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {file ? (
          <div>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎵</div>
            <div style={{ color: "#4ade80", fontWeight: 500 }}>{file.name}</div>
            <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
            <div style={{ color: "#888", fontSize: 15 }}>
              Drop audio file here or click to browse
            </div>
            <div style={{ color: "#555", fontSize: 13, marginTop: 6 }}>
              WAV · MP3 · M4A · AAC · FLAC · OGG · WebM
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{
          background: "#2d1515", border: "1px solid #7f1d1d",
          borderRadius: 8, padding: 12, marginBottom: 16, color: "#fca5a5", fontSize: 14,
        }}>
          {error}
        </div>
      )}

      <button
        onClick={transcribe}
        disabled={!file || loading}
        style={{
          background: file && !loading ? "#4ade80" : "#2a2a2a",
          color: file && !loading ? "#000" : "#555",
          border: "none", borderRadius: 8, padding: "12px 32px",
          fontSize: 15, fontWeight: 600, cursor: file && !loading ? "pointer" : "not-allowed",
          marginBottom: 32,
        }}
      >
        {loading ? "Transcribing…" : "Transcribe"}
      </button>

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Left: original */}
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Original · {result.input_language}</span>
              <button
                onClick={() => navigator.clipboard.writeText(result.original_transcript)}
                style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 12 }}
              >
                Copy
              </button>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "#e5e5e5" }}>
              {result.original_transcript}
            </div>
          </div>

          {/* Right: translation */}
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Translation · EN</span>
              <button
                onClick={() => navigator.clipboard.writeText(result.translated_transcript)}
                style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 12 }}
              >
                Copy
              </button>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "#e5e5e5" }}>
              {result.translated_transcript}
            </div>
          </div>

          {/* Confidence bar */}
          {result.confidence !== null && (
            <div style={{ gridColumn: "1/-1", background: "#1a1a1a", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "#888" }}>Confidence</span>
                <div style={{ flex: 1, background: "#2a2a2a", borderRadius: 99, height: 6, overflow: "hidden" }}>
                  <div style={{
                    width: `${result.confidence * 100}%`,
                    height: "100%",
                    background: result.low_confidence ? "#f59e0b" : "#4ade80",
                    borderRadius: 99,
                  }} />
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: result.low_confidence ? "#f59e0b" : "#4ade80",
                }}>
                  {(result.confidence * 100).toFixed(0)}%
                  {result.low_confidence && " · Low"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
