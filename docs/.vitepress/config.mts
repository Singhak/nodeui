import { defineConfig } from 'vitepress';

// Served from https://singhak.github.io/nodeui/
export default defineConfig({
  title: 'NodeUI',
  description:
    'Local-only developer console and observability suite for Express, Fastify, NestJS, Koa, Hapi, Hono and node:http.',
  base: '/nodeui/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['superpowers/**'],
  head: [['meta', { name: 'theme-color', content: '#6366f1' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/configuration' },
      { text: 'FAQ', link: '/faq' },
      {
        text: 'Links',
        items: [
          { text: 'Changelog', link: 'https://github.com/Singhak/nodeui/blob/master/CHANGELOG.md' },
          { text: 'npm', link: 'https://www.npmjs.com/package/@singhak/nodeui-core' },
          {
            text: 'Contributing',
            link: 'https://github.com/Singhak/nodeui/blob/master/CONTRIBUTING.md',
          },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Framework integrations', link: '/guide/frameworks' },
          { text: 'Screenshots', link: '/guide/screenshots' },
          { text: 'Try the demos', link: '/guide/demos' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Panels', link: '/guide/panels' },
          { text: 'Database queries', link: '/guide/database' },
          { text: 'Custom panels (plugins)', link: '/guide/plugins' },
          { text: 'Capture and compatibility', link: '/guide/capture' },
          { text: 'Persistence', link: '/guide/persistence' },
          { text: 'OpenTelemetry export', link: '/guide/opentelemetry' },
          { text: 'CLI, attach and MCP', link: '/guide/cli' },
          { text: 'Docker and proxies', link: '/guide/docker' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'Security model', link: '/guide/security' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'REST and SSE API', link: '/reference/api' },
          { text: 'Benchmarks', link: '/reference/benchmarks' },
          { text: 'FAQ', link: '/faq' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Singhak/nodeui' }],
    editLink: {
      pattern: 'https://github.com/Singhak/nodeui/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Built for the Node.js developer community.',
    },
  },
});
