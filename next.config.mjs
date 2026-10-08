/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright-core"],
  // playwright-core reads browsers.json/package.json by computed path, which file tracing misses on Vercel.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/playwright-core/**/*", "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
