/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // @libsql/client ships native bindings; bundling it breaks the server
    // build, so it must stay an external require at runtime.
    serverComponentsExternalPackages: ["@libsql/client"],
  },
};

export default nextConfig;
