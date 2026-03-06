# Notion Attachments

A Claude Desktop extension that provides access to file attachments on Notion pages.

## The problem

The built-in Notion MCP returns internal `file://` references for page attachments instead of actual downloadable URLs. This means Claude can't read or process files attached to Notion pages.

## What this does

This extension calls the Notion REST API directly to retrieve temporary pre-signed S3 URLs for all file attachments on a page. It checks both:

- **Page-level file properties** (via `/v1/pages/{id}`)
- **File blocks in the page body** (via `/v1/blocks/{id}/children`)

The returned URLs expire after ~1 hour and can be passed to WebFetch or the PDF skill to read the file contents.

## Installation

1. Download the `.mcpb` file from [Releases](https://github.com/skip-group/notion-attachment-urls-mcp/releases)
2. Double-click the file (or drag it onto Claude Desktop)
3. Enter your Notion API key when prompted

## Getting a Notion API key

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Create a new **Internal Integration**
3. Copy the token (starts with `ntn_`)
4. Share the relevant Notion pages/databases with your integration

## Building from source

```bash
git clone https://github.com/skip-group/notion-attachment-urls-mcp.git
cd notion-attachment-urls-mcp
npm install
npm install -g @anthropic-ai/mcpb
mcpb pack .
```

## License

MIT
