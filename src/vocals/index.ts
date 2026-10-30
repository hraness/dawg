/** Installed, project-local stock singing. Importing this module does no inference. */
export {
  VOCAL_VOICE,
  VOCAL_MODEL,
  VOCAL_LIMITS,
  VocalError,
  VocalCancelledError,
  parseVocalBookSpec,
  type VocalNote,
  type VocalSettings,
  type VocalPart,
  type VocalBookSpec,
} from "./spec.ts";
export {
  VOCAL_HELPER,
  VOCAL_REQUIREMENTS,
  discoverVocalBackend,
  vocalBackendSetup,
  probeVocalBackend,
  type VocalBackend,
  type VocalBackendOptions,
  type VocalBackendDiscovery,
  type VocalProgress,
  type VocalProcessOptions,
} from "./backend.ts";
export {
  generateVocalBook,
  vocalHelperIdentity,
  type LocalVocalBook,
  type AcceptedVocalBook,
  type GenerateVocalBookOptions,
  type VocalProvenance,
  type VocalSlice,
} from "./store.ts";
export { vocalBookForChart } from "./chart.ts";
