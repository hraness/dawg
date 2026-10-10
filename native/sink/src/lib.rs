//! dawg's native audio sink: a ring buffer drained by a real audio callback.
//!
//! The TypeScript engine renders every sample; this library only plays them
//! (output) and captures them (input). It keeps no score or session state.
//! Everything is reached through a small C ABI loaded with `bun:ffi`.
//!
//! The ring carries interleaved frames at the caller's sample rate. The
//! device runs at its own nominal rate (opening never changes the system
//! device rate); when the two differ the callback converts with a 4-point
//! Hermite interpolator, which is the only arithmetic done on samples.
//!
//! The device name `"null"` opens a headless device: a thread that drains
//! (or fills with silence) the ring in real time, for CI and tests.

mod ring;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ring::Ring;
use std::ffi::{c_char, CStr};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Bumped when the C ABI changes shape; the loader checks it.
pub const ABI_VERSION: u32 = 1;

/// Per-direction stats, in the order `dawg_sink_stats` writes them.
pub const STAT_COUNT: usize = 12;

fn epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

/// Nanoseconds on the host clock every timestamp here is reported on.
fn clock_ns() -> u64 {
    epoch().elapsed().as_nanos() as u64
}

thread_local! {
    static LAST_ERROR: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn set_error(message: impl Into<String>) {
    LAST_ERROR.with(|cell| *cell.borrow_mut() = message.into());
}

/// State shared between the caller and the audio callback (all atomics).
struct Shared {
    ring: Ring,
    /// Caller-side channels and rate (ring layout).
    channels: usize,
    rate: u32,
    device_rate: u32,
    device_channels: usize,
    buffer_frames: AtomicU64,
    /// Output: ring frames played; input: ring frames captured.
    frames: AtomicU64,
    /// Output: times the ring ran dry after being fed; input: frames dropped on a full ring.
    xruns: AtomicU64,
    /// Device latency (output: callback to playback; input: capture to callback).
    latency_ns: AtomicU64,
    /// Host clock at the most recent callback.
    callback_ns: AtomicU64,
    /// Host clock the first frame of that callback is played (or was captured) at.
    edge_ns: AtomicU64,
    /// `frames` at the start of that callback.
    frames_at_edge: AtomicU64,
    /// Output: written to since the ring last ran dry.
    primed: AtomicBool,
    failed: AtomicBool,
}

impl Shared {
    fn new(
        channels: usize,
        rate: u32,
        device_rate: u32,
        device_channels: usize,
        ring_frames: usize,
    ) -> Shared {
        Shared {
            ring: Ring::new(ring_frames.max(64) * channels),
            channels,
            rate,
            device_rate,
            device_channels,
            buffer_frames: AtomicU64::new(0),
            frames: AtomicU64::new(0),
            xruns: AtomicU64::new(0),
            latency_ns: AtomicU64::new(0),
            callback_ns: AtomicU64::new(0),
            edge_ns: AtomicU64::new(0),
            frames_at_edge: AtomicU64::new(0),
            primed: AtomicBool::new(false),
            failed: AtomicBool::new(false),
        }
    }

    fn mark(&self, callback_ns: u64, latency_ns: u64, output: bool, device_frames: usize) {
        self.callback_ns.store(callback_ns, Ordering::Relaxed);
        self.latency_ns.store(latency_ns, Ordering::Relaxed);
        self.buffer_frames.store(device_frames as u64, Ordering::Relaxed);
        let edge = if output { callback_ns + latency_ns } else { callback_ns.saturating_sub(latency_ns) };
        self.edge_ns.store(edge, Ordering::Relaxed);
        self.frames_at_edge.store(self.frames.load(Ordering::Relaxed), Ordering::Relaxed);
    }

    fn stats(&self, out: &mut [u64; STAT_COUNT]) {
        *out = [
            (self.ring.len() / self.channels) as u64,
            self.frames.load(Ordering::Acquire),
            self.xruns.load(Ordering::Acquire),
            self.latency_ns.load(Ordering::Acquire),
            self.callback_ns.load(Ordering::Acquire),
            self.edge_ns.load(Ordering::Acquire),
            self.frames_at_edge.load(Ordering::Acquire),
            self.buffer_frames.load(Ordering::Acquire),
            self.rate as u64,
            self.channels as u64,
            self.device_rate as u64,
            self.failed.load(Ordering::Acquire) as u64,
        ];
    }
}

/// Rate conversion state for one direction: the last four source frames.
struct Converter {
    step: f64,
    phase: f64,
    history: [Vec<f32>; 4],
    scratch: Vec<f32>,
    /// One caller-layout frame, reused so callbacks never allocate.
    frame: Vec<f32>,
}

impl Converter {
    fn new(from: u32, to: u32, channels: usize) -> Converter {
        Converter {
            step: from as f64 / to as f64,
            phase: 0.0,
            history: std::array::from_fn(|_| vec![0.0; channels]),
            scratch: vec![0.0; channels],
            frame: vec![0.0; channels],
        }
    }

    fn passthrough(&self) -> bool {
        self.step == 1.0
    }

    /// Advance one source frame into the history.
    fn shift(&mut self, frame: &[f32]) {
        self.history.rotate_left(1);
        self.history[3].copy_from_slice(frame);
    }

    /// Interpolate between history[1] and history[2] at `phase`.
    fn sample(&self, channel: usize) -> f32 {
        let t = self.phase as f32;
        let [y0, y1, y2, y3] = [0, 1, 2, 3].map(|i| self.history[i][channel]);
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * t + c2) * t + c1) * t + y1
    }
}

