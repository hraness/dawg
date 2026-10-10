//! A lock-free single-producer single-consumer ring of `f32` samples.
//!
//! Samples are stored as `AtomicU32` bit patterns, so the ring needs no
//! `unsafe`: each slot is written by the producer before `tail` is published
//! with `Release`, and read by the consumer after it loads `tail` with
//! `Acquire`. `head` and `tail` count samples monotonically (they never
//! wrap in practice: 2^64 samples is millions of years of audio).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub struct Ring {
    slots: Box<[AtomicU32]>,
    mask: u64,
    /// Samples consumed so far (written only by the consumer).
    head: AtomicU64,
    /// Samples produced so far (written only by the producer).
    tail: AtomicU64,
}

impl Ring {
    /// A ring holding at least `capacity` samples (rounded up to a power of two).
    pub fn new(capacity: usize) -> Ring {
        let size = capacity.max(2).next_power_of_two();
        let slots = (0..size).map(|_| AtomicU32::new(0)).collect();
        Ring { slots, mask: (size - 1) as u64, head: AtomicU64::new(0), tail: AtomicU64::new(0) }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Samples readable now.
    pub fn len(&self) -> usize {
        let tail = self.tail.load(Ordering::Acquire);
        let head = self.head.load(Ordering::Acquire);
        (tail - head) as usize
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Producer: push as many samples as fit; returns how many were taken.
    pub fn push(&self, samples: &[f32]) -> usize {
        self.push_with(samples.len(), |index| samples[index])
    }

    /// Producer: push `count` samples produced by `sample(i)`; returns how many fit.
    pub fn push_with(&self, count: usize, mut sample: impl FnMut(usize) -> f32) -> usize {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        let free = self.slots.len() - (tail - head) as usize;
        let take = count.min(free);
        for index in 0..take {
            let slot = ((tail + index as u64) & self.mask) as usize;
            self.slots[slot].store(sample(index).to_bits(), Ordering::Relaxed);
        }
        self.tail.store(tail + take as u64, Ordering::Release);
        take
    }

    /// Consumer: pop up to `out.len()` samples; returns how many were read.
    pub fn pop(&self, out: &mut [f32]) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        let take = out.len().min((tail - head) as usize);
        for (index, value) in out.iter_mut().take(take).enumerate() {
            let slot = ((head + index as u64) & self.mask) as usize;
            *value = f32::from_bits(self.slots[slot].load(Ordering::Relaxed));
        }
        self.head.store(head + take as u64, Ordering::Release);
        take
    }

    /// Consumer: drop everything queued; returns how many samples were dropped.
    pub fn clear(&self) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        self.head.store(tail, Ordering::Release);
        (tail - head) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::Ring;
    use std::sync::Arc;

    #[test]
    fn rounds_capacity_to_power_of_two() {
        assert_eq!(Ring::new(1000).capacity(), 1024);
        assert_eq!(Ring::new(0).capacity(), 2);
    }

    #[test]
    fn push_pop_round_trips_and_wraps() {
        let ring = Ring::new(8);
        let mut out = [0.0f32; 8];
        for round in 0..10 {
            let base = round as f32 * 10.0;
            let input = [base, base + 1.0, base + 2.0, base + 3.0, base + 4.0];
            assert_eq!(ring.push(&input), 5);
            assert_eq!(ring.len(), 5);
            assert_eq!(ring.pop(&mut out), 5);
            assert_eq!(&out[..5], &input);
            assert!(ring.is_empty());
        }
    }

    #[test]
    fn push_stops_when_full_and_pop_when_empty() {
        let ring = Ring::new(4);
        assert_eq!(ring.push(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), 4);
        assert_eq!(ring.push(&[7.0]), 0);
        let mut out = [0.0f32; 6];
        assert_eq!(ring.pop(&mut out), 4);
        assert_eq!(&out[..4], &[1.0, 2.0, 3.0, 4.0]);
        assert_eq!(ring.pop(&mut out), 0);
    }

    #[test]
    fn preserves_exact_bits() {
        let ring = Ring::new(4);
        let values = [f32::MIN_POSITIVE, -0.0, 1.0 / 3.0, f32::MAX];
        ring.push(&values);
        let mut out = [0.0f32; 4];
        ring.pop(&mut out);
        for (a, b) in values.iter().zip(out.iter()) {
            assert_eq!(a.to_bits(), b.to_bits());
        }
    }

    #[test]
    fn clear_drops_queued() {
        let ring = Ring::new(8);
        ring.push(&[1.0; 6]);
        assert_eq!(ring.clear(), 6);
        assert!(ring.is_empty());
        assert_eq!(ring.push(&[2.0; 8]), 8);
    }

    #[test]
    fn concurrent_producer_consumer_keeps_order() {
        const TOTAL: usize = 200_000;
        let ring = Arc::new(Ring::new(256));
        let producer = {
            let ring = Arc::clone(&ring);
            std::thread::spawn(move || {
                let mut next = 0usize;
                while next < TOTAL {
                    let chunk = (TOTAL - next).min(37);
                    let start = next;
                    next += ring.push_with(chunk, |i| (start + i) as f32);
                    std::hint::spin_loop();
                }
            })
        };
        let mut expected = 0usize;
        let mut buffer = [0.0f32; 53];
        while expected < TOTAL {
            let got = ring.pop(&mut buffer);
            for value in &buffer[..got] {
                assert_eq!(*value, expected as f32);
                expected += 1;
            }
            std::hint::spin_loop();
        }
        producer.join().unwrap();
        assert!(ring.is_empty());
    }
}
