import { useState, useRef, useEffect } from "react";

interface TranscriptResult {
  input_language:        string;
  original_transcript:   string;
  translated_transcript: string;
  confidence:            number | null;
  low_confidence:        boolean;
}

interface AudioSetup {
  os:            string;
  system_audio:  boolean;
  method:        string;
  ready:         boolean;
  device_name?:  string | null;
}

type Status = "idle" | "recording" | "processing" | "done" | "error";

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
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ── macOS setup instructions ───────────────────────────────────────────────
function MacOSSetupBanner() {
  return (
    <div style={{
      background: "#1a1200", border: "1px solid #7c5000", borderRadius: 10,
      padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#fbbf24", marginBottom: 8 }}>
        One-time setup required for meeting audio on macOS
      </div>
      <p style={{ fontSize: 13, color: "#a16207", margin: "0 0 12px" }}>
        macOS doesn't allow apps to capture system audio without a virtual audio driver.
        Install <strong style={{ color: "#fbbf24" }}>BlackHole</strong> (free, open-source, takes 2 min):
      </p>
      <ol style={{ fontSize: 13, color: "#a16207", margin: "0 0 12px", paddingLeft: 20, lineHeight: 2 }}>
        <li>Download BlackHole 2ch from <strong style={{ color: "#fbbf24" }}>existential.audio/blackhole</strong></li>
        <li>Install it (no restart needed)</li>
        <li>Open <strong>System Settings → Sound → Output</strong> → select <strong>BlackHole 2ch</strong></li>
        <li>Restart this app — recording will work automatically</li>
      </ol>
      <p style={{ fontSize: 12, color: "#78350f", margin: 0 }}>
        Note: While BlackHole is your output device, you won't hear audio through speakers.
        Create a "Multi-Output Device" in Audio MIDI Setup to hear audio and record simultaneously.
      </p>
    </div>
  );
}

// ── Linux setup instructions ───────────────────────────────────────────────
function LinuxSetupBanner() {
  return (
    <div style={{
      background: "#0f1a0f", border: "1px solid #166534", borderRadius: 10,
      padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#4ade80", marginBottom: 8 }}>
        Enable PulseAudio monitor source
      </div>
      <p style={{ fontSize: 13, color: "#166534", margin: "0 0 10px" }}>
        Run this command to load the loopback module, then restart the app:
      </p>
      <code style={{
        display: "block", background: "#0a120a", borderRadius: 6, padding: "8px 12px",
        fontSize: 12, color: "#86efac", fontFamily: "monospace",
      }}>
        pactl load-module module-loopback latency_msec=1
      </code>
    </div>
  );
}

// ── Audio capture status badge ─────────────────────────────────────────────
function AudioBadge({ setup }: { setup: AudioSetup }) {
  if (!IS_TAURI) return null;

  const labels: Record<string, string> = {
    wasapi_loopback:    "System audio (WASAPI)",
    pulseaudio_monitor: "System audio (PulseAudio)",
    virtual_device:     `System audio via ${setup.device_name ?? "virtual device"}`,
    microphone_only:    "Microphone only",
  };

  const label  = labels[setup.method] ?? setup.method;
  const colour  = setup.system_audio ? "#4ade80" : "#f59e0b";
  const bg      = setup.system_audio ? "#0d2b12"  : "#1a1200";
  const border  = setup.system_audio ? "#166534"  : "#7c5000";

  return (
    <span style={{
      display: "inline-block", fontSize: 11, padding: "3px 10px",
      borderRadius: 99, border: `1px solid ${border}`,
      background: bg, color: colour, marginBottom: 20,
    }}>
      {setup.system_audio ? "●" : "○"} {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Meeting() {
  const [status,  setStatus]  = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result,  setResult]  = useState<TranscriptResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [setup,   setSetup]   = useState<AudioSetup | null>(null);

  // Browser-mode fallback refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks        = useRef<Blob[]>([]);
  const streamRef     = useRef<MediaStream | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (IS_TAURI) {
      import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<AudioSetup>("check_audio_setup").then(setSetup)
      );
    }
    return () => stopTimer();
  }, []);

  const stopTimer  = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const startTimer = () => { setElapsed(0); timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000); };

  // ── Tauri native path ────────────────────────────────────────────────────
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

  // ── Browser mic fallback (no system audio, first-time mic permission only)
  const startBrowser = async () => {
    chunks.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      await uploadFile(new File([blob], `meeting-${Date.now()}.webm`, { type: "audio/webm" }));
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
      const res  = await fetch(`${apiUrl.replace(/\/$/, "")}/?target_language=${targetLanguage}`, {
        method: "POST", headers: { "X-API-Key": apiKey }, body: form,
      });
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
      if (msg === "no_virtual_audio_device") {
        setError("Install BlackHole to capture meeting audio — see setup instructions above.");
      } else if (msg.includes("Permission denied") || msg.includes("NotAllowed")) {
        setError("Microphone access denied. Allow it in System Settings and try again.");
      } else {
        setError(msg || "Failed to start recording.");
      }
    }
  };

  const stopRecording = async () => {
    if (IS_TAURI) await stopTauri();
    else stopBrowser();
  };

  const reset = () => { setStatus("idle"); setResult(null); setError(null); setElapsed(0); chunks.current = []; };

  // Determine if recording is possible
  const needsMacSetup  = IS_TAURI && setup?.os === "macos"  && !setup.system_audio;
  const needsLinuxSetup = IS_TAURI && setup?.os === "linux" && !setup.system_audio;
  const canRecord       = !needsMacSetup;

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Meeting Capture</h2>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
        Record any meeting (Teams, Zoom, Google Meet) and get a full transcript + English translation.
      </p>

      {setup && <AudioBadge setup={setup} />}

      {/* Platform setup banners */}
      {needsMacSetup   && <MacOSSetupBanner />}
      {needsLinuxSetup && <LinuxSetupBanner />}

      {/* Recording status card */}
      <div style={{
        background: "#1a1a1a", borderRadius: 12, padding: 28, marginBottom: 24,
        border: `1px solid ${status === "recording" ? "#ef4444" : "#2a2a2a"}`,
        display: "flex", alignItems: "center", gap: 20,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
          background: status === "recording"  ? "#ef4444"
                    : status === "processing" ? "#f59e0b"
                    : status === "done"        ? "#4ade80"
                    : needsMacSetup            ? "#555"
                    : "#333",
          boxShadow: status === "recording" ? "0 0 0 4px rgba(239,68,68,0.2)" : "none",
          animation: status === "recording" ? "pulse 1.5s infinite" : "none",
        }} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 2 }}>
            {status === "idle"       && (needsMacSetup ? "Setup required" : "Ready to record")}
            {status === "recording"  && `Recording — ${fmt(elapsed)}`}
            {status === "processing" && "Uploading & transcribing…"}
            {status === "done"       && "Transcription complete"}
            {status === "error"      && "Something went wrong"}
          </div>
          <div style={{ fontSize: 13, color: "#666" }}>
            {status === "idle"       && (needsMacSetup ? "Follow the setup steps above, then restart the app" : "Press Start when your meeting begins")}
            {status === "recording"  && "Press Stop when the meeting ends"}
            {status === "processing" && "This usually takes 10–30 seconds"}
            {status === "done"       && `Recorded ${fmt(elapsed)} of audio`}
            {status === "error"      && error}
          </div>
        </div>

        {status === "idle" && (
          <button
            onClick={startRecording}
            disabled={!canRecord}
            style={{
              background: canRecord ? "#ef4444" : "#333",
              color: canRecord ? "#fff" : "#555",
              border: "none", borderRadius: 8, padding: "10px 24px",
              fontSize: 14, fontWeight: 600,
              cursor: canRecord ? "pointer" : "not-allowed",
            }}
          >
            Start Recording
          </button>
        )}
        {status === "recording" && (
          <button onClick={stopRecording} style={{
            background: "#1a1a1a", color: "#ef4444", border: "1px solid #ef4444",
            borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
            Stop & Transcribe
          </button>
        )}
        {(status === "done" || status === "error") && (
          <button onClick={reset} style={{
            background: "#2a2a2a", color: "#888", border: "none",
            borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
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
              <button onClick={() => navigator.clipboard.writeText(result!.original_transcript)}
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
              <button onClick={() => navigator.clipboard.writeText(result!.translated_transcript)}
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
                  {(result.confidence * 100).toFixed(0)}%{result.low_confidence && " · Low"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