/// Output callback body: fill `out` (device layout) from the ring.
fn render(shared: &Shared, conv: &mut Converter, out: &mut [f32]) {
    let dch = shared.device_channels;
    let sch = shared.channels;
    let frames = out.len() / dch;
    let mut short = false;
    let mut frame = std::mem::take(&mut conv.frame);
    for index in 0..frames {
        if conv.passthrough() {
            if shared.ring.pop(&mut frame) < sch {
                frame.iter_mut().for_each(|v| *v = 0.0);
                short = true;
            } else {
                shared.frames.fetch_add(1, Ordering::Relaxed);
            }
            conv.scratch.copy_from_slice(&frame);
        } else {
            while conv.phase >= 1.0 {
                conv.phase -= 1.0;
                if shared.ring.pop(&mut frame) < sch {
                    frame.iter_mut().for_each(|v| *v = 0.0);
                    short = true;
                } else {
                    shared.frames.fetch_add(1, Ordering::Relaxed);
                }
                conv.shift(&frame);
            }
            for channel in 0..sch {
                conv.scratch[channel] = conv.sample(channel);
            }
            conv.phase += conv.step;
        }
        let slot = &mut out[index * dch..(index + 1) * dch];
        spread(&conv.scratch, slot);
    }
    conv.frame = frame;
    // One underrun per starvation: the ring ran dry after a write fed it.
    if short && shared.primed.swap(false, Ordering::AcqRel) {
        shared.xruns.fetch_add(1, Ordering::Relaxed);
    }
}

/// Map caller channels onto device channels (mono sums, extras stay silent).
fn spread(from: &[f32], to: &mut [f32]) {
    match (from.len(), to.len()) {
        (a, b) if a == b => to.copy_from_slice(from),
        (_, 1) => to[0] = from.iter().sum::<f32>() / from.len() as f32,
        (1, _) => to.iter_mut().for_each(|v| *v = from[0]),
        (a, _) => {
            to.iter_mut().for_each(|v| *v = 0.0);
            let n = a.min(to.len());
            to[..n].copy_from_slice(&from[..n]);
        }
    }
}

/// Input callback body: push `data` (device layout) into the ring.
fn capture(shared: &Shared, conv: &mut Converter, data: &[f32]) {
    let dch = shared.device_channels;
    let sch = shared.channels;
    let mut frame = std::mem::take(&mut conv.frame);
    let mut scratch = std::mem::take(&mut conv.scratch);
    for device_frame in data.chunks(dch) {
        spread(device_frame, &mut frame);
        let emit = |frame: &[f32]| {
            if shared.ring.push(frame) < sch {
                shared.xruns.fetch_add(1, Ordering::Relaxed);
            } else {
                shared.frames.fetch_add(1, Ordering::Relaxed);
            }
        };
        if conv.passthrough() {
            emit(&frame);
            continue;
        }
        conv.shift(&frame);
        while conv.phase < 1.0 {
            for (channel, value) in scratch.iter_mut().enumerate() {
                *value = conv.sample(channel);
            }
            emit(&scratch);
            conv.phase += conv.step;
        }
        conv.phase -= 1.0;
    }
    conv.frame = frame;
    conv.scratch = scratch;
}

