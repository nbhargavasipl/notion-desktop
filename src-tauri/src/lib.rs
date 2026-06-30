use std::sync::{mpsc, Arc, Mutex};
use tauri::State;

pub struct AppState {
    recording: Mutex<Option<(mpsc::SyncSender<()>, mpsc::Receiver<Result<Vec<u8>, String>>)>>,
}

impl AppState {
    fn new() -> Self {
        Self { recording: Mutex::new(None) }
    }
}

// ── Audio setup probe ──────────────────────────────────────────────────────

#[tauri::command]
fn check_audio_setup() -> serde_json::Value {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();

    #[cfg(target_os = "windows")]
    return serde_json::json!({
        "os": "windows",
        "system_audio": host.default_output_device().is_some(),
        "method": "wasapi_loopback",
        "ready": true,
    });

    #[cfg(target_os = "linux")]
    {
        let found = host
            .input_devices()
            .map(|mut d| d.any(|dev| dev.name().map(|n| n.to_lowercase().contains("monitor")).unwrap_or(false)))
            .unwrap_or(false);
        return serde_json::json!({
            "os": "linux",
            "system_audio": found,
            "method": "pulseaudio_monitor",
            "ready": found,
        });
    }

    #[cfg(target_os = "macos")]
    {
        let virtual_device = host
            .input_devices()
            .ok()
            .and_then(|mut d| {
                d.find(|dev| {
                    let name = dev.name().unwrap_or_default().to_lowercase();
                    name.contains("blackhole") || name.contains("soundflower") || name.contains("loopback")
                })
                .map(|dev| dev.name().unwrap_or_default())
            });
        let ready = virtual_device.is_some();
        return serde_json::json!({
            "os": "macos",
            "system_audio": ready,
            "method": "virtual_device",
            "device_name": virtual_device,
            "ready": ready,
        });
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    return serde_json::json!({
        "os": "other",
        "system_audio": false,
        "method": "microphone_only",
        "ready": true,
    });
}

// ── Recording commands ─────────────────────────────────────────────────────

#[tauri::command]
fn start_recording(state: State<AppState>) -> Result<(), String> {
    let mut guard = state.recording.lock().unwrap();
    if guard.is_some() {
        return Err("Already recording".into());
    }

    let (stop_tx, stop_rx) = mpsc::sync_channel::<()>(1);
    let (result_tx, result_rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        let _ = result_tx.send(do_record(stop_rx));
    });

    *guard = Some((stop_tx, result_rx));
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<String, String> {
    let handle = {
        let mut guard = state.recording.lock().unwrap();
        guard.take().ok_or("Not recording")?
    };

    let _ = handle.0.send(());

    let wav = handle.1.recv().map_err(|e| e.to_string())??;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&wav))
}

// ── Audio capture implementation ───────────────────────────────────────────

fn do_record(stop_rx: mpsc::Receiver<()>) -> Result<Vec<u8>, String> {
    use cpal::traits::StreamTrait;

    let host = cpal::default_host();
    let (device, supported) = get_capture_device(&host)?;

    let sample_rate = supported.sample_rate().0;
    let channels    = supported.channels();
    let fmt         = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let samples: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let stream = build_capture_stream(&device, &config, fmt, samples.clone())?;

    stream.play().map_err(|e| e.to_string())?;
    let _ = stop_rx.recv();
    drop(stream);

    let buf = samples.lock().unwrap();
    encode_wav(&buf, channels, sample_rate)
}

/// Pick the best available device for capturing system audio.
/// Falls back to the default microphone if loopback isn't available.
fn get_capture_device(
    host: &cpal::Host,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    match try_system_capture(host) {
        Ok(pair) => Ok(pair),

        // macOS: bubble the error so the frontend can prompt BlackHole install
        Err(ref e) if e == "no_virtual_audio_device" => Err(e.clone()),

        // Everywhere else: silently fall back to the default microphone
        Err(_) => {
            let d = host
                .default_input_device()
                .ok_or_else(|| "No audio device found".to_string())?;
            let c = d.default_input_config().map_err(|e| e.to_string())?;
            Ok((d, c))
        }
    }
}

