/**
 * Client for Yahoo Mail's undocumented web API.
 *
 * Yahoo's filter settings are not exposed through IMAP. The web client sends
 * requests to a same-origin batch endpoint authenticated by Yahoo browser
 * cookies plus a WSSID. Keep these credentials separate from the IMAP app
 * password: the browser session grants broader account access and expires.
 */

const DEFAULT_ENDPOINT = 'https://mail.yahoo.com/ws/v3/batch';
const DEFAULT_APP_ID = 'YMailNovation';

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name} is required`);
    }

    if (/[\r\n]/.test(value)) {
        throw new Error(`${name} contains invalid newline characters`);
    }

    return value;
}

/**
 * CRC32 implementation used by the current Yahoo Mail frontend to hash a
 * batch payload together with its WSSID, retry count, and request headers.
 */
export function crc32(value) {
    const table = new Int32Array(256);

    for (let index = 0; index < 256; index++) {
        let entry = index;
        for (let bit = 0; bit < 8; bit++) {
            entry = (entry & 1) ? (-306674912 ^ (entry >>> 1)) : (entry >>> 1);
        }
        table[index] = entry;
    }

    let checksum = -1;
    for (const byte of new TextEncoder().encode(value)) {
        checksum = (checksum >>> 8) ^ table[(checksum ^ byte) & 0xff];
    }

    return new Uint32Array([~checksum])[0].toString(16);
}

export function hashBatch(batch, wssid, retryCount = 0, requestHeaders = {}) {
    return crc32(
        JSON.stringify(batch) +
        JSON.stringify(wssid) +
        JSON.stringify(retryCount) +
        JSON.stringify(requestHeaders)
    );
}

function getYahooErrorCode(payload) {
    return payload?.error?.code ||
        payload?.code ||
        payload?.response?.error?.code ||
        null;
}

function getReissuedWssid(payload) {
    if (getYahooErrorCode(payload) !== 'EC-4003') return null;

    return payload?.error?.details?.wssid ||
        payload?.response?.error?.details?.wssid ||
        payload?.details?.wssid ||
        payload?.wssid ||
        null;
}

export class YahooWebClient {
    constructor({
        cookie,
        wssid,
        mailboxId,
        appId = DEFAULT_APP_ID,
        endpoint = DEFAULT_ENDPOINT,
        fetchImpl = globalThis.fetch
    }) {
        this.cookie = requireString(cookie, 'Yahoo web session cookie');
        this.wssid = requireString(wssid, 'Yahoo WSSID');
        this.mailboxId = requireString(mailboxId, 'Yahoo mailbox ID');
        this.appId = requireString(appId, 'Yahoo web app ID');
        this.fetchImpl = fetchImpl;

        if (typeof fetchImpl !== 'function') {
            throw new Error('A fetch implementation is required');
        }

        const endpointUrl = new URL(endpoint);
        if (endpointUrl.protocol !== 'https:' ||
            endpointUrl.hostname !== 'mail.yahoo.com' ||
            endpointUrl.pathname !== '/ws/v3/batch') {
            throw new Error('Yahoo web endpoint must be https://mail.yahoo.com/ws/v3/batch');
        }
        this.endpoint = endpointUrl;
    }

    static fromEnv() {
        return new YahooWebClient({
            cookie: process.env.YAHOO_WEB_COOKIE,
            wssid: process.env.YAHOO_WEB_WSSID,
            mailboxId: process.env.YAHOO_WEB_MAILBOX_ID,
            appId: process.env.YAHOO_WEB_APP_ID || DEFAULT_APP_ID
        });
    }

    async batch(name, requests, retryCount = 0) {
        const batch = {
            requests,
            responseType: 'json'
        };
        const requestHeaders = {};
        const url = new URL(this.endpoint);

        url.search = new URLSearchParams({
            name,
            hash: hashBatch(batch, this.wssid, retryCount, requestHeaders),
            appId: this.appId,
            ymreqid: crypto.randomUUID(),
            wssid: this.wssid,
            nonblocking: 'true',
            ...(retryCount > 0 ? { retryCount: String(retryCount) } : {})
        }).toString();

        const form = new FormData();
        form.set('batchJson', JSON.stringify(batch));

        let response;
        try {
            response = await this.fetchImpl(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Cookie: this.cookie
                },
                body: form,
                redirect: 'error'
            });
        } catch (error) {
            throw new Error(`Yahoo filter API request failed: ${error.message}`);
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error(`Yahoo filter API returned a non-JSON response (HTTP ${response.status})`);
        }

        const reissuedWssid = getReissuedWssid(payload);
        if (reissuedWssid && retryCount === 0) {
            this.wssid = requireString(reissuedWssid, 'Reissued Yahoo WSSID');
            return this.batch(name, requests, 1);
        }

        if (!response.ok) {
            const code = getYahooErrorCode(payload);
            const suffix = code ? `, ${code}` : '';
            throw new Error(`Yahoo filter API request failed (HTTP ${response.status}${suffix})`);
        }

        const responses = payload?.result?.responses;
        if (!Array.isArray(responses)) {
            const code = getYahooErrorCode(payload);
            const suffix = code ? ` (${code})` : '';
            throw new Error(`Yahoo filter API returned an unexpected response${suffix}`);
        }

        const failures = responses.filter(item => item.httpCode >= 400);
        if (failures.length > 0) {
            const failure = failures[0];
            const batchReissuedWssid = getReissuedWssid(failure);
            if (batchReissuedWssid && retryCount === 0) {
                this.wssid = requireString(batchReissuedWssid, 'Reissued Yahoo WSSID');
                return this.batch(name, requests, 1);
            }

            const code = getYahooErrorCode(failure);
            const suffix = code ? `, ${code}` : '';
            throw new Error(`Yahoo filter API operation "${failure.id}" failed (HTTP ${failure.httpCode}${suffix})`);
        }

        return new Map(responses.map(item => [item.id, item]));
    }
}
