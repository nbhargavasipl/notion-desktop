import { useEffect, useState } from "react";

interface HistoryEntry {
  filename: string;
  input_language: string;
  original_transcript: string;
  translated_transcript: string;
  confidence: number | null;
  timestamp: number;
}

export default function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("history");
    if (raw) setEntries(JSON.parse(raw));
  }, []);

  const clear = () => {
    if (!confirm("Clear all history?")) return;
    localStorage.removeItem("history");
    setEntries([]);
    setSelected(null);
  };

  if (entries.length === 0) {
    return (
      <div style={{ padding: 32, color: "#888", textAlign: "center", paddingTop: 80 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
        <div>No transcriptions yet. Go to Transcribe to get started.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* List */}
      <div style={{
        width: 280, borderRight: "1px solid #2a2a2a", overflowY: "auto",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "16px 16px 12px", display: "flex",
          justifyContent: "space-between", alignItems: "center",
          borderBottom: "1px solid #2a2a2a",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>History ({entries.length})</span>
          <button
            onClick={clear}
            style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: 12 }}
          >
            Clear all
          </button>
        </div>
        {entries.map((e, i) => (
          <div
            key={i}
            onClick={() => setSelected(e)}
            style={{
              padding: "12px 16px", cursor: "pointer",
              background: selected === e ? "#2a2a2a" : "transparent",
              borderBottom: "1px solid #1f1f1f",
            }}
          >
            <div style={{ fontSize: 13, color: "#e5e5e5", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.filename}
            </div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {e.input_language} · {new Date(e.timestamp).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>

      {/* Detail */}
      <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        {selected ? (
          <>
            <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{selected.filename}</h3>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
              {selected.input_language} · {new Date(selected.timestamp).toLocaleString()}
              {selected.confidence !== null && ` · ${(selected.confidence * 100).toFixed(0)}% confidence`}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Original</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "#e5e5e5" }}>{selected.original_transcript}</div>
              </div>
              <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Translation</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "#e5e5e5" }}>{selected.translated_transcript}</div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ color: "#555", paddingTop: 40 }}>Select a transcript to view</div>
        )}
      </div>
    </div>
  );
}
