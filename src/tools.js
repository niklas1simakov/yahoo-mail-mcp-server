/**
 * MCP tool definitions (schemas) for the Yahoo Mail server.
 */

const uidsProperty = (description) => ({
    type: 'array',
    items: { type: 'number' },
    description,
    minItems: 1
});

const folderProperty = (description = 'Folder containing emails (default: INBOX)') => ({
    type: 'string',
    description,
    default: 'INBOX'
});

export const toolDefinitions = [
    {
        name: 'list_emails',
        description: 'List recent emails from a Yahoo Mail folder. Returns UIDs (permanent identifiers) and enriched metadata including size, flags, and attachment status.',
        inputSchema: {
            type: 'object',
            properties: {
                count: {
                    type: 'number',
                    description: 'Number of emails to retrieve (default: 10, max: 50)',
                    default: 10
                },
                folder: folderProperty('Folder to list emails from (default: INBOX). Use list_folders to see available folders.'),
                offset: {
                    type: 'number',
                    description: 'Number of emails to skip (for pagination, default: 0)',
                    default: 0
                }
            }
        }
    },
    {
        name: 'read_email',
        description: 'Read email content using UIDs (permanent identifiers). UIDs don\'t change when emails are deleted. Get UIDs from list_emails or search_emails.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to read. UIDs are permanent identifiers from list_emails.'),
                folder: folderProperty('Folder containing the emails (default: INBOX)')
            },
            required: ['uids']
        }
    },
    {
        name: 'search_emails',
        description: 'Search emails using UIDs with advanced filters. Returns UIDs which are permanent identifiers that don\'t change when emails are deleted. Get UIDs from results for subsequent operations.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search term for subject or sender (can be empty for date-only searches)',
                    default: ''
                },
                count: {
                    type: 'number',
                    description: 'Number of results to return (default: 10, max: 50)',
                    default: 10
                },
                dateFrom: {
                    type: 'string',
                    description: 'Filter emails from this date onwards (ISO 8601 or RFC 2822 format)',
                    default: null
                },
                dateTo: {
                    type: 'string',
                    description: 'Filter emails up to this date (ISO 8601 or RFC 2822 format)',
                    default: null
                },
                sender: {
                    type: 'string',
                    description: 'Filter by specific sender email address or name',
                    default: null
                },
                unreadOnly: {
                    type: 'boolean',
                    description: 'Only return unread emails (default: false)',
                    default: false
                },
                folder: folderProperty('Folder to search in (default: INBOX). Use list_folders to see available folders.')
            },
            required: []
        }
    },
    {
        name: 'delete_emails',
        description: 'Move emails to Trash folder using UIDs (soft delete, recoverable). UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to delete'),
                folder: folderProperty('Source folder (default: INBOX)')
            },
            required: ['uids']
        }
    },
    {
        name: 'archive_emails',
        description: 'Move emails to Archive folder using UIDs for long-term storage. UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to archive'),
                folder: folderProperty('Source folder (default: INBOX)')
            },
            required: ['uids']
        }
    },
    {
        name: 'mark_as_read',
        description: 'Mark emails as read using UIDs. UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to mark as read'),
                folder: folderProperty()
            },
            required: ['uids']
        }
    },
    {
        name: 'mark_as_unread',
        description: 'Mark emails as unread using UIDs. UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to mark as unread'),
                folder: folderProperty()
            },
            required: ['uids']
        }
    },
    {
        name: 'flag_emails',
        description: 'Flag emails as important/starred using UIDs. UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to flag'),
                folder: folderProperty()
            },
            required: ['uids']
        }
    },
    {
        name: 'unflag_emails',
        description: 'Remove flag/star from emails using UIDs. UIDs are permanent identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to unflag'),
                folder: folderProperty()
            },
            required: ['uids']
        }
    },
    {
        name: 'move_emails',
        description: 'Move emails to a specified folder using UIDs. UIDs are permanent identifiers. Use list_folders to see available folders.',
        inputSchema: {
            type: 'object',
            properties: {
                uids: uidsProperty('Array of UIDs to move'),
                folderName: {
                    type: 'string',
                    description: 'Name of the destination folder (e.g., "Work", "Personal"). Use list_folders to see available folders.'
                },
                sourceFolder: {
                    type: 'string',
                    description: 'Source folder containing the emails (default: INBOX)',
                    default: 'INBOX'
                }
            },
            required: ['uids', 'folderName']
        }
    },
    {
        name: 'list_folders',
        description: 'List all available IMAP folders/mailboxes in your Yahoo Mail account',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_filters',
        description: 'List Yahoo Mail server-side filters. Requires a Yahoo web session (YAHOO_WEB_COOKIE, YAHOO_WEB_WSSID, and YAHOO_WEB_MAILBOX_ID); an IMAP app password alone is not sufficient.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'create_filter',
        description: 'Create a Yahoo Mail server-side filter that moves matching incoming mail to an existing folder. Requires a Yahoo web session. New filters are added at the lowest priority.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Unique, human-readable filter name'
                },
                folderName: {
                    type: 'string',
                    description: 'Existing destination folder name, matched case-insensitively'
                },
                criteria: {
                    type: 'array',
                    minItems: 1,
                    description: 'Conditions combined with AND. Yahoo applies every condition in a filter.',
                    items: {
                        type: 'object',
                        properties: {
                            field: {
                                type: 'string',
                                enum: ['FROM', 'TOORCC', 'SUBJECT', 'BODY'],
                                description: 'Message field to match'
                            },
                            operator: {
                                type: 'string',
                                enum: ['CONTAINS', 'NOTCONTAINS', 'BEGINSWITH', 'ENDSWITH'],
                                description: 'Yahoo filter comparison operator'
                            },
                            value: {
                                type: 'string',
                                description: 'Non-empty text to match'
                            }
                        },
                        required: ['field', 'operator', 'value'],
                        additionalProperties: false
                    }
                }
            },
            required: ['name', 'folderName', 'criteria'],
            additionalProperties: false
        }
    }
];
