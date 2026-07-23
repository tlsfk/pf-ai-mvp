import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 서비스키는 클라이언트 코드가 아니라 여기(Node 컨텍스트)에서만 읽어 요청에 주입합니다 —
// 프로덕션에서는 같은 역할을 api/molit, api/vworld 서버리스 함수가 담당합니다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        // 국토부 실거래가 7종 API — CORS 우회 + 키 주입
        "/api/molit": {
          target: "https://apis.data.go.kr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => {
            const url = new URL(path, "http://localhost");
            url.searchParams.set("serviceKey", env.MOLIT_API_KEY || "");
            return url.pathname.replace(/^\/api\/molit/, "") + url.search;
          },
        },
        // V-World 공간정보 API — CORS 우회 + 키 주입
        "/api/vworld": {
          target: "https://api.vworld.kr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => {
            const url = new URL(path, "http://localhost");
            url.searchParams.set("key", env.VWORLD_API_KEY || "");
            return url.pathname.replace(/^\/api\/vworld/, "") + url.search;
          },
        },
      },
    },
  };
});
