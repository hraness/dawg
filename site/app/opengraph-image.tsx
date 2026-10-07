import { productMessaging } from "./messaging";
import { socialImageFor } from "./social";

export { contentType, size } from "./social";
export const alt = `dawg: ${productMessaging.tagline}`;

export default function OpengraphImage() {
  return socialImageFor();
}
