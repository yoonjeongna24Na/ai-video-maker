import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json" };

function send(res, status, data, type="application/json") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "same-origin" });
  res.end(type.includes("application/json") ? JSON.stringify(data) : data);
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}
function requireKey(key, name) {
  if (!key) throw new Error(`${name} API 키가 설정되지 않았습니다. .env 파일을 확인하세요.`);
}
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}); return res.end();
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, { openai: !!process.env.OPENAI_API_KEY, kling: !!process.env.KLING_API_KEY });
    }
    if (req.method === "POST" && url.pathname === "/api/image") {
      requireKey(process.env.OPENAI_API_KEY, "OpenAI");
      const { prompt, size="1024x1536" } = await body(req);
      if (!prompt?.trim()) return send(res, 400, { error:"이미지 설명을 입력해 주세요." });
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method:"POST",
        headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
        body:JSON.stringify({ model:"gpt-image-1", prompt, size, n:1 })
      });
      const data = await r.json();
      if (!r.ok) return send(res, r.status, { error:data.error?.message || "이미지 생성 요청에 실패했습니다." });
      return send(res, 200, { image:`data:image/png;base64,${data.data?.[0]?.b64_json}` });
    }
    if (req.method === "POST" && url.pathname === "/api/video") {
      requireKey(process.env.KLING_API_KEY, "Kling");
      const { prompt, image, duration=5, resolution="720p" } = await body(req);
      if (!prompt?.trim() || !image?.startsWith("data:image/")) return send(res, 400, { error:"프롬프트와 이미지가 필요합니다." });
      const r = await fetch("https://api-singapore.klingai.com/image-to-video/kling-3.0", {
        method:"POST",
        headers:{ "Authorization":`Bearer ${process.env.KLING_API_KEY}`, "Content-Type":"application/json" },
        body:JSON.stringify({
          contents:[{type:"prompt",text:prompt},{type:"first_frame",url:image}],
          settings:{resolution,duration:Number(duration),audio:"off",multi_shot:false}
        })
      });
      const data = await r.json();
      if (!r.ok || data.code !== 0) return send(res, r.status || 502, { error:data.message || "Kling 영상 생성 요청에 실패했습니다.", detail:data });
      return send(res, 200, { taskId:data.data?.id, status:data.data?.status || "submitted" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/video/")) {
      requireKey(process.env.KLING_API_KEY, "Kling");
      const id = url.pathname.split("/").pop();
      const r = await fetch(`https://api-singapore.klingai.com/tasks?task_ids=${encodeURIComponent(id)}`, {
        headers:{ "Authorization":`Bearer ${process.env.KLING_API_KEY}` }
      });
      const data = await r.json();
      if (!r.ok || data.code !== 0) return send(res, r.status || 502, { error:data.message || "상태 조회에 실패했습니다." });
      const task = data.data?.[0];
      return send(res, 200, { status:task?.status, videoUrl:task?.outputs?.find(x=>x.type==="video")?.url, message:task?.message });
    }
    if (req.method === "GET") {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/,"");
      const file = path.join(__dirname, "public", requested);
      if (!file.startsWith(path.join(__dirname,"public"))) return send(res,404,{error:"Not found"});
      if (!fs.existsSync(file)) return send(res,404,{error:"Not found"});
      return send(res,200,fs.readFileSync(file),mime[path.extname(file)] || "application/octet-stream");
    }
    send(res,404,{error:"Not found"});
  } catch (e) {
    send(res,500,{error:e.message || "서버 오류"});
  }
});
server.listen(PORT, "0.0.0.0", () => console.log(`AI Video Maker: http://localhost:${PORT}`));