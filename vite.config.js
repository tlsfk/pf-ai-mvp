import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 국토부 실거래가 7종 API — CORS 우회용 프록시
      "/api/molit": {
        target: "https://apis.data.go.kr",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/molit/, ""),
      },
      // V-World 공간정보 API — CORS 우회용 프록시
      "/api/vworld": {
        target: "https://api.vworld.kr",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/vworld/, ""),
      },
    },
  },
});
