/**
 * Search emails with advanced filters.
 */

import Imap from 'imap';
import { createImapConnection, hasAttachments, textResult, jsonResult } from '../imap.js';

export async function searchEmails(query, options = {}) {
    const {
        count = 10,
        dateFrom = null,
        dateTo = null,
        sender = null,
        unreadOnly = false,
        folder = 'INBOX'
    } = options;

    if (query === undefined || query === null) {
        return textResult('Error: query is required (use empty string "" for searches without text criteria)');
    }

    if (count < 1) {
        return textResult('Error: count must be at least 1');
    }

    const imap = await createImapConnection();

    return new Promise((resolve, reject) => {
        imap.openBox(folder, true, (err) => {
            if (err) {
                imap.end();
                reject(new Error(`Failed to open folder "${folder}": ${err.message}`));
                return;
            }

            // Build search criteria
            const criteria = [];

            // Text search (subject or from)
            if (query && query.trim().length > 0) {
                criteria.push([
                    'OR',
                    ['HEADER', 'SUBJECT', query],
                    ['HEADER', 'FROM', query]
                ]);
            }

            // Sender filter
            if (sender && sender.trim().length > 0) {
                criteria.push(['HEADER', 'FROM', sender]);
            }

            // Date range filters
            if (dateFrom) {
                const fromDate = new Date(dateFrom);
                if (isNaN(fromDate.getTime())) {
                    imap.end();
                    reject(new Error(`Invalid dateFrom format: ${dateFrom}. Use ISO 8601 format.`));
                    return;
                }
                criteria.push(['SINCE', fromDate]);
            }

            if (dateTo) {
                const toDate = new Date(dateTo);
                if (isNaN(toDate.getTime())) {
                    imap.end();
                    reject(new Error(`Invalid dateTo format: ${dateTo}. Use ISO 8601 format.`));
                    return;
                }
                criteria.push(['BEFORE', toDate]);
            }

            if (unreadOnly) {
                criteria.push('UNSEEN');
            }

            if (criteria.length === 0) {
                criteria.push('ALL');
            }

            // imap.search() returns UIDs by default (NOT sequence numbers)
            imap.search(criteria, (err, results) => {
                if (err) {
                    imap.end();
                    reject(err);
                    return;
                }

                if (!results || results.length === 0) {
                    imap.end();
                    resolve(jsonResult({
                        emails: [],
                        totalMatches: 0,
                        query: query,
                        filters: options,
                        folder: folder
                    }));
                    return;
                }

                // Get the most recent results (UIDs are already sorted)
                const limitedResults = results.slice(-count);

                const fetch = imap.fetch(limitedResults, {
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
                            uid: attrs.uid,
                            sequenceNumber: seqno,
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

                    // Sort by UID (newest first typically)
                    emails.sort((a, b) => b.uid - a.uid);

                    resolve(jsonResult({
                        emails: emails,
                        totalMatches: results.length,
                        returned: emails.length,
                        query: query,
                        filters: options,
                        folder: folder
                    }));
                });
            });
        });
    });
}
