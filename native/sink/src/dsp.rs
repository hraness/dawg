//! Bulk float64 DSP, separately versioned from the audio device ABI.
//! Arithmetic order matches the TypeScript reference; no fast-math/FMA.

struct Delay {
    buffer: Vec<f64>,
    index: usize,
    store: f64,
    feedback: f64,
}

#[no_mangle]
pub extern "C" fn dawg_dsp_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn dawg_dsp_capabilities() -> u32 {
    1
}

/// Eight damped combs and four allpasses per side. Caller owns every array.
///
/// # Safety
/// `input`, `left`, and `right` address `frames` doubles, with distinct
/// output storage. `lengths` has 24 entries; `gains` has 16. All pointers
/// must remain valid until return. 1 means success, 0 rejects parameters.
#[no_mangle]
pub unsafe extern "C" fn dawg_dsp_reverb_f64(
    input: *const f64,
    left: *mut f64,
    right: *mut f64,
    frames: usize,
    lengths: *const u32,
    gains: *const f64,
    damp: f64,
) -> i32 {
    if frames == 0 {
        return 1;
    }
    if frames > 64_000_000
        || input.is_null()
        || left.is_null()
        || right.is_null()
        || lengths.is_null()
        || gains.is_null()
        || !damp.is_finite()
        || !(0.0..=1.0).contains(&damp)
    {
        return 0;
    }
    let lengths = unsafe { std::slice::from_raw_parts(lengths, 24) };
    let gains = unsafe { std::slice::from_raw_parts(gains, 16) };
    if lengths.iter().any(|&n| n == 0 || n > 192_000)
        || gains.iter().any(|&v| !v.is_finite() || !(0.0..1.0).contains(&v))
    {
        return 0;
    }
    let input = unsafe { std::slice::from_raw_parts(input, frames) };
    for (side, output) in [left, right].into_iter().enumerate() {
        let output = unsafe { std::slice::from_raw_parts_mut(output, frames) };
        let mut delays: Vec<Delay> = (0..12)
            .map(|j| Delay {
                buffer: vec![0.0; lengths[side * 12 + j] as usize],
                index: 0,
                store: 0.0,
                feedback: if j < 8 { gains[side * 8 + j] } else { 0.5 },
            })
            .collect();
        for (i, &sample) in input.iter().enumerate() {
            let mut value = 0.0;
            for comb in &mut delays[..8] {
                let delayed = comb.buffer[comb.index];
                comb.store = delayed * (1.0 - damp) + comb.store * damp;
                comb.buffer[comb.index] = sample + comb.store * comb.feedback;
                comb.index = if comb.index + 1 == comb.buffer.len() { 0 } else { comb.index + 1 };
                value += delayed;
            }
            for allpass in &mut delays[8..] {
                let delayed = allpass.buffer[allpass.index];
                allpass.buffer[allpass.index] = value + delayed * 0.5;
                value = delayed - value;
                allpass.index = if allpass.index + 1 == allpass.buffer.len() { 0 } else { allpass.index + 1 };
            }
            output[i] = value;
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_empty_and_stereo() {
        let (mut left, mut right) = (vec![0.0; 128], vec![0.0; 128]);
        let mut input = vec![0.0; 128];
        input[0] = 1.0;
        let mut lengths = [1_u32; 24];
        lengths[12..].fill(2);
        let gains = [0.8; 16];
        let run = |left: &mut [f64], right: &mut [f64], lengths: &[u32]| unsafe {
            dawg_dsp_reverb_f64(
                input.as_ptr(),
                left.as_mut_ptr(),
                right.as_mut_ptr(),
                128,
                lengths.as_ptr(),
                gains.as_ptr(),
                0.4,
            )
        };
        assert_eq!(run(&mut left, &mut right, &lengths), 1);
        assert_eq!(left[1], 8.0);
        assert_eq!(right[1], 0.0);
        assert_eq!(right[2], 8.0);
        assert!(left.iter().chain(&right).all(|x| x.is_finite()));
        lengths[0] = 0;
        assert_eq!(run(&mut left, &mut right, &lengths), 0);
        assert_eq!(
            unsafe {
                dawg_dsp_reverb_f64(
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                    0.4,
                )
            },
            1
        );
    }
}
