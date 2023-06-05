import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  target: 'node18',
  format: 'esm',
  bundle: true,
  minify: true,
  dts: true,
  clean: true,
  noExternal: [],
})
