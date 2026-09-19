import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/web-component.tsx'),
      name: 'WorkflowWidget',
      fileName: (format) => `workflow-widget.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // Bundle React inside the widget so it's a completely self-contained web component
    },
  },
  server: {
    port: 3003,
  },
});
