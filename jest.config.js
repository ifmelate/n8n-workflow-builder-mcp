module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.test.ts'
  ],
  
  // Transform TypeScript files
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: false,
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  },
  
  // Module file extensions
  moduleFileExtensions: ['js', 'ts', 'json'],
  
  // Module name mapping for imports
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // Setup files
  setupFilesAfterEnv: [],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  
  // Coverage settings
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/**/index.{js,ts}'
  ],
  
  // Globals for Jest and TypeScript
  globals: {
    'ts-jest': {
      useESM: false
    }
  },
  
  // Verbose output
  verbose: true,
  
  // Allow JSON imports
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ]
};
