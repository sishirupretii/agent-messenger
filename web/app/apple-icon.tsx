import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            display: "flex",
            position: "relative",
            width: 110,
            height: 92,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 70,
              height: 46,
              border: "6px solid #5b8def",
              borderRadius: 14,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 76,
              height: 54,
              background:
                "linear-gradient(135deg, #5b8def 0%, #8b5cf6 100%)",
              borderRadius: 14,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
