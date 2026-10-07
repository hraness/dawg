import { MarketingSiteHeader } from "@hraness/design-kit/react/server";
import { ThemeMenuButton } from "@hraness/design-kit/react";

import { productName, repoUrl } from "./messaging";

export function SiteHeader({
  active,
}: Readonly<{ active?: "home" | "docs" | "changelog" }>) {
  return (
    <div data-hraness-marketing-preset="minimal" className="dawg-header">
      <a className="dawg-skip" href="#main">
        Skip to content
      </a>
      <MarketingSiteHeader
        ariaLabel="Primary"
        brand={productName}
        brandMark="/marks/dawg.svg"
        brandLabel={`${productName} home`}
        links={[
          { href: "/docs", label: "Docs", current: active === "docs" },
          {
            href: "/changelog",
            label: "Changelog",
            current: active === "changelog",
          },
          { href: repoUrl, label: "GitHub ↗" },
        ]}
        action={{ href: "/#install", label: "Install", emphasis: "secondary" }}
        trailing={<ThemeMenuButton aria-label="Appearance" />}
      />
    </div>
  );
}
