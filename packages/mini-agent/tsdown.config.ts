import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    types: './src/types/index.ts',
    llm: './src/llm/index.ts',
    tools: './src/tools/index.ts',
    agent: './src/agent/index.ts',
    utils: './src/utils/index.ts',
  },
  sourcemap: false,
  format: ['esm'],
});
