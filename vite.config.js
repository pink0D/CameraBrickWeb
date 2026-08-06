import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';

// Gzip index.html and remove the uncompressed original
function gzipOutput() {
  return {
    name: 'gzip-output',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const filePath = path.resolve(__dirname, 'dist/index.html');
      const gzipPath = path.resolve(__dirname, 'dist/index.html.gz');
      if (fs.existsSync(filePath)) {
        const input = fs.createReadStream(filePath);
        const output = fs.createWriteStream(gzipPath);
        output.on('finish', () => fs.rmSync(filePath));
        input.pipe(zlib.createGzip()).pipe(output);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    gzipOutput(),
  ],
  server: {
    host: true,
  },
  build: {
    // Inline assets regardless of size
    assetsInlineLimit: Infinity,
  },
})