/// An open output or input: the shared ring plus whatever drives it.
pub struct Endpoint {
    shared: Arc<Shared>,
    _stream: Option<cpal::Stream>,
    null: Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>,
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        if let Some((stop, handle)) = self.null.take() {
            stop.store(true, Ordering::Release);
            let _ = handle.join();
        }
    }
}

fn device_name(device: &cpal::Device) -> String {
    device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| device.to_string())
}

fn find_device(host: &cpal::Host, name: Option<&str>, output: bool) -> Result<cpal::Device, String> {
    let default = if output { host.default_output_device() } else { host.default_input_device() };
    let Some(name) = name.filter(|n| !n.is_empty() && *n != "default") else {
        return default.ok_or_else(|| "no default device".to_string());
    };
    let devices =
        if output { host.output_devices() } else { host.input_devices() }.map_err(|e| e.to_string())?;
    for device in devices {
        if device_name(&device) == name {
            return Ok(device);
        }
    }
    Err(format!("no device named {name}"))
}

struct Request {
    device: Option<String>,
    rate: u32,
    channels: usize,
    buffer_frames: u32,
    ring_frames: usize,
    output: bool,
}

fn open(request: Request) -> Result<Endpoint, String> {
    if request.rate == 0 || request.channels == 0 || request.channels > 32 {
        return Err("invalid rate or channels".into());
    }
    epoch();
    if request.device.as_deref() == Some("null") {
        return Ok(open_null(request));
    }
    let host = cpal::default_host();
    let device = find_device(&host, request.device.as_deref(), request.output)?;
    let supported =
        if request.output { device.default_output_config() } else { device.default_input_config() }
            .map_err(|e| e.to_string())?;
    let device_rate = supported.sample_rate();
    let device_channels = supported.channels() as usize;
    let buffer = match (supported.buffer_size(), request.buffer_frames) {
        (_, 0) => cpal::BufferSize::Default,
        (cpal::SupportedBufferSize::Range { min, max }, n) => cpal::BufferSize::Fixed(n.clamp(*min, *max)),
        (cpal::SupportedBufferSize::Unknown, n) => cpal::BufferSize::Fixed(n),
    };
    let config =
        cpal::StreamConfig { channels: supported.channels(), sample_rate: device_rate, buffer_size: buffer };
    let shared = Arc::new(Shared::new(
        request.channels,
        request.rate,
        device_rate,
        device_channels,
        request.ring_frames,
    ));
    let format = supported.sample_format();
    let stream = if request.output {
        build_output(&device, &config, format, &shared)
    } else {
        build_input(&device, &config, format, &shared)
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Endpoint { shared, _stream: Some(stream), null: None })
}

fn on_error(shared: &Arc<Shared>) -> impl FnMut(cpal::Error) + Send + 'static {
    let shared = Arc::clone(shared);
    move |_| shared.failed.store(true, Ordering::Release)
}

fn build_output(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: cpal::SampleFormat,
    shared: &Arc<Shared>,
) -> Result<cpal::Stream, cpal::Error> {
    macro_rules! typed {
        ($t:ty) => {{
            let state = Arc::clone(shared);
            let mut conv = Converter::new(state.rate, state.device_rate, state.channels);
            let mut buffer: Vec<f32> = Vec::new();
            device.build_output_stream::<$t, _, _>(
                config.clone(),
                move |out: &mut [$t], info: &cpal::OutputCallbackInfo| {
                    let stamp = info.timestamp();
                    let latency = stamp.playback.saturating_duration_since(stamp.callback);
                    state.mark(
                        clock_ns(),
                        latency.as_nanos() as u64,
                        true,
                        out.len() / state.device_channels,
                    );
                    buffer.resize(out.len(), 0.0);
                    render(&state, &mut conv, &mut buffer);
                    for (slot, value) in out.iter_mut().zip(buffer.iter()) {
                        *slot = <$t as cpal::FromSample<f32>>::from_sample_(*value);
                    }
                },
                on_error(shared),
                None,
            )
        }};
    }
    match format {
        cpal::SampleFormat::F32 => typed!(f32),
        cpal::SampleFormat::I16 => typed!(i16),
        cpal::SampleFormat::I32 => typed!(i32),
        cpal::SampleFormat::U16 => typed!(u16),
        other => Err(cpal::Error::with_message(
            cpal::ErrorKind::UnsupportedConfig,
            format!("sample format {other}"),
        )),
    }
}

