#!/usr/bin/env node

/**
 * Yahoo Mail MCP Server
 * Local MCP server providing Yahoo Mail access via IMAP (stdio transport).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import { toolDefinitions } from './tools.js';
import { listEmails } from './operations/list.js';
import { readEmails } from './operations/read.js';
import { searchEmails } from './operations/search.js';
import { listFolders } from './operations/folders.js';
import {
    markAsRead,
    markAsUnread,
    flagEmails,
    unflagEmails,
    deleteEmails,
    archiveEmails,
    moveEmails
} from './operations/modify.js';

// Load environment variables from .env file (for local development).
// quiet: dotenv v17 logs a tip to stdout by default, which would corrupt
// the JSON-RPC stdio stream.
dotenv.config({ quiet: true });

const server = new Server(
    {
        name: 'yahoo-mail-mcp',
        version: '4.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'list_emails':
                return await listEmails(args?.count || 10, args?.folder || 'INBOX', args?.offset || 0);

            case 'read_email':
                return await readEmails(args.uids, args.folder || 'INBOX');

            case 'search_emails':
                return await searchEmails(args?.query || '', {
                    count: args?.count || 10,
                    dateFrom: args?.dateFrom || null,
                    dateTo: args?.dateTo || null,
                    sender: args?.sender || null,
                    unreadOnly: args?.unreadOnly || false,
                    folder: args?.folder || 'INBOX'
                });

            case 'delete_emails':
                return await deleteEmails(args.uids, args.folder || 'INBOX');

            case 'archive_emails':
                return await archiveEmails(args.uids, args.folder || 'INBOX');

            case 'mark_as_read':
                return await markAsRead(args.uids, args.folder || 'INBOX');

            case 'mark_as_unread':
                return await markAsUnread(args.uids, args.folder || 'INBOX');

            case 'flag_emails':
                return await flagEmails(args.uids, args.folder || 'INBOX');

            case 'unflag_emails':
                return await unflagEmails(args.uids, args.folder || 'INBOX');

            case 'move_emails':
                return await moveEmails(args.uids, args.folderName, args.sourceFolder || 'INBOX');

            case 'list_folders':
                return await listFolders();

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [{
                type: 'text',
                text: `Error: ${error.message}`
            }]
        };
    }
});

server.onerror = (error) => {
    console.error('[MCP Error]', error);
};

process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Yahoo Mail MCP server running on stdio');
