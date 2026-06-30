use std::sync::{mpsc, Arc, Mutex};
use tauri::State;

struct RecordingHandle {
    stop_tx: mpsc::SyncSender<()>,
    result_rx: mpsc::Receiver<Result<Vec<u8>, String>>,
}

pub struct AppState {
    recording: Mutex<Option<RecordingHandle>>,
}

impl AppState {
    fn new() -> Self {
        Self { recording: Mutex::new(None) }
    }
}

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

    *guard = Some(RecordingHandle { stop_tx, result_rx });
    Ok(())
}

fn do_record(stop_rx: mpsc::Receiver<()>) -> Result<Vec<u8>, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SampleFormat;

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone found".to_string())?;

    let supported = device
        .default_input_config()
        .map_err(|e| e.to_string())?;

    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let fmt = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let samples: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));

    let stream = match fmt {
        SampleFormat::F32 => {
            let sc = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mut buf = sc.lock().unwrap();
                        for &v in data {
                            buf.push((v.clamp(-1.0, 1.0) * 32767.0) as i16);
                        }
                    },
                    |e| eprintln!("Audio stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }
        SampleFormat::I16 => {
            let sc = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        sc.lock().unwrap().extend_from_slice(data);
                    },
                    |e| eprintln!("Audio stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }
        SampleFormat::I32 => {
            let sc = samples.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        let mut buf = sc.lock().unwrap();
                        for &v in data {
                            buf.push((v >> 16) as i16);
                        }
                    },
                    |e| eprintln!("Audio stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }
        other => return Err(format!("Unsupported audio format: {other:?}")),
    };

    stream.play().map_err(|e| e.to_string())?;
    let _ = stop_rx.recv();
    drop(stream);

    let buf = samples.lock().unwrap();
    encode_wav(&buf, channels, sample_rate)
}

fn encode_wav(samples: &[i16], channels: u16, sample_rate: u32) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("No audio captured".into());
    }
    let mut out = Vec::new();
    let cursor = std::io::Cursor::new(&mut out);
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(cursor, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        writer.write_sample(s).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<String, String> {
    let handle = {
        let mut guard = state.recording.lock().unwrap();
        guard.take().ok_or("Not recording")?
    };

    let _ = handle.stop_tx.send(());

    let wav = handle
        .result_rx
        .recv()
        .map_err(|e| e.to_string())??;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&wav))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