fn build_input(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: cpal::SampleFormat,
    shared: &Arc<Shared>,
) -> Result<cpal::Stream, cpal::Error> {
    macro_rules! typed {
        ($t:ty) => {{
            let state = Arc::clone(shared);
            let mut conv = Converter::new(state.device_rate, state.rate, state.channels);
            let mut buffer: Vec<f32> = Vec::new();
            device.build_input_stream::<$t, _, _>(
                config.clone(),
                move |data: &[$t], info: &cpal::InputCallbackInfo| {
                    let stamp = info.timestamp();
                    let latency = stamp.callback.saturating_duration_since(stamp.capture);
                    state.mark(
                        clock_ns(),
                        latency.as_nanos() as u64,
                        false,
                        data.len() / state.device_channels,
                    );
                    buffer.clear();
                    buffer.extend(data.iter().map(|v| <f32 as cpal::FromSample<$t>>::from_sample_(*v)));
                    capture(&state, &mut conv, &buffer);
                },
                on_error(shared),
                None,
            )
        }};
    }
    match format {
        cpal::SampleFormat::F32 => typed!(f32),
        cpal::SampleFormat::I16 => typed!(i16),
        cpal::SampleFormat::I32 => typed!(i32),
        cpal::SampleFormat::U16 => typed!(u16),
        other => Err(cpal::Error::with_message(
            cpal::ErrorKind::UnsupportedConfig,
            format!("sample format {other}"),
        )),
    }
}

/// A headless device: drains (output) or fills with silence (input) in real time.
fn open_null(request: Request) -> Endpoint {
    let channels = request.channels;
    let shared = Arc::new(Shared::new(channels, request.rate, request.rate, channels, request.ring_frames));
    let period = if request.buffer_frames == 0 { 256 } else { request.buffer_frames } as usize;
    let stop = Arc::new(AtomicBool::new(false));
    let handle = {
        let shared = Arc::clone(&shared);
        let stop = Arc::clone(&stop);
        let output = request.output;
        std::thread::spawn(move || {
            let mut conv = Converter::new(shared.rate, shared.rate, channels);
            let mut buffer = vec![0.0f32; period * channels];
            let tick = Duration::from_secs_f64(period as f64 / shared.rate as f64);
            let latency = tick.as_nanos() as u64;
            let start = Instant::now();
            let mut n = 0u32;
            while !stop.load(Ordering::Acquire) {
                shared.mark(clock_ns(), latency, output, period);
                if output {
                    render(&shared, &mut conv, &mut buffer);
                } else {
                    buffer.iter_mut().for_each(|v| *v = 0.0);
                    capture(&shared, &mut conv, &buffer);
                }
                n += 1;
                if let Some(wait) = (start + tick * n).checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
            }
        })
    };
    Endpoint { shared, _stream: None, null: Some((stop, handle)) }
}

// ---------------------------------------------------------------- C ABI ---

unsafe fn opt_str<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr) }.to_str().ok()
}

fn open_raw(request: Request) -> *mut Endpoint {
    match std::panic::catch_unwind(|| open(request)) {
        Ok(Ok(endpoint)) => Box::into_raw(Box::new(endpoint)),
        Ok(Err(message)) => {
            set_error(message);
            std::ptr::null_mut()
        }
        Err(_) => {
            set_error("panic while opening the device");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn dawg_sink_abi_version() -> u32 {
    ABI_VERSION
}

/// Host clock in nanoseconds; every `*_ns` stat is on this clock.
#[no_mangle]
pub extern "C" fn dawg_sink_clock_ns() -> u64 {
    clock_ns()
}

/// Copy the last error of this thread into `out` (NUL-terminated); returns its full length.
///
/// # Safety
/// `out` must be valid for `len` bytes or null.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_last_error(out: *mut u8, len: usize) -> usize {
    LAST_ERROR.with(|cell| unsafe { copy_out(cell.borrow().as_bytes(), out, len) })
}

unsafe fn copy_out(bytes: &[u8], out: *mut u8, len: usize) -> usize {
    if !out.is_null() && len > 0 {
        let n = bytes.len().min(len - 1);
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n);
            *out.add(n) = 0;
        }
    }
    bytes.len()
}

