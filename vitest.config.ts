import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@workflow/telemetry/client': path.resolve(__dirname, 'packages/telemetry/src/client.ts'),
      '@workflow/telemetry': path.resolve(__dirname, 'packages/telemetry/src/index.ts'),
      '@workflow/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@workflow/shared-schemas': path.resolve(__dirname, 'packages/shared-schemas/src/index.ts'),
      '@workflow/test-utils': path.resolve(__dirname, 'packages/test-utils/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['apps/**/*.test.tsx', 'jsdom'],
      ['apps/**/*.test.ts', 'jsdom'],
      ['tests/unit/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'apps/**/*.test.tsx', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', 'tests/e2e/**'],
    env: {
      KAFKAJS_NO_PARTITIONER_WARNING: '1',
      NODE_ENV: 'test',
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        'tests/**',
        'apps/**',
        'scripts/**',
        'packages/test-utils/**',
        'packages/shared-types/**',
        '**/index.ts',
        '**/migrate.ts',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },

    },
  },
});

