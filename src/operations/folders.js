/**
 * List all available IMAP folders/mailboxes.
 */

import { createImapConnection, flattenFolders, jsonResult } from '../imap.js';

export async function listFolders() {
    const imap = await createImapConnection();

    return new Promise((resolve, reject) => {
        imap.getBoxes((err, boxes) => {
            imap.end();

            if (err) {
                reject(new Error(`Failed to retrieve folders: ${err.message}`));
                return;
            }

            const folders = flattenFolders(boxes);

            resolve(jsonResult({
                folders: folders,
                count: folders.length
            }));
        });
    });
}
