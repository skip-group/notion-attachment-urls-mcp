"""
MCP server that returns temporary pre-signed S3 URLs for Notion page attachments.

Requires:
    pip install fastmcp requests

Environment variables:
    NOTION_API_KEY - Notion integration API token
"""

import json
import os
import re

import requests
from fastmcp import FastMCP

mcp = FastMCP("notion-attachments")

NOTION_API_KEY = os.environ["NOTION_API_KEY"]
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Notion-Version": "2022-06-28",
}


def parse_page_id(page_url: str) -> str:
    """Extract and format a Notion page ID from a URL or raw ID."""
    page_url = page_url.split("?")[0].split("#")[0]
    match = re.search(r"([0-9a-f]{32})$", page_url.replace("-", ""))
    if not match:
        raise ValueError(f"Could not extract page ID from: {page_url}")
    raw = match.group(1)
    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def get_attachments_from_properties(page_id: str) -> list[dict]:
    """Get attachments from page-level file properties."""
    resp = requests.get(
        f"https://api.notion.com/v1/pages/{page_id}",
        headers=NOTION_HEADERS,
    )
    resp.raise_for_status()
    data = resp.json()

    attachments = []
    for prop in data.get("properties", {}).values():
        if prop.get("type") != "files":
            continue
        for f in prop.get("files", []):
            if f.get("type") == "file":
                attachments.append({
                    "name": f["name"],
                    "url": f["file"]["url"],
                    "expiry_time": f["file"]["expiry_time"],
                })
    return attachments


def get_attachments_from_blocks(page_id: str) -> list[dict]:
    """Get attachments from file blocks in the page body."""
    attachments = []
    cursor = None

    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor

        resp = requests.get(
            f"https://api.notion.com/v1/blocks/{page_id}/children",
            headers=NOTION_HEADERS,
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

        for block in data.get("results", []):
            if block.get("type") != "file":
                continue
            file_data = block["file"]
            if file_data.get("type") == "file":
                attachments.append({
                    "name": file_data.get("name", "unnamed"),
                    "url": file_data["file"]["url"],
                    "expiry_time": file_data["file"]["expiry_time"],
                })

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    return attachments


@mcp.tool()
def get_notion_attachment_urls(page_url: str) -> str:
    """Get temporary download URLs for all file attachments on a Notion page.

    Checks both page-level file properties and file blocks in the page body.
    Returns a JSON list of attachments with name, url, and expiry_time.
    URLs are pre-signed S3 URLs that expire after ~1 hour.

    Args:
        page_url: A Notion page URL or page ID.
    """
    page_id = parse_page_id(page_url)
    attachments = get_attachments_from_properties(page_id)
    attachments.extend(get_attachments_from_blocks(page_id))
    return json.dumps(attachments, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
