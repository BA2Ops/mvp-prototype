import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: ['verbose'],
    coverage: {
      enabled: false,
      provider: 'v8',
      include: ['src/**/*']
    }
  }
})