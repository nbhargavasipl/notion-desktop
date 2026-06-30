import { useState } from "react";
import Transcribe from "./screens/Transcribe";
import Meeting from "./screens/Meeting";
import History from "./screens/History";
import Settings from "./screens/Settings";

type Screen = "transcribe" | "meeting" | "history" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("transcribe");

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <nav style={{
        width: 200, background: "#1a1a1a", padding: "24px 16px",
        display: "flex", flexDirection: "column", gap: 8, borderRight: "1px solid #2a2a2a"
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 24, color: "#fff" }}>
          Notion
        </div>
        {([
          { id: "transcribe", label: "Transcribe" },
          { id: "meeting",    label: "Meeting" },
          { id: "history",    label: "History" },
          { id: "settings",   label: "Settings" },
        ] as { id: Screen; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setScreen(id)}
            style={{
              background: screen === id ? "#2a2a2a" : "transparent",
              border: "none", borderRadius: 6, padding: "8px 12px",
              color: screen === id ? "#fff" : "#888", cursor: "pointer",
              textAlign: "left", fontSize: 14,
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {screen === "transcribe" && <Transcribe />}
        {screen === "meeting"    && <Meeting />}
        {screen === "history"    && <History />}
        {screen === "settings"   && <Settings />}
      </main>
    </div>
  );
}
