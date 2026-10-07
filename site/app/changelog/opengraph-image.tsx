import { socialImageFor } from "../social";

export { contentType, size } from "../social";
export const alt = "dawg changelog";

export default function ChangelogOpengraphImage() {
  return socialImageFor({
    path: "/changelog",
    eyebrow: "Changelog",
    headline: "What changed in dawg",
    description:
      "Every release of the terminal music workstation, from CHANGELOG.md.",
  });
}
