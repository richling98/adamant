/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disabled for BlockNote compatibility
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Add basePath configuration
  basePath: '',
  assetPrefix: '/',

  // Add webpack configuration for Tauri
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },

  // Turbopack configuration (Next.js 16+)
  // root: pin to the frontend directory so Turbopack doesn't get confused by
  // the package-lock.json at ~/package-lock.json and panic during hot-reload.
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
