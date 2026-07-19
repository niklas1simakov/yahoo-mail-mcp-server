# Yahoo Mail MCP Server

A local Model Context Protocol (MCP) server for managing Yahoo Mail via IMAP. Runs over stdio for use with Claude Desktop, Claude Code, and other MCP clients.

Forked from [jtokib/yahoo-mail-mcp-server](https://github.com/jtokib/yahoo-mail-mcp-server) and simplified for local-only use: the HTTP/SSE transport, OAuth layer, and Docker/Render deployment have been removed, and the code has been restructured into modules.

## Tools

| Tool | Description |
|------|-------------|
| `list_emails` | List recent emails with metadata (size, flags, attachments) and pagination |
| `read_email` | Read full email content by UID (batch support) |
| `search_emails` | Search with filters: query, date range, sender, unread-only, folder |
| `list_folders` | List all IMAP folders |
| `delete_emails` | Move emails to Trash (soft delete — recoverable until Yahoo purges Trash) |
| `archive_emails` | Move emails to the Archive folder |
| `move_emails` | Move emails to any folder |
| `mark_as_read` / `mark_as_unread` | Toggle read status |
| `flag_emails` / `unflag_emails` | Toggle star/flag |

All operations use permanent IMAP **UIDs** (not sequence numbers), so identifiers stay valid when other emails are deleted. There is **no permanent-delete tool** — nothing ever expunges mail.

## Setup

### 1. Install

Requires Node.js ≥ 24 and [pnpm](https://pnpm.io).

```bash
pnpm install
```

### 2. Yahoo app password

1. Go to [Yahoo Account Security](https://login.yahoo.com/account/security)
2. Generate an app password ("Other App" → e.g. "MCP Server")
3. Copy the 16-character password

### 3. Configure credentials

Either copy `.env.example` to `.env` and fill it in, or pass the variables via your MCP client config (see below).

```bash
cp .env.example .env
```

> **Never commit `.env`** — it contains your mailbox credentials. It's gitignored.

## Connecting a client

### Claude Code

```bash
claude mcp add yahoo-mail \
  --env YAHOO_EMAIL=you@yahoo.com \
  --env YAHOO_APP_PASSWORD=your16charpassword \
  -- node /path/to/yahoo-mail-mcp-server/src/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "yahoo-mail": {
      "command": "node",
      "args": ["/path/to/yahoo-mail-mcp-server/src/index.js"],
      "env": {
        "YAHOO_EMAIL": "you@yahoo.com",
        "YAHOO_APP_PASSWORD": "your16charpassword"
      }
    }
  }
}
```

## Development

```bash
pnpm start   # run the server (stdio)
pnpm dev     # run with auto-restart on file changes
```

Quick smoke test (should print an initialize result and 11 tools):

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'; \
 echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 1) | node src/index.js
```

## Project structure

```
src/
├── index.js            # Entry point: MCP server + stdio transport + tool routing
├── tools.js            # MCP tool definitions (schemas)
├── imap.js             # IMAP connection + shared helpers
└── operations/
    ├── list.js         # list_emails
    ├── read.js         # read_email
    ├── search.js       # search_emails
    ├── modify.js       # delete/archive/move/flag/read-status operations
    └── folders.js      # list_folders
```

## Security notes

- Credentials only ever go to `imap.mail.yahoo.com` over TLS 1.2+ with certificate validation.
- The server is stdio-only: it opens **no network ports** and has no remote attack surface.
- The delete tool is a soft delete (move to Trash), but Yahoo auto-purges Trash on its own schedule — treat agent-initiated deletes as eventually permanent.
- Emails are untrusted input. If you let an AI agent read your inbox while it also has write tools (`delete_emails`, `move_emails`, …), a malicious email can attempt prompt injection to make the agent misfile or trash messages. Prefer keeping tool-approval prompts on for destructive actions.

## License

MIT
