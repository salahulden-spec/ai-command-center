import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon. Generated rather than checked in as a PNG because iOS
 * ignores SVG for `apple-touch-icon`, so the shared public/icon.svg can't
 * serve double duty here.
 *
 * ImageResponse only supports a flexbox subset of CSS — no SVG filters — so
 * the glow is layered box-shadows instead.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #12203a 0%, #070b14 100%)",
        }}
      >
        <div
          style={{
            width: 108,
            height: 108,
            borderRadius: "50%",
            border: "8px solid #4fd8ef",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 28px 4px rgba(79,216,239,0.55)",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "#7ff0ff",
              boxShadow: "0 0 22px 6px rgba(127,240,255,0.7)",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
