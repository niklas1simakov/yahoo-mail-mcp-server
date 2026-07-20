import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFilterQuery,
    createFilter,
    listFilters,
    parseFilterQuery
} from '../src/operations/filters.js';
import { hashBatch, YahooWebClient } from '../src/yahoo-web.js';

test('buildFilterQuery matches Yahoo saved-search syntax', () => {
    const query = buildFilterQuery([
        { field: 'FROM', operator: 'CONTAINS', value: 'billing@example.com' },
        { field: 'SUBJECT', operator: 'NOTCONTAINS', value: 'test' },
        { field: 'TOORCC', operator: 'ENDSWITH', value: '@example.org' }
    ], '7');

    assert.equal(
        query,
        'acctid:7 AND (from:"*billing@example.com*" AND -subject:"test" AND (to:"*@example.org" OR cc:"*@example.org"))'
    );
});

test('parseFilterQuery coalesces Yahoo to/cc pairs', () => {
    assert.deepEqual(
        parseFilterQuery('acctid:1 AND ((-to:"internal" OR -cc:"internal") AND body:"hello*")'),
        [
            { field: 'TOORCC', operator: 'NOTCONTAINS', value: 'internal' },
            { field: 'BODY', operator: 'BEGINSWITH', value: 'hello' }
        ]
    );
});

test('hashBatch is deterministic and changes with WSSID', () => {
    const batch = { requests: [], responseType: 'json' };
    assert.equal(hashBatch(batch, 'one'), hashBatch(batch, 'one'));
    assert.notEqual(hashBatch(batch, 'one'), hashBatch(batch, 'two'));
});

function mockClient() {
    return {
        mailboxId: 'mailbox-1',
        calls: [],
        async batch(name, requests) {
            this.calls.push({ name, requests });

            if (name === 'savedSearches.getMessageFilters') {
                return new Map([
                    ['GetMessageFilters', {
                        httpCode: 200,
                        response: {
                            result: {
                                savedSearches: [{
                                    id: 'filter-1',
                                    name: 'Invoices',
                                    priority: 1500,
                                    query: 'acctid:1 AND (from:"*billing@example.com*")',
                                    types: ['USER'],
                                    decorations: [{ id: 'Ffolder-1', type: 'FOLDER' }]
                                }]
                            }
                        }
                    }],
                    ['GetFolders', {
                        httpCode: 200,
                        response: {
                            result: {
                                folders: [{
                                    id: 'folder-1',
                                    acctId: '1',
                                    name: 'Finance',
                                    types: ['USER']
                                }]
                            }
                        }
                    }]
                ]);
            }

            return new Map([
                ['createFilter_1501', {
                    httpCode: 200,
                    response: { result: { id: 'filter-2' } }
                }]
            ]);
        }
    };
}

test('listFilters maps saved searches to MCP output', async () => {
    const result = await listFilters(mockClient());
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.filters[0].destination.name, 'Finance');
    assert.deepEqual(parsed.filters[0].criteria, [
        { field: 'FROM', operator: 'CONTAINS', value: 'billing@example.com' }
    ]);
});

test('createFilter resolves the folder and appends at lowest priority', async () => {
    const client = mockClient();
    const result = await createFilter({
        name: 'Receipts',
        folderName: 'finance',
        criteria: [{ field: 'SUBJECT', operator: 'CONTAINS', value: 'receipt' }]
    }, client);
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.created, true);
    assert.equal(parsed.filter.id, 'filter-2');
    assert.equal(parsed.filter.priority, 1501);

    const createRequest = client.calls[1].requests[0];
    assert.equal(createRequest.payload.savedSearch.decorations[0].id, 'Ffolder-1');
    assert.equal(
        createRequest.payload.savedSearch.query,
        'acctid:1 AND (subject:"*receipt*")'
    );
});

test('YahooWebClient refuses to send a session cookie to another host', () => {
    assert.throws(
        () => new YahooWebClient({
            cookie: 'A=secret',
            wssid: 'session',
            mailboxId: 'mailbox',
            endpoint: 'https://example.com/ws/v3/batch'
        }),
        /must be https:\/\/mail\.yahoo\.com/
    );
});

test('YahooWebClient sends a hashed multipart batch to Yahoo only', async () => {
    let captured;
    const client = new YahooWebClient({
        cookie: 'A=secret; B=session',
        wssid: 'wssid-1',
        mailboxId: 'mailbox-1',
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return new Response(JSON.stringify({
                result: {
                    responses: [{
                        id: 'GetMessageFilters',
                        httpCode: 200,
                        response: { result: { savedSearches: [] } }
                    }]
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

    const requests = [{
        id: 'GetMessageFilters',
        uri: '/ws/v3/mailboxes/@.id==mailbox-1/savedsearches',
        method: 'GET'
    }];
    const responses = await client.batch('savedSearches.getMessageFilters', requests);
    const url = new URL(captured.url);
    const sentBatch = JSON.parse(captured.options.body.get('batchJson'));

    assert.equal(url.origin, 'https://mail.yahoo.com');
    assert.equal(url.searchParams.get('name'), 'savedSearches.getMessageFilters');
    assert.equal(url.searchParams.get('wssid'), 'wssid-1');
    assert.equal(
        url.searchParams.get('hash'),
        hashBatch(sentBatch, 'wssid-1')
    );
    assert.equal(captured.options.headers.Cookie, 'A=secret; B=session');
    assert.equal(responses.get('GetMessageFilters').httpCode, 200);
});

test('YahooWebClient retries once when Yahoo reissues the WSSID', async () => {
    let requestCount = 0;
    const client = new YahooWebClient({
        cookie: 'A=secret',
        wssid: 'old-wssid',
        mailboxId: 'mailbox-1',
        fetchImpl: async () => {
            requestCount++;
            const responses = requestCount === 1
                ? [{
                    id: 'GetMessageFilters',
                    httpCode: 400,
                    response: {
                        error: {
                            code: 'EC-4003',
                            details: { wssid: 'new-wssid' }
                        }
                    }
                }]
                : [{
                    id: 'GetMessageFilters',
                    httpCode: 200,
                    response: { result: { savedSearches: [] } }
                }];

            return new Response(JSON.stringify({ result: { responses } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

    await client.batch('savedSearches.getMessageFilters', [{
        id: 'GetMessageFilters',
        uri: '/ws/v3/mailboxes/@.id==mailbox-1/savedsearches',
        method: 'GET'
    }]);

    assert.equal(requestCount, 2);
    assert.equal(client.wssid, 'new-wssid');
});
