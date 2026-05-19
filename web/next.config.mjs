/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
      layers: true,
    };
    return config;
  },
  // Allow the embed widget to be iframe'd from any origin
  // (gitlawb Playground apps, partner dashboards, blog embeds).
  // Everything else stays SAMEORIGIN by default.
  async headers() {
    return [
      {
        source: "/agent/:address/embed",
        headers: [
          // CSP frame-ancestors is the modern, browser-honored way to
          // permit cross-origin iframing. X-Frame-Options has no
          // standard ALLOWALL value — we just omit it here so it
          // doesn't override CSP.
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
