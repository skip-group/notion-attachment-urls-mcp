#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
  console.error("NOTION_API_KEY not set");
  process.exit(1);
}

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
};

function parsePageId(pageUrl) {
  const cleaned = pageUrl.split("?")[0].split("#")[0].replaceAll("-", "");
  const match = cleaned.match(/([0-9a-f]{32})$/);
  if (!match) {
    throw new Error(`Could not extract page ID from: ${pageUrl}`);
  }
  const raw = match[1];
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

async function getAttachmentsFromProperties(pageId) {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: NOTION_HEADERS,
  });
  if (!resp.ok) {
    throw new Error(`Notion API error ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();

  const attachments = [];
  for (const prop of Object.values(data.properties || {})) {
    if (prop.type !== "files") continue;
    for (const f of prop.files || []) {
      if (f.type === "file") {
        attachments.push({
          name: f.name,
          url: f.file.url,
          expiry_time: f.file.expiry_time,
        });
      }
    }
  }
  return attachments;
}

async function getAttachmentsFromBlocks(pageId) {
  const attachments = [];
  let cursor = undefined;

  while (true) {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);

    const resp = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?${params}`,
      { headers: NOTION_HEADERS },
    );
    if (!resp.ok) {
      throw new Error(`Notion API error ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();

    for (const block of data.results || []) {
      if (block.type !== "file") continue;
      const fileData = block.file;
      if (fileData.type === "file") {
        attachments.push({
          name: fileData.name || "unnamed",
          url: fileData.file.url,
          expiry_time: fileData.file.expiry_time,
        });
      }
    }

    if (!data.has_more) break;
    cursor = data.next_cursor;
  }

  return attachments;
}

const server = new Server(
  { name: "notion-attachments", version: "1.1.5" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_notion_attachment_urls",
      description:
        "Get temporary download URLs for all file attachments on a Notion page. " +
        "Checks both page-level file properties and file blocks in the page body. " +
        "Returns a JSON list of attachments with name, url, and expiry_time. " +
        "URLs are pre-signed S3 URLs that expire after ~1 hour.",
      inputSchema: {
        type: "object",
        properties: {
          page_url: {
            type: "string",
            description: "A Notion page URL or page ID",
          },
        },
        required: ["page_url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "get_notion_attachment_urls") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const pageUrl = request.params.arguments?.page_url;
  if (!pageUrl) {
    throw new Error("page_url is required");
  }

  const pageId = parsePageId(pageUrl);
  const [propAttachments, blockAttachments] = await Promise.all([
    getAttachmentsFromProperties(pageId),
    getAttachmentsFromBlocks(pageId),
  ]);
  const attachments = [...propAttachments, ...blockAttachments];

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(attachments, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Notion Attachment URLs MCP server running...");
