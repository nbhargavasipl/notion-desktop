import { useState, useRef, useEffect } from "react";

interface TranscriptResult {
  input_language:        string;
  original_transcript:   string;
  translated_transcript: string;
  confidence:            number | null;
  low_confidence:        boolean;
}

type Status = "idle" | "recording" | "processing" | "done" | "error";

// True when running inside the Tauri desktop shell
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function loadConfig() {
  return {
    apiUrl:         localStorage.getItem("apiUrl")         || "",
    apiKey:         localStorage.getItem("apiKey")         || "",
    targetLanguage: localStorage.getItem("targetLanguage") || "en",
  };
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export default function Meeting() {
  const [status,  setStatus]  = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result,  setResult]  = useState<TranscriptResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Browser-mode MediaRecorder refs (unused in Tauri mode)
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks        = useRef<Blob[]>([]);
  const streamRef     = useRef<MediaStream | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopTimer(), []);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  };

  // ── Tauri native path ──────────────────────────────────────────────────────
  const startTauri = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_recording");
    setStatus("recording");
    startTimer();
  };

  const stopTauri = async () => {
    stopTimer();
    setStatus("processing");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const wavB64: string = await invoke("stop_recording");
      const blob = base64ToBlob(wavB64, "audio/wav");
      const file = new File([blob], `meeting-${Date.now()}.wav`, { type: "audio/wav" });
      await uploadFile(file);
    } catch (e: unknown) {
      setError((e as Error).message || "Recording failed");
      setStatus("error");
    }
  };

  // ── Browser fallback path (mic only, no system audio) ─────────────────────
  const startBrowser = async () => {
    chunks.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      const file = new File([blob], `meeting-${Date.now()}.webm`, { type: "audio/webm" });
      await uploadFile(file);
    };
    recorder.start(1000);
    setStatus("recording");
    startTimer();
  };

  const stopBrowser = () => {
    stopTimer();
    mediaRecorder.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    setStatus("processing");
  };

  // ── Shared upload ─────────────────────────────────────────────────────────
  const uploadFile = async (file: File) => {
    const { apiUrl, apiKey, targetLanguage } = loadConfig();
    if (!apiUrl || !apiKey) {
      setError("API URL and key not set — go to Settings first.");
      setStatus("error");
      return;
    }

    try {
      const form = new FormData();
      form.append("file", file);
      const url = `${apiUrl.replace(/\/$/, "")}/?target_language=${targetLanguage}`;
      const res  = await fetch(url, { method: "POST", headers: { "X-API-Key": apiKey }, body: form });
      const data = await res.json();

      if (!data.success) {
        setError(data.message || `Error ${res.status}`);
        setStatus("error");
      } else {
        setResult(data);
        setStatus("done");
        const history = JSON.parse(localStorage.getItem("history") || "[]");
        history.unshift({ ...data, filename: `Meeting (${fmt(elapsed)})`, timestamp: Date.now() });
        localStorage.setItem("history", JSON.stringify(history.slice(0, 50)));
      }
    } catch (e: unknown) {
      setError((e as Error).message || "Upload failed");
      setStatus("error");
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const startRecording = async () => {
    setError(null);
    setResult(null);
    try {
      if (IS_TAURI) {
        await startTauri();
      } else {
        await startBrowser();
      }
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      setError(msg.includes("Permission denied") || msg.includes("NotAllowed")
        ? "Microphone access denied. Allow it in System Preferences and try again."
        : msg || "Failed to start recording.");
    }
  };

  const stopRecording = async () => {
    if (IS_TAURI) {
      await stopTauri();
    } else {
      stopBrowser();
    }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setError(null);
    setElapsed(0);
    chunks.current = [];
  };

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Meeting Capture</h2>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 28 }}>
        Record any meeting (Teams, Zoom, Google Meet) and get a full transcript + English translation.
        {IS_TAURI
          ? " Recording uses your microphone directly — no browser popup."
          : " Make sure your microphone can hear the meeting audio."}
      </p>

      {/* Recording status card */}
      <div style={{
        background: "#1a1a1a", borderRadius: 12, padding: 28, marginBottom: 24,
        border: `1px solid ${status === "recording" ? "#ef4444" : "#2a2a2a"}`,
        display: "flex", alignItems: "center", gap: 20,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
          background: status === "recording" ? "#ef4444"
            : status === "processing" ? "#f59e0b"
            : status === "done"        ? "#4ade80"
            : "#333",
          boxShadow: status === "recording" ? "0 0 0 4px rgba(239,68,68,0.2)" : "none",
          animation: status === "recording" ? "pulse 1.5s infinite" : "none",
        }} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 2 }}>
            {status === "idle"       && "Ready to record"}
            {status === "recording"  && `Recording — ${fmt(elapsed)}`}
            {status === "processing" && "Uploading & transcribing…"}
            {status === "done"       && "Transcription complete"}
            {status === "error"      && "Something went wrong"}
          </div>
          <div style={{ fontSize: 13, color: "#666" }}>
            {status === "idle"       && "Press Start when your meeting begins"}
            {status === "recording"  && "Press Stop when the meeting ends"}
            {status === "processing" && "This usually takes 10–30 seconds"}
            {status === "done"       && `Recorded ${fmt(elapsed)} of audio`}
            {status === "error"      && error}
          </div>
        </div>

        {status === "idle" && (
          <button onClick={startRecording} style={{
            background: "#ef4444", color: "#fff", border: "none",
            borderRadius: 8, padding: "10px 24px", fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>
            Start Recording
          </button>
        )}
        {status === "recording" && (
          <button onClick={stopRecording} style={{
            background: "#1a1a1a", color: "#ef4444", border: "1px solid #ef4444",
            borderRadius: 8, padding: "10px 24px", fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>
            Stop & Transcribe
          </button>
        )}
        {(status === "done" || status === "error") && (
          <button onClick={reset} style={{
            background: "#2a2a2a", color: "#888", border: "none",
            borderRadius: 8, padding: "10px 24px", fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>
            New Recording
          </button>
        )}
      </div>

      {/* Transcript results */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Original · {result.input_language}</span>
              <button
                onClick={() => navigator.clipboard.writeText(result!.original_transcript)}
                style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 12 }}>
                Copy
              </button>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "#e5e5e5", whiteSpace: "pre-wrap" }}>
              {result.original_transcript}
            </div>
          </div>

          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Translation · EN</span>
              <button
                onClick={() => navigator.clipboard.writeText(result!.translated_transcript)}
                style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 12 }}>
                Copy
              </button>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.7, color: "#e5e5e5", whiteSpace: "pre-wrap" }}>
              {result.translated_transcript}
            </div>
          </div>

          {result.confidence !== null && (
            <div style={{ gridColumn: "1/-1", background: "#1a1a1a", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "#888" }}>Confidence</span>
                <div style={{ flex: 1, background: "#2a2a2a", borderRadius: 99, height: 6, overflow: "hidden" }}>
                  <div style={{
                    width: `${result.confidence * 100}%`, height: "100%", borderRadius: 99,
                    background: result.low_confidence ? "#f59e0b" : "#4ade80",
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: result.low_confidence ? "#f59e0b" : "#4ade80" }}>
                  {(result.confidence * 100).toFixed(0)}%
                  {result.low_confidence && " · Low"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
