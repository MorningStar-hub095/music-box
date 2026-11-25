export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // 覆盖率：通过 `npx jest --coverage` 按需开启，避免日常测试变慢
  collectCoverageFrom: [
    'src/modules/**/*.ts',
    'src/middleware/**/*.ts',
    'src/lib/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'html', 'lcov'],
};
