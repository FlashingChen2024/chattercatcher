import Fastify from "fastify";
import type { AppConfig } from "../config/schema.js";
import { getGatewayStatus } from "../gateway/index.js";

export async function startWebServer(config: AppConfig): Promise<void> {
  const app = Fastify({ logger: false });

  app.get("/api/status", async () => ({
    app: "ChatterCatcher",
    gateway: getGatewayStatus(config),
    rag: {
      mode: "required",
      note: "问答必须先检索证据，禁止全量上下文堆叠。",
    },
    web: config.web,
  }));

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ChatterCatcher</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f7f7f4; color: #1f2933; }
      main { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
      h1 { font-size: 32px; margin: 0 0 8px; }
      section { border-top: 1px solid #d7d7d0; padding: 24px 0; }
      code { background: #ecece7; padding: 2px 6px; border-radius: 4px; }
      .status { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
      .item { border: 1px solid #d7d7d0; border-radius: 8px; padding: 16px; background: #fff; }
    </style>
  </head>
  <body>
    <main>
      <h1>ChatterCatcher</h1>
      <p>本地优先的家庭群知识机器人。</p>
      <section>
        <h2>状态</h2>
        <div class="status">
          <div class="item"><strong>Web UI</strong><br />运行中：${config.web.host}:${config.web.port}</div>
          <div class="item"><strong>RAG</strong><br />强制启用，禁止暴力堆叠上下文。</div>
          <div class="item"><strong>飞书</strong><br />${getGatewayStatus(config).message}</div>
        </div>
      </section>
      <section>
        <h2>下一步</h2>
        <p>运行 <code>chattercatcher setup</code> 配置飞书和模型，运行 <code>chattercatcher doctor</code> 检查本地状态。</p>
      </section>
    </main>
  </body>
</html>`;
  });

  await app.listen({ host: config.web.host, port: config.web.port });
  const address = app.server.address();
  const url =
    typeof address === "string" ? address : `http://${config.web.host}:${address?.port ?? config.web.port}`;
  console.log(`ChatterCatcher Web UI: ${url}`);
}
