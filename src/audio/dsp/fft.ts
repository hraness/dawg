/**
 * The shared radix-2 FFT: a re-export of the convolution reverb's
 * `fftInPlace` (cached tables; `inverse` uses e^{+i} and no scaling).
 * Lanes that need windows or STFTs build them on this one transform.
 */
export { fftInPlace } from "../effects/convolution.ts";
