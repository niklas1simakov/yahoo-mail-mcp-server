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
| `list_filters` | List Yahoo Mail server-side filters (web session required) |
| `create_filter` | Create a filter that moves matching incoming mail (web session required) |

All operations use permanent IMAP **UIDs** (not sequence numbers), so identifiers stay valid when other emails are deleted. There is **no permanent-delete tool** — nothing ever expunges mail.

### Filter authentication

Yahoo does not expose mail-filter management through IMAP or a documented
public API. `list_filters` and `create_filter` use the same undocumented
`/ws/v3/batch` and `savedsearches` calls as the Yahoo Mail web interface.
Consequently, the IMAP app password is **not sufficient** for these two tools.

To enable them:

1. Sign in to [Yahoo Mail](https://mail.yahoo.com/) in a desktop browser.
2. Open Developer Tools, select the **Network** panel, and reload Yahoo Mail.
3. Open **Settings → More Settings → Filters** so Yahoo sends a request to
   `/ws/v3/batch`. A request named `savedSearches.getMessageFilters` is ideal.
4. Right-click that request and select
   **Copy → Copy as fetch (Node.js)**. Paste the generated code into a private
   scratch editor for inspection—do not execute, share, or commit it.
5. Collect these values from the generated `fetch(...)` call:
   - **Cookie:** Copy the complete value of the `"cookie"` entry in `headers`.
     It is a semicolon-separated list and must remain on one line. The Node.js
     variant is important because browser-oriented fetch copies may omit this
     protected request header.
   - **WSSID:** Copy the `wssid` query parameter from the URL passed to
     `fetch(...)`.
   - **Mailbox ID:** In the request `body`, find a URI such as
     `/mailboxes/@.id==<mailbox-id>/savedsearches` and copy the opaque text
     between `/mailboxes/@.id==` and the next `/`.
   - **App ID:** Copy the `appId` query parameter, or keep the current default
     `YMailNovation`.
6. Put the values in `.env`, quoting the complete cookie value:

```dotenv
YAHOO_WEB_COOKIE='PH=...; Y=...; A1=...; A3=...'
YAHOO_WEB_WSSID=<wssid query parameter>
YAHOO_WEB_MAILBOX_ID=<opaque mailbox ID without the @.id== prefix>
YAHOO_WEB_APP_ID=YMailNovation
```

Do **not** use `document.cookie` from the Console: JavaScript cannot read
Yahoo's HttpOnly authentication cookies, and the resulting incomplete value
will usually fail with `HTTP 401 / EC-4008`. The Network panel's outgoing
`Cookie` request header includes those cookies.

Restart or reconnect the MCP server after changing `.env`, then call
`list_filters` to verify the session. The web cookie grants broad mailbox
access, so never commit, log, or share it. Yahoo can expire or invalidate the
cookie and WSSID at any time; if authentication starts returning 401, capture
fresh values from a signed-in request. Because this API is undocumented,
Yahoo may also change the endpoint or payload without notice.

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

Quick smoke test (should print an initialize result and 13 tools):

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
├── yahoo-web.js        # Undocumented Yahoo web API client for filters
└── operations/
    ├── list.js         # list_emails
    ├── read.js         # read_email
    ├── search.js       # search_emails
    ├── modify.js       # delete/archive/move/flag/read-status operations
    ├── folders.js      # list_folders
    └── filters.js      # list_filters/create_filter
```

## Security notes

- IMAP credentials only ever go to `imap.mail.yahoo.com` over TLS 1.2+ with certificate validation.
- Filter-session cookies are sent only to the fixed HTTPS host `mail.yahoo.com`; endpoint overrides to other hosts are rejected.
- The server is stdio-only: it opens **no network ports** and has no remote attack surface.
- The delete tool is a soft delete (move to Trash), but Yahoo auto-purges Trash on its own schedule — treat agent-initiated deletes as eventually permanent.
- Emails are untrusted input. If you let an AI agent read your inbox while it also has write tools (`delete_emails`, `move_emails`, …), a malicious email can attempt prompt injection to make the agent misfile or trash messages. Prefer keeping tool-approval prompts on for destructive actions.

## License

MIT
