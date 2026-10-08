import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSocialImageResponse,
  defineSocialImageSite,
  socialImageSiteDetails,
  type SocialImagePage,
} from "@hraness/web-discovery/social-image";

import { productDomain, productMessaging, productName } from "./messaging";

export {
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";

const markSvg = readFileSync(
  join(process.cwd(), "public", "marks", "dawg.svg"),
  "utf8",
);

export const socialSite = defineSocialImageSite({
  brand: productName,
  brandMark: markSvg,
  description: productMessaging.tagline,
  domain: productDomain,
  name: productName,
  palette: "paper",
});

/** Share cards; `strict` fails the build when copy would be cut or shrunk. */
export function socialImageFor(page?: SocialImagePage) {
  return createSocialImageResponse({
    ...socialImageSiteDetails(socialSite, page),
    strict: true,
  });
}
