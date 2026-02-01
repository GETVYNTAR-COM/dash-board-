/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/local-seo',
  async redirects() {
    return [
      {
        source: '/',
        destination: '/local-seo',
        basePath: false,
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
