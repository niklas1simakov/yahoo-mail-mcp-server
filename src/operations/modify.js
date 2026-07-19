/**
 * Batch email modification operations (flags, delete, archive, move).
 * All operations use UIDs (permanent identifiers).
 */

import { createImapConnection, validateUIDs, textResult } from '../imap.js';

/**
 * Shared helper: open a folder read-write and apply an operation to each UID,
 * collecting successes and failures.
 */
async function modifyEmails(uids, operation, operationName, folder = 'INBOX') {
    const validationError = validateUIDs(uids);
    if (validationError) {
        return textResult(`Error: ${validationError}`);
    }

    const imap = await createImapConnection();

    return new Promise((resolve, reject) => {
        imap.openBox(folder, false, (err) => {  // false = read-write mode
            if (err) {
                imap.end();
                reject(new Error(`Failed to open folder "${folder}": ${err.message}`));
                return;
            }

            const successfulUIDs = [];
            const failedUIDs = [];
            let processedCount = 0;

            // Process each UID individually so one failure doesn't stop the rest
            const processNextUID = () => {
                if (processedCount >= uids.length) {
                    imap.end();

                    if (failedUIDs.length === uids.length) {
                        reject(new Error(`Failed to ${operationName} ${failedUIDs.length} email(s). UIDs may not exist: ${failedUIDs.join(', ')}`));
                    } else if (successfulUIDs.length > 0) {
                        const message = failedUIDs.length > 0
                            ? `Successfully ${operationName} ${successfulUIDs.length} of ${uids.length} email(s). ` +
                              `Successful: ${successfulUIDs.join(', ')}. Failed: ${failedUIDs.join(', ')}`
                            : `Successfully ${operationName} ${successfulUIDs.length} email(s) with UIDs: ${successfulUIDs.join(', ')}`;

                        resolve(textResult(message));
                    } else {
                        reject(new Error(`Failed to ${operationName} any emails`));
                    }
                    return;
                }

                const uid = uids[processedCount];
                processedCount++;

                operation(imap, uid.toString(), (err) => {
                    if (err) {
                        console.error(`[UID ${uid}] Failed to ${operationName}:`, err.message);
                        failedUIDs.push(uid);
                    } else {
                        successfulUIDs.push(uid);
                    }

                    processNextUID();
                });
            };

            processNextUID();
        });
    });
}

/** Mark emails as read. */
export function markAsRead(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.addFlags(source, '\\Seen', callback),
        'marked as read',
        folder
    );
}

/** Mark emails as unread. */
export function markAsUnread(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.delFlags(source, '\\Seen', callback),
        'marked as unread',
        folder
    );
}

/** Flag emails as important/starred. */
export function flagEmails(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.addFlags(source, '\\Flagged', callback),
        'flagged',
        folder
    );
}

/** Remove flag/star from emails. */
export function unflagEmails(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.delFlags(source, '\\Flagged', callback),
        'unflagged',
        folder
    );
}

/** Delete emails (soft delete: move to Trash, recoverable). */
export function deleteEmails(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.move(source, 'Trash', callback),
        'moved to Trash',
        folder
    );
}

/** Archive emails (move to Archive folder). */
export function archiveEmails(uids, folder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.move(source, 'Archive', callback),
        'archived',
        folder
    );
}

/** Move emails to a specific folder. */
export function moveEmails(uids, folderName, sourceFolder = 'INBOX') {
    return modifyEmails(
        uids,
        (imap, source, callback) => imap.move(source, folderName, callback),
        `moved to ${folderName}`,
        sourceFolder
    );
}
