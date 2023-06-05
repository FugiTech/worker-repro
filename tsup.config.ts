import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  publicDir: 'public',
  target: 'node18',
  format: 'esm',
  bundle: true,
  minify: true,
  dts: true,
  clean: true,
  noExternal: [],
})