/// List devices as lines `name\tdefault(0|1)\tchannels\trate`; `input` 0 lists outputs.
/// Returns the full byte length (call again with a larger buffer if it exceeds `len`).
///
/// # Safety
/// `out` must be valid for `len` bytes or null.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_devices(input: i32, out: *mut u8, len: usize) -> usize {
    let text = std::panic::catch_unwind(|| list_devices(input != 0)).unwrap_or_default();
    unsafe { copy_out(text.as_bytes(), out, len) }
}

fn list_devices(input: bool) -> String {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock();
    let host = cpal::default_host();
    let default = if input { host.default_input_device() } else { host.default_output_device() }
        .map(|d| device_name(&d));
    let Ok(devices) = (if input { host.input_devices() } else { host.output_devices() }) else {
        return String::new();
    };
    let mut text = String::new();
    for device in devices {
        let name = device_name(&device).replace(['\t', '\n'], " ");
        let config = if input { device.default_input_config() } else { device.default_output_config() };
        let (channels, rate) = config.map(|c| (c.channels(), c.sample_rate())).unwrap_or((0, 0));
        let is_default = default.as_deref() == Some(name.as_str());
        text.push_str(&format!("{name}\t{}\t{channels}\t{rate}\n", is_default as u8));
    }
    text
}

/// Open an output. `device` null or "default" picks the default; "null" is headless.
/// `buffer_frames` 0 keeps the device default. Returns null on failure (see last_error).
///
/// # Safety
/// `device` must be a NUL-terminated string or null.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_open(
    device: *const c_char,
    rate: u32,
    channels: u32,
    buffer_frames: u32,
    ring_frames: u32,
) -> *mut Endpoint {
    let device = unsafe { opt_str(device) }.map(str::to_string);
    open_raw(Request {
        device,
        rate,
        channels: channels as usize,
        buffer_frames,
        ring_frames: ring_frames as usize,
        output: true,
    })
}

/// Open an input capture into a ring of `ring_frames`. Same conventions as `dawg_sink_open`.
///
/// # Safety
/// `device` must be a NUL-terminated string or null.
#[no_mangle]
pub unsafe extern "C" fn dawg_capture_open(
    device: *const c_char,
    rate: u32,
    channels: u32,
    buffer_frames: u32,
    ring_frames: u32,
) -> *mut Endpoint {
    let device = unsafe { opt_str(device) }.map(str::to_string);
    open_raw(Request {
        device,
        rate,
        channels: channels as usize,
        buffer_frames,
        ring_frames: ring_frames as usize,
        output: false,
    })
}

/// Queue interleaved samples; returns how many were accepted (whole frames only).
///
/// # Safety
/// `sink` must come from `dawg_sink_open`; `samples` valid for `count` floats.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_write(sink: *mut Endpoint, samples: *const f32, count: usize) -> usize {
    let Some(sink) = (unsafe { sink.as_ref() }) else {
        return 0;
    };
    if samples.is_null() {
        return 0;
    }
    let shared = &sink.shared;
    let free = (shared.ring.capacity() - shared.ring.len()) / shared.channels * shared.channels;
    let whole = count / shared.channels * shared.channels;
    let data = unsafe { std::slice::from_raw_parts(samples, whole.min(free)) };
    let taken = shared.ring.push(data);
    if taken > 0 {
        shared.primed.store(true, Ordering::Release);
    }
    taken
}

/// Read up to `count` captured samples (whole frames); returns how many were read.
///
/// # Safety
/// `capture` must come from `dawg_capture_open`; `out` valid for `count` floats.
#[no_mangle]
pub unsafe extern "C" fn dawg_capture_read(capture: *mut Endpoint, out: *mut f32, count: usize) -> usize {
    let Some(capture) = (unsafe { capture.as_ref() }) else {
        return 0;
    };
    if out.is_null() {
        return 0;
    }
    let ch = capture.shared.channels;
    let out = unsafe { std::slice::from_raw_parts_mut(out, count / ch * ch) };
    capture.shared.ring.pop(out)
}

