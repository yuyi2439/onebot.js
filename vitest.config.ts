import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    teardownTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov', 'json', 'json-summary'],
      include: ['src/**/*.ts'],
      // interfaces.ts 只有类型声明、index.ts 只是 re-export 桶文件：编译后都没有可执行
      // 语句，计进总数只会制造 0% 噪声。
      exclude: ['src/interfaces.ts', 'src/index.ts'],
      // 当前实测：语句 99.1%、分支 94.9%、函数 100%、行 100%。阈值留在实测之下，
      // 空出来的余量留给尚不可达的防御性分支。
      thresholds: {
        statements: 98,
        branches: 90,
        functions: 100,
        lines: 99,
      },
    },
  },
})
