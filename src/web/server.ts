import Fastify, { type FastifyInstance } from "fastify";
import { loadSecrets } from "../config/store.js";
import type { AppConfig } from "../config/schema.js";
import { openDatabase } from "../db/database.js";
import { FileJobRepository } from "../files/jobs.js";
import { getGatewayStatus } from "../gateway/index.js";
import { MessageRepository } from "../messages/repository.js";
import { processMessagesNow } from "../rag/manual-index.js";

function buildHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ChatterCatcher</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f5f0;
        --panel: #ffffff;
        --text: #1f2933;
        --muted: #667085;
        --line: #d9d7cf;
        --accent: #1f7a5a;
        --warn: #9a5b13;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 48px; }
      header {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: flex-start;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--line);
      }
      h1 { margin: 0; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
      p { margin: 8px 0 0; color: var(--muted); }
      code { background: #eceae2; border-radius: 4px; padding: 2px 6px; }
      button {
        appearance: none;
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--text);
        border-radius: 6px;
        padding: 8px 12px;
        cursor: pointer;
      }
      button:hover { border-color: var(--accent); }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
      .grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
        margin: 24px 0;
      }
      .metric {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        min-height: 112px;
      }
      .label { color: var(--muted); font-size: 13px; }
      .value { margin-top: 10px; font-size: 22px; font-weight: 650; overflow-wrap: anywhere; }
      .note { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.45; }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
        gap: 24px;
      }
      section { padding: 20px 0; border-top: 1px solid var(--line); }
      section:first-child { border-top: 0; }
      table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      th, td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { color: var(--muted); font-size: 13px; font-weight: 600; }
      tr:last-child td { border-bottom: 0; }
      .message { max-width: 560px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .path { max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 13px; }
      .status-ok { color: var(--accent); }
      .status-warn { color: var(--warn); }
      .empty { color: var(--muted); padding: 18px; background: var(--panel); border: 1px dashed var(--line); border-radius: 8px; }
      .status-line { margin-top: 10px; font-size: 13px; color: var(--muted); text-align: right; }
      @media (max-width: 900px) {
        header, .layout { display: block; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        header button { margin-top: 16px; }
      }
      @media (max-width: 560px) {
        main { padding: 24px 16px 36px; }
        .grid { grid-template-columns: 1fr; }
        th:nth-child(3), td:nth-child(3) { display: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>ChatterCatcher</h1>
          <p>本地优先的家庭群知识库。问答必须先检索 RAG 证据，不堆叠全量上下文。</p>
        </div>
        <div>
          <div class="actions">
            <button id="process-messages" type="button">立即处理</button>
            <button id="refresh" type="button">刷新</button>
          </div>
          <div id="action-status" class="status-line"></div>
        </div>
      </header>

      <div class="grid" id="metrics"></div>

      <div class="layout">
        <div>
          <section>
            <h2>最近消息</h2>
            <div id="messages" class="empty">正在读取...</div>
          </section>
        </div>
        <aside>
          <section>
            <h2>群聊</h2>
            <div id="chats" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>文件库</h2>
            <div id="files" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>解析任务</h2>
            <div id="file-jobs" class="empty">正在读取...</div>
          </section>
          <section>
            <h2>本地操作</h2>
            <p><code>chattercatcher settings</code> 修改配置。</p>
            <p><code>chattercatcher files add &lt;path...&gt;</code> 导入文本、DOCX 或 PDF 文件。</p>
            <p><code>chattercatcher doctor</code> 检查飞书、模型、RAG 和本地存储。</p>
          </section>
        </aside>
      </div>
    </main>
    <script>
      const metrics = document.querySelector("#metrics");
      const messages = document.querySelector("#messages");
      const chats = document.querySelector("#chats");
      const files = document.querySelector("#files");
      const fileJobs = document.querySelector("#file-jobs");
      const refresh = document.querySelector("#refresh");
      const processMessages = document.querySelector("#process-messages");
      const actionStatus = document.querySelector("#action-status");

      function fmt(value) {
        return value == null || value === "" ? "-" : String(value);
      }

      function escapeHtml(value) {
        return fmt(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function renderMetrics(status) {
        const gatewayClass = status.gateway.configured ? "status-ok" : "status-warn";
        metrics.innerHTML = [
          ["Gateway", status.gateway.message, gatewayClass],
          ["群聊", status.data.chats, ""],
          ["消息", status.data.messages, ""],
          ["文件", status.data.files, ""],
          ["Web UI", status.web.host + ":" + status.web.port, ""],
        ].map(([label, value, extra]) => \`
          <div class="metric">
            <div class="label">\${escapeHtml(label)}</div>
            <div class="value \${extra}">\${escapeHtml(value)}</div>
            <div class="note">\${label === "Gateway" ? "飞书长连接状态" : "本地 SQLite / LanceDB 数据"}</div>
          </div>
        \`).join("");
      }

      function renderMessages(items) {
        if (items.length === 0) {
          messages.className = "empty";
          messages.textContent = "还没有消息。启动 Gateway 后，群聊文本会进入本地 RAG 索引。";
          return;
        }
        messages.className = "";
        messages.innerHTML = \`
          <table>
            <thead><tr><th>时间</th><th>发送者</th><th>群聊</th><th>内容</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>\${escapeHtml(item.sentAt)}</td>
                  <td>\${escapeHtml(item.senderName)}</td>
                  <td>\${escapeHtml(item.chatName)}</td>
                  <td class="message" title="\${escapeHtml(item.text)}">\${escapeHtml(item.text)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderChats(items) {
        if (items.length === 0) {
          chats.className = "empty";
          chats.textContent = "还没有群聊记录。";
          return;
        }
        chats.className = "";
        chats.innerHTML = \`
          <table>
            <thead><tr><th>名称</th><th>平台</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>\${escapeHtml(item.name)}</td>
                  <td>\${escapeHtml(item.platform)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderFiles(items) {
        if (items.length === 0) {
          files.className = "empty";
          files.textContent = "还没有文件。可先运行 chattercatcher files add <path...> 导入文本、DOCX 或 PDF 文件。";
          return;
        }
        files.className = "";
        files.innerHTML = \`
          <table>
            <thead><tr><th>文件</th><th>解析器</th><th>字符</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>
                    <div>\${escapeHtml(item.fileName)}</div>
                    <div class="path" title="\${escapeHtml(item.storedPath)}">\${escapeHtml(item.storedPath)}</div>
                  </td>
                  <td>\${escapeHtml(item.parser || "unknown")}</td>
                  <td>\${escapeHtml(item.characters)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderFileJobs(items) {
        if (items.length === 0) {
          fileJobs.className = "empty";
          fileJobs.textContent = "还没有文件解析任务。";
          return;
        }
        fileJobs.className = "";
        fileJobs.innerHTML = \`
          <table>
            <thead><tr><th>任务</th><th>状态</th></tr></thead>
            <tbody>
              \${items.map((item) => \`
                <tr>
                  <td>
                    <div>\${escapeHtml(item.fileName)}</div>
                    <div class="path" title="\${escapeHtml(item.id)}">ID: \${escapeHtml(item.id)}</div>
                    <div class="path" title="\${escapeHtml(item.error || item.storedPath)}">\${escapeHtml(item.error || item.storedPath)}</div>
                  </td>
                  <td>\${escapeHtml(item.status)}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      async function load() {
        const [status, recent, chatList, fileList, jobList] = await Promise.all([
          fetch("/api/status").then((response) => response.json()),
          fetch("/api/messages/recent?limit=20").then((response) => response.json()),
          fetch("/api/chats").then((response) => response.json()),
          fetch("/api/files").then((response) => response.json()),
          fetch("/api/file-jobs").then((response) => response.json()),
        ]);
        renderMetrics(status);
        renderMessages(recent.items);
        renderChats(chatList.items);
        renderFiles(fileList.items);
        renderFileJobs(jobList.items);
      }

      async function processNow() {
        processMessages.disabled = true;
        actionStatus.textContent = "正在处理消息索引...";
        try {
          const response = await fetch("/api/process/messages", { method: "POST" });
          const result = await response.json();
          if (!response.ok) {
            actionStatus.textContent = result.message || "处理失败。";
            return;
          }

          if (result.status === "skipped") {
            actionStatus.textContent = result.reason;
          } else {
            actionStatus.textContent = \`处理完成：chunks=\${result.chunks}, vectors=\${result.vectors}\`;
          }
          await load();
        } catch (error) {
          actionStatus.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          processMessages.disabled = false;
        }
      }

      refresh.addEventListener("click", () => void load());
      processMessages.addEventListener("click", () => void processNow());
      void load();
    </script>
  </body>
</html>`;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const rawLimit = Number(value ?? fallback);
  return Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), max) : fallback;
}

export function createWebApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  const database = openDatabase(config);
  const messages = new MessageRepository(database);
  const fileJobs = new FileJobRepository(database);

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/status", async () => ({
    app: "ChatterCatcher",
    gateway: getGatewayStatus(config),
    data: {
      chats: messages.getChatCount(),
      messages: messages.getMessageCount(),
      files: messages.listFiles(1_000).length,
    },
    rag: {
      mode: "required",
      note: "问答必须先检索证据，禁止全量上下文堆叠。",
      retrieval: {
        keyword: "SQLite FTS5",
        vector: "LanceDB",
        hybrid: true,
      },
    },
    web: config.web,
  }));

  app.get("/api/chats", async () => ({
    items: messages.listChats(),
  }));

  app.get("/api/files", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    return {
      items: messages.listFiles(limit),
    };
  });

  app.get("/api/file-jobs", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 50, 200);
    const status = (request.query as { status?: string }).status;
    return {
      items: fileJobs.list(limit, status === "processing" || status === "indexed" || status === "failed" ? { status } : {}),
    };
  });

  app.get("/api/messages/recent", async (request) => {
    const limit = parseLimit((request.query as { limit?: string }).limit, 20, 100);
    return {
      items: messages.listRecentMessages(limit),
    };
  });

  app.post("/api/process/messages", async (_request, reply) => {
    try {
      return await processMessagesNow({
        config,
        secrets: await loadSecrets(),
        database,
        limit: 10_000,
      });
    } catch (error) {
      reply.code(500);
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return buildHtml();
  });

  return app;
}

export async function startWebServer(config: AppConfig): Promise<void> {
  const app = createWebApp(config);
  await app.listen({ host: config.web.host, port: config.web.port });
  const address = app.server.address();
  const url =
    typeof address === "string" ? address : `http://${config.web.host}:${address?.port ?? config.web.port}`;
  console.log(`ChatterCatcher Web UI: ${url}`);
}
