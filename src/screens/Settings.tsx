import { useState, useEffect } from "react";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "fr", name: "French" },
  { code: "ar", name: "Arabic" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
];

export default function Settings() {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setApiUrl(localStorage.getItem("apiUrl") || "");
    setApiKey(localStorage.getItem("apiKey") || "");
    setTargetLanguage(localStorage.getItem("targetLanguage") || "en");
  }, []);

  const save = () => {
    localStorage.setItem("apiUrl", apiUrl.trim());
    localStorage.setItem("apiKey", apiKey.trim());
    localStorage.setItem("targetLanguage", targetLanguage);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const field: React.CSSProperties = {
    width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a",
    borderRadius: 8, padding: "10px 14px", color: "#e5e5e5",
    fontSize: 14, outline: "none",
  };
  const label: React.CSSProperties = { fontSize: 13, color: "#888", marginBottom: 6, display: "block" };

  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 32 }}>Settings</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <label style={label}>Service URL</label>
          <input
            style={field}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://your-cloud-run-url"
          />
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            Your Cloud Run service URL from GCP
          </div>
        </div>

        <div>
          <label style={label}>API Key</label>
          <input
            style={field}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your API key"
          />
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            Get your key from the Notion Web Portal
          </div>
        </div>

        <div>
          <label style={label}>Default Translation Language</label>
          <select
            style={{ ...field, cursor: "pointer" }}
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={save}
          style={{
            background: "#4ade80", color: "#000", border: "none",
            borderRadius: 8, padding: "12px 24px", fontSize: 14,
            fontWeight: 600, cursor: "pointer", alignSelf: "flex-start",
          }}
        >
          {saved ? "Saved ✓" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
