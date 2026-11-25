// ESLint 扁平配置（ESLint 9 + typescript-eslint 8）
// 策略：先启用推荐规则集跑通存量代码，后续再逐步收紧
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'logs/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      // 存量代码规模较大，先降级为警告避免一次性爆炸；新代码应避免
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn', // 存量代码存在 @ts-ignore，逐步清理
      // src 中存在函数体内懒加载 require（避免循环依赖/启动开销），先警告后逐步改造为 import()
      '@typescript-eslint/no-require-imports': 'warn',
      'no-console': 'off', // 服务端大量使用 console 日志（已有 logger 体系并存）
    },
  },
  {
    // 测试文件沿用 require() 访问 jest.mock 的既有模式
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
