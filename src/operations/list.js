/**
 * List recent emails from a folder with enriched metadata.
 */

import Imap from 'imap';
import { createImapConnection, hasAttachments, textResult, jsonResult } from '../imap.js';

export async function listEmails(count = 10, folder = 'INBOX', offset = 0) {
    if (count < 1) {
        return textResult('Error: count must be at least 1');
    }

    if (count > 50) {
        return textResult('Error: count cannot exceed 50 (use search or filters for larger results)');
    }

    if (offset < 0) {
        return textResult('Error: offset must be non-negative');
    }

    const imap = await createImapConnection();

    return new Promise((resolve, reject) => {
        imap.openBox(folder, true, (err, box) => {
            if (err) {
                imap.end();
                reject(new Error(`Failed to open folder "${folder}": ${err.message}`));
                return;
            }

            const total = box.messages.total;

            if (total === 0) {
                imap.end();
                resolve(jsonResult({
                    emails: [],
                    totalCount: 0,
                    offset: 0,
                    limit: count,
                    folder: folder
                }));
                return;
            }

            // Calculate range with offset
            // If total=100, offset=10, count=10: fetch messages 81-90 (reversed for newest first)
            const startSeq = Math.max(1, total - offset - count + 1);
            const endSeq = Math.max(1, total - offset);

            if (startSeq > endSeq) {
                imap.end();
                resolve(jsonResult({
                    emails: [],
                    totalCount: total,
                    offset: offset,
                    limit: count,
                    folder: folder,
                    message: 'Offset exceeds available messages'
                }));
                return;
            }

            const fetch = imap.seq.fetch(`${startSeq}:${endSeq}`, {
                bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
                struct: true
            });

            const emails = [];

            fetch.on('message', (msg, seqno) => {
                let header = '';
                let attrs = null;

                msg.on('body', (stream) => {
                    stream.on('data', (chunk) => {
                        header += chunk.toString('ascii');
                    });
                });

                msg.once('attributes', (attributes) => {
                    attrs = attributes;
                });

                msg.once('end', () => {
                    const parsed = Imap.parseHeader(header);

                    emails.push({
                        uid: attrs.uid,                          // Permanent UID
                        sequenceNumber: seqno,                   // Legacy reference
                        from: parsed.from?.[0] || 'Unknown',
                        subject: parsed.subject?.[0] || 'No Subject',
                        date: parsed.date?.[0] || 'Unknown Date',
                        size: attrs.size || 0,
                        flags: attrs.flags || [],
                        hasAttachments: hasAttachments(attrs.struct)
                    });
                });
            });

            fetch.once('error', (err) => {
                imap.end();
                reject(err);
            });

            fetch.once('end', () => {
                imap.end();

                // Sort by sequence number (newest first)
                emails.sort((a, b) => b.sequenceNumber - a.sequenceNumber);

                resolve(jsonResult({
                    emails: emails,
                    totalCount: total,
                    offset: offset,
                    limit: count,
                    folder: folder
                }));
            });
        });
    });
}
