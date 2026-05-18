import type { MetadataRoute } from "next";

const base = "https://agent-messenger.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/feed`, lastModified: now, changeFrequency: "hourly", priority: 0.95 },
    { url: `${base}/directory`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/ecosystem`, lastModified: now, changeFrequency: "weekly", priority: 0.85 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];
}
