import type { NextConfig } from "next";

/**
 * The whole app runs in the browser - no API routes, no server rendering of
 * anything that changes - so it is exported as plain static files. That keeps
 * the host dumb: any static CDN can serve it, with no Next.js runtime, no
 * functions and no cold starts.
 */
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