/// Platform-specific loopback device selection.
fn try_system_capture(
    host: &cpal::Host,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    // ── Windows ─────────────────────────────────────────────────────────────
    // cpal's WASAPI backend sets AUDCLNT_STREAMFLAGS_LOOPBACK automatically
    // when build_input_stream is called on an output-endpoint device.
    #[cfg(target_os = "windows")]
    return host
        .default_output_device()
        .ok_or_else(|| "No output device".to_string())
        .and_then(|d| {
            d.default_output_config()
                .map(|c| (d, c))
                .map_err(|e| e.to_string())
        });

    // ── Linux ────────────────────────────────────────────────────────────────
    // PulseAudio/PipeWire expose each output device's loopback as a
    // "<sink>.monitor" input source — find and use it.
    #[cfg(target_os = "linux")]
    return host
        .input_devices()
        .map_err(|e| e.to_string())
        .and_then(|mut devs| {
            devs.find(|d| {
                d.name()
                    .map(|n| n.to_lowercase().contains("monitor"))
                    .unwrap_or(false)
            })
            .ok_or_else(|| "No PulseAudio monitor source".to_string())
        })
        .and_then(|d| {
            d.default_input_config()
                .map(|c| (d, c))
                .map_err(|e| e.to_string())
        });

    // ── macOS ────────────────────────────────────────────────────────────────
    // CoreAudio has no built-in loopback. Look for a virtual audio driver
    // (BlackHole, Soundflower, Loopback) installed by the user.
    #[cfg(target_os = "macos")]
    return host
        .input_devices()
        .map_err(|e| e.to_string())
        .and_then(|mut devs| {
            devs.find(|d| {
                let name = d.name().unwrap_or_default().to_lowercase();
                name.contains("blackhole")
                    || name.contains("soundflower")
                    || name.contains("loopback")
            })
            .ok_or_else(|| "no_virtual_audio_device".to_string())
        })
        .and_then(|d| {
            d.default_input_config()
                .map(|c| (d, c))
                .map_err(|e| e.to_string())
        });

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    return Err("System audio capture not supported on this platform".to_string());
}

fn build_capture_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    fmt: cpal::SampleFormat,
    samples: Arc<Mutex<Vec<i16>>>,
) -> Result<cpal::Stream, String> {
    use cpal::traits::DeviceTrait;
    use cpal::SampleFormat;

    match fmt {
        SampleFormat::F32 => {
            let sc = samples;
            device.build_input_stream(
                config,
                move |data: &[f32], _| {
                    let mut buf = sc.lock().unwrap();
                    for &v in data {
                        buf.push((v.clamp(-1.0, 1.0) * 32767.0) as i16);
                    }
                },
                |e| eprintln!("Audio error: {e}"),
                None,
            )
        }
        SampleFormat::I16 => {
            let sc = samples;
            device.build_input_stream(
                config,
                move |data: &[i16], _| {
                    sc.lock().unwrap().extend_from_slice(data);
                },
                |e| eprintln!("Audio error: {e}"),
                None,
            )
        }
        SampleFormat::I32 => {
            let sc = samples;
            device.build_input_stream(
                config,
                move |data: &[i32], _| {
                    let mut buf = sc.lock().unwrap();
                    for &v in data {
                        buf.push((v >> 16) as i16);
                    }
                },
                |e| eprintln!("Audio error: {e}"),
                None,
            )
        }
        other => return Err(format!("Unsupported audio format: {other:?}")),
    }
    .map_err(|e| e.to_string())
}

fn encode_wav(samples: &[i16], channels: u16, sample_rate: u32) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("No audio captured".into());
    }
    let mut out = Vec::new();
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(std::io::Cursor::new(&mut out), spec)
        .map_err(|e| e.to_string())?;
    for &s in samples {
        writer.write_sample(s).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(out)
}

// ── Tauri entry point ──────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            check_audio_setup,
            start_recording,
            stop_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
