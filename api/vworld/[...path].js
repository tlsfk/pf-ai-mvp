// V-World 지오코딩/토지특성정보 API 서버리스 프록시 (Vercel).
// 클라이언트는 키를 모르는 상태로 /api/vworld/... 를 호출하고, 이 함수가
// process.env.VWORLD_API_KEY(Vercel 프로젝트 환경변수, VITE_ 접두사 없음 → 클라이언트에 노출 안 됨)를
// 주입해 https://api.vworld.kr 로 전달합니다. 로컬 dev에서는 같은 역할을 vite.config.js 프록시가 합니다.
export default async function handler(req, res) {
  const { path, ...query } = req.query;
  const upstreamPath = Array.isArray(path) ? path.join("/") : path || "";

  const url = new URL(`https://api.vworld.kr/${upstreamPath}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", process.env.VWORLD_API_KEY || "");

  const upstream = await fetch(url);
  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  res.send(body);
}
