/**
 * Read full email content by UID (supports batch reading).
 */

import { simpleParser } from 'mailparser';
import { createImapConnection, hasAttachments, validateUIDs, textResult } from '../imap.js';

export async function readEmails(uids, folder = 'INBOX') {
    // Support both a single number and an array
    if (!Array.isArray(uids)) {
        uids = [uids];
    }

    const validationError = validateUIDs(uids);
    if (validationError) {
        return textResult(`Error: ${validationError}`);
    }

    const imap = await createImapConnection();

    return new Promise((resolve, reject) => {
        imap.openBox(folder, true, (err) => {  // true = read-only mode
            if (err) {
                imap.end();
                reject(new Error(`Failed to open folder "${folder}": ${err.message}`));
                return;
            }

            const source = uids.join(',');

            // Use imap.fetch() (NOT imap.seq.fetch) for UID-based fetch
            const fetch = imap.fetch(source, {
                bodies: '',
                struct: true
            });

            const emails = [];
            const foundUIDs = new Set();
            const parsePromises = [];

            fetch.on('message', (msg, seqno) => {
                let buffer = '';
                let attrs = null;

                msg.on('body', (stream) => {
                    stream.on('data', (chunk) => {
                        buffer += chunk.toString('ascii');
                    });
                });

                msg.once('attributes', (attributes) => {
                    attrs = attributes;
                    foundUIDs.add(attributes.uid);
                });

                msg.once('end', () => {
                    parsePromises.push(new Promise((resolveParse) => {
                        simpleParser(buffer, (err, parsed) => {
                            if (err) {
                                console.error('Error parsing email:', err);
                                resolveParse();
                                return;
                            }

                            emails.push({
                                uid: attrs.uid,
                                sequenceNumber: seqno,
                                from: parsed.from?.text || 'Unknown',
                                to: parsed.to?.text || 'Unknown',
                                subject: parsed.subject || 'No Subject',
                                date: parsed.date || 'Unknown Date',
                                size: attrs.size || 0,
                                flags: attrs.flags || [],
                                hasAttachments: hasAttachments(attrs.struct),
                                content: parsed.text || parsed.html || 'No content available'
                            });
                            resolveParse();
                        });
                    }));
                });
            });

            fetch.once('error', (err) => {
                imap.end();
                reject(err);
            });

            fetch.once('end', async () => {
                imap.end();

                // Wait for all async email parsing to finish
                await Promise.all(parsePromises);

                const missingUIDs = uids.filter(uid => !foundUIDs.has(uid));
                if (missingUIDs.length > 0) {
                    reject(new Error(
                        `UIDs not found: ${missingUIDs.join(', ')}. ` +
                        `Found ${emails.length} of ${uids.length} requested emails. ` +
                        `Missing UIDs may have been deleted or moved to another folder.`
                    ));
                    return;
                }

                // Sort by UID for consistent output
                emails.sort((a, b) => a.uid - b.uid);

                const emailContent = emails.map(email =>
                    `📧 Email UID: ${email.uid} (Seq #${email.sequenceNumber})\n\n` +
                    `From: ${email.from}\n` +
                    `To: ${email.to}\n` +
                    `Subject: ${email.subject}\n` +
                    `Date: ${email.date}\n` +
                    `Size: ${email.size} bytes\n` +
                    `Flags: ${email.flags.join(', ') || 'None'}\n` +
                    `Has Attachments: ${email.hasAttachments ? 'Yes' : 'No'}\n\n` +
                    `--- Content ---\n` +
                    `${email.content}`
                ).join('\n\n' + '='.repeat(80) + '\n\n');

                resolve(textResult(emailContent));
            });
        });
    });
}
