/**
 * IMAP connection handling and shared helpers for Yahoo Mail.
 */

import Imap from 'imap';

/**
 * Create a fresh IMAP connection to Yahoo Mail using an app-specific password.
 * The caller is responsible for calling imap.end() when done.
 */
export function createImapConnection() {
    return new Promise((resolve, reject) => {
        if (!process.env.YAHOO_EMAIL || !process.env.YAHOO_APP_PASSWORD) {
            reject(new Error('YAHOO_EMAIL or YAHOO_APP_PASSWORD environment variables are not set'));
            return;
        }

        const imap = new Imap({
            user: process.env.YAHOO_EMAIL,
            password: process.env.YAHOO_APP_PASSWORD,
            host: 'imap.mail.yahoo.com',
            port: 993,
            tls: true,
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: {
                rejectUnauthorized: true,
                servername: 'imap.mail.yahoo.com',
                minVersion: 'TLSv1.2'
            }
        });

        const connectionTimeout = setTimeout(() => {
            console.error('[IMAP] Connection timeout after 35 seconds');
            imap.end();
            reject(new Error('Connection to Yahoo Mail timed out. Please try again.'));
        }, 35000);

        imap.once('ready', () => {
            clearTimeout(connectionTimeout);
            resolve(imap);
        });

        imap.once('error', (err) => {
            clearTimeout(connectionTimeout);
            console.error('[IMAP] Connection error:', err.message);

            let errorMessage = err.message;

            if (err.message.includes('Invalid credentials') ||
                err.message.includes('authentication failed') ||
                err.message.includes('AUTHENTICATIONFAILED')) {
                errorMessage = `Authentication failed: ${err.message}. Please check your Yahoo Mail app password. Regenerate at https://login.yahoo.com/account/security`;
            } else if (err.message.includes('ENOTFOUND') ||
                       err.message.includes('ECONNREFUSED') ||
                       err.message.includes('ETIMEDOUT') ||
                       err.message.includes('getaddrinfo')) {
                errorMessage = `Cannot connect to Yahoo Mail servers: ${err.message}. Check internet connection.`;
            } else if (err.message.includes('Timed out') ||
                       err.message.includes('timeout')) {
                errorMessage = `Connection timed out: ${err.message}. Please try again.`;
            }

            reject(new Error(errorMessage));
        });

        imap.connect();
    });
}

/**
 * Detect if an email has attachments from its BODYSTRUCTURE.
 */
export function hasAttachments(struct) {
    if (!struct || !Array.isArray(struct)) return false;

    const checkPart = (part) => {
        if (!part) return false;

        if (part.disposition && part.disposition.type === 'attachment') {
            return true;
        }

        if (Array.isArray(part)) {
            return part.some(p => checkPart(p));
        }

        return false;
    };

    return checkPart(struct);
}

/**
 * Flatten a nested IMAP folder structure into a flat list.
 */
export function flattenFolders(boxes, parent = null) {
    const result = [];

    for (const [name, box] of Object.entries(boxes)) {
        const fullName = parent ? `${parent}/${name}` : name;

        // NOSELECT folders can't be opened
        const isNoSelect = box.attribs && box.attribs.includes('\\Noselect');

        result.push({
            name: fullName,
            delimiter: box.delimiter || '/',
            flags: box.attribs || [],
            selectable: !isNoSelect
        });

        if (box.children) {
            result.push(...flattenFolders(box.children, fullName));
        }
    }

    return result;
}

/**
 * Validate a UIDs array.
 * @returns {string|null} Error message if invalid, null if valid.
 */
export function validateUIDs(uids) {
    if (!uids) {
        return 'uids is required';
    }

    if (!Array.isArray(uids)) {
        return 'uids must be an array';
    }

    if (uids.length === 0) {
        return 'uids cannot be empty';
    }

    const invalidValues = uids.filter(n =>
        n === undefined ||
        n === null ||
        typeof n !== 'number' ||
        n <= 0 ||
        !Number.isInteger(n)
    );

    if (invalidValues.length > 0) {
        return 'uids contains invalid values (must be positive integers)';
    }

    return null;
}

/**
 * Wrap plain text in an MCP text-content result.
 */
export function textResult(text) {
    return {
        content: [{ type: 'text', text }]
    };
}

/**
 * Wrap a JSON-serializable value in an MCP text-content result.
 */
export function jsonResult(value) {
    return textResult(JSON.stringify(value, null, 2));
}