/// Write `STAT_COUNT` u64 stats into `out`: queued frames, frames played or
/// captured, underruns or overruns, device latency ns, last callback ns, the
/// host time its first frame plays or was captured, frames at that edge,
/// device buffer frames, rate, channels, device rate, failed flag.
///
/// # Safety
/// `endpoint` from an open call; `out` valid for `STAT_COUNT` u64s.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_stats(endpoint: *mut Endpoint, out: *mut u64) -> i32 {
    let (Some(endpoint), false) = (unsafe { endpoint.as_ref() }, out.is_null()) else {
        return -1;
    };
    let out = unsafe { &mut *(out as *mut [u64; STAT_COUNT]) };
    endpoint.shared.stats(out);
    0
}

/// Drop everything queued (output) or captured but unread (input); returns frames dropped.
///
/// # Safety
/// `endpoint` from an open call.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_clear(endpoint: *mut Endpoint) -> u64 {
    let Some(endpoint) = (unsafe { endpoint.as_ref() }) else {
        return 0;
    };
    (endpoint.shared.ring.clear() / endpoint.shared.channels) as u64
}

/// Stop and free an output or input.
///
/// # Safety
/// `endpoint` from an open call, not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn dawg_sink_close(endpoint: *mut Endpoint) {
    if !endpoint.is_null() {
        drop(unsafe { Box::from_raw(endpoint) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_output_drains_in_real_time() {
        let sink = unsafe { dawg_sink_open(c"null".as_ptr(), 48_000, 2, 128, 48_000) };
        assert!(!sink.is_null());
        let samples = vec![0.25f32; 4_800 * 2];
        assert_eq!(unsafe { dawg_sink_write(sink, samples.as_ptr(), samples.len()) }, samples.len());
        std::thread::sleep(Duration::from_millis(60));
        let mut stats = [0u64; STAT_COUNT];
        assert_eq!(unsafe { dawg_sink_stats(sink, stats.as_mut_ptr()) }, 0);
        assert!(stats[1] > 0 && stats[1] < 4_800, "played {}", stats[1]);
        assert_eq!(stats[0] + stats[1], 4_800);
        assert_eq!(stats[8], 48_000);
        unsafe { dawg_sink_close(sink) };
    }

    #[test]
    fn null_capture_fills_ring() {
        let cap = unsafe { dawg_capture_open(c"null".as_ptr(), 22_050, 1, 64, 22_050) };
        assert!(!cap.is_null());
        std::thread::sleep(Duration::from_millis(30));
        let mut out = vec![1.0f32; 4096];
        let got = unsafe { dawg_capture_read(cap, out.as_mut_ptr(), out.len()) };
        assert!(got > 0);
        assert!(out[..got].iter().all(|v| *v == 0.0));
        unsafe { dawg_sink_close(cap) };
    }

    #[test]
    fn invalid_open_reports_error() {
        let sink = unsafe { dawg_sink_open(c"null".as_ptr(), 0, 2, 0, 0) };
        assert!(sink.is_null());
        let mut buf = [0u8; 64];
        let n = unsafe { dawg_sink_last_error(buf.as_mut_ptr(), buf.len()) };
        assert!(n > 0);
    }

    #[test]
    fn converter_passthrough_is_exact() {
        let shared = Shared::new(2, 22_050, 22_050, 2, 64);
        let input: Vec<f32> = (0..32).map(|i| (i as f32 - 16.0) / 32768.0).collect();
        shared.ring.push(&input);
        let mut conv = Converter::new(22_050, 22_050, 2);
        let mut out = vec![0.0f32; 32];
        render(&shared, &mut conv, &mut out);
        assert_eq!(out, input);
    }

    #[test]
    fn converter_upsamples_constant_signal_exactly() {
        let shared = Shared::new(1, 24_000, 48_000, 1, 256);
        shared.ring.push(&[0.5f32; 64]);
        let mut conv = Converter::new(24_000, 48_000, 1);
        let mut out = vec![0.0f32; 100];
        render(&shared, &mut conv, &mut out);
        // After the 4-frame history fills, a constant stays constant.
        assert!(out[8..].iter().all(|v| (*v - 0.5).abs() < 1e-6));
    }
}
