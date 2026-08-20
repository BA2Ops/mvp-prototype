import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: ['verbose'],
    coverage: {
      enabled: false,                 // 默认不启用，通过 --coverage 启用
      provider: 'v8',                 // v8 provider（Node 内置，快）
      include: ['src/**/*.ts'],       // 只统计 src
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',            // barrel 文件通常无逻辑
        'src/mocks/**'                // mocks 是测试夹具，不计入覆盖率
      ],
      reporter: ['text', 'html', 'json-summary'],  // 多种报告格式
      reportsDirectory: './coverage',  // 报告目录
      // MVP 阶段：宽松阈值（随着 Phase 推进逐渐收紧）
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
        // 关键模块必须有较高覆盖率
        perFile: false  // Phase A 阶段不需要 per-file 阈值
      },
      // 显示未覆盖行的具体内容
      all: true,
      // 包含所有匹配的文件，即使无测试
      skipFull: false
    }
  }
})