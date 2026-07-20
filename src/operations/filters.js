/**
 * Yahoo Mail filter operations using the undocumented web API.
 */

import { jsonResult } from '../imap.js';
import { YahooWebClient } from '../yahoo-web.js';

const FILTER_PRIORITY_MIN = 1500;
const FILTER_PRIORITY_MAX = 1999;
const MAX_FILTERS = 500;

const FIELD_TO_QUERY = {
    FROM: 'from',
    TOORCC: 'to',
    SUBJECT: 'subject',
    BODY: 'body'
};

const VALID_OPERATORS = new Set([
    'CONTAINS',
    'NOTCONTAINS',
    'BEGINSWITH',
    'ENDSWITH'
]);

function escapeQueryValue(value) {
    return value.replace(/([\\+\-!(){}[\]^"~*?:/\t])/g, '\\$1');
}

function unescapeQueryValue(value) {
    return value.replace(/\\(.)/g, '$1');
}

function formatCriterionValue(operator, value) {
    const escaped = escapeQueryValue(value);

    switch (operator) {
        case 'CONTAINS':
            return `"*${escaped}*"`;
        case 'NOTCONTAINS':
            return `"${escaped}"`;
        case 'BEGINSWITH':
            return `"${escaped}*"`;
        case 'ENDSWITH':
            return `"*${escaped}"`;
        default:
            throw new Error(`Unsupported filter operator: ${operator}`);
    }
}

export function buildFilterQuery(criteria, accountId = '1') {
    if (!Array.isArray(criteria) || criteria.length === 0) {
        throw new Error('criteria must contain at least one condition');
    }

    const clauses = criteria.map((criterion, index) => {
        const field = String(criterion?.field || '').toUpperCase();
        const operator = String(criterion?.operator || '').toUpperCase();
        const value = criterion?.value;

        if (!FIELD_TO_QUERY[field]) {
            throw new Error(`criteria[${index}].field must be FROM, TOORCC, SUBJECT, or BODY`);
        }
        if (!VALID_OPERATORS.has(operator)) {
            throw new Error(`criteria[${index}].operator must be CONTAINS, NOTCONTAINS, BEGINSWITH, or ENDSWITH`);
        }
        if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`criteria[${index}].value must be a non-empty string`);
        }

        const formattedValue = formatCriterionValue(operator, value);

        if (field === 'TOORCC') {
            return operator === 'NOTCONTAINS'
                ? `(-to:${formattedValue} OR -cc:${formattedValue})`
                : `(to:${formattedValue} OR cc:${formattedValue})`;
        }

        const queryField = FIELD_TO_QUERY[field];
        return operator === 'NOTCONTAINS'
            ? `-${queryField}:${formattedValue}`
            : `${queryField}:${formattedValue}`;
    });

    return `acctid:${accountId || '1'} AND (${clauses.join(' AND ')})`;
}

function operatorFromLiteral(literal, isNegative) {
    if (isNegative) return 'NOTCONTAINS';
    if (literal.startsWith('*') && literal.endsWith('*')) return 'CONTAINS';
    if (literal.endsWith('*')) return 'BEGINSWITH';
    if (literal.startsWith('*')) return 'ENDSWITH';
    return 'CONTAINS';
}

function stripOperatorWildcards(literal, operator) {
    switch (operator) {
        case 'CONTAINS':
            return literal.startsWith('*') && literal.endsWith('*')
                ? literal.slice(1, -1)
                : literal;
        case 'BEGINSWITH':
            return literal.slice(0, -1);
        case 'ENDSWITH':
            return literal.slice(1);
        default:
            return literal;
    }
}

export function parseFilterQuery(query = '') {
    const matches = [];
    const pattern = /(-?)(from|to|cc|subject|body):"((?:\\.|[^"])*)"/gi;
    let match;

    while ((match = pattern.exec(query)) !== null) {
        const [, negative, queryField, literal] = match;
        const normalizedField = queryField.toLowerCase();
        const operator = operatorFromLiteral(literal, negative === '-');
        const value = unescapeQueryValue(stripOperatorWildcards(literal, operator));

        if ((normalizedField === 'to' || normalizedField === 'cc') &&
            matches.some(item =>
                item.field === 'TOORCC' &&
                item.operator === operator &&
                item.value === value
            )) {
            continue;
        }

        matches.push({
            field: normalizedField === 'to' || normalizedField === 'cc'
                ? 'TOORCC'
                : normalizedField.toUpperCase(),
            operator,
            value
        });
    }

    return matches;
}

function getResult(response, collectionName) {
    const result = response?.response?.result;
    if (!result || !Array.isArray(result[collectionName])) {
        throw new Error(`Yahoo filter API response is missing ${collectionName}`);
    }
    return result[collectionName];
}

function isUserFilter(savedSearch) {
    return savedSearch.id !== 'fOOS' &&
        !savedSearch.name?.startsWith('RecentSearchQueries') &&
        savedSearch.types?.[0] === 'USER' &&
        savedSearch.priority >= FILTER_PRIORITY_MIN &&
        savedSearch.priority <= FILTER_PRIORITY_MAX &&
        savedSearch.decorations?.length > 0;
}

function mapFilter(savedSearch, foldersById) {
    const decorationId = savedSearch.decorations?.[0]?.id || '';
    const folderId = decorationId.startsWith('F') ? decorationId.slice(1) : '';
    const folder = foldersById.get(folderId);

    return {
        id: savedSearch.id,
        name: savedSearch.name,
        priority: savedSearch.priority,
        criteria: parseFilterQuery(savedSearch.query),
        destination: {
            id: folderId || null,
            name: folder?.name || null
        },
        rawQuery: savedSearch.query
    };
}

async function fetchFiltersAndFolders(client) {
    const mailboxId = client.mailboxId;
    const responses = await client.batch('savedSearches.getMessageFilters', [
        {
            id: 'GetMessageFilters',
            uri: `/ws/v3/mailboxes/@.id==${mailboxId}/savedsearches`,
            method: 'GET',
            payload: {}
        },
        {
            id: 'GetFolders',
            uri: `/ws/v3/mailboxes/@.id==${mailboxId}/folders`,
            method: 'GET',
            payloadType: 'embedded'
        }
    ]);

    const savedSearches = getResult(responses.get('GetMessageFilters'), 'savedSearches');
    const folders = getResult(responses.get('GetFolders'), 'folders');

    return {
        filters: savedSearches.filter(isUserFilter).sort((a, b) => a.priority - b.priority),
        folders
    };
}

export async function listFilters(client = YahooWebClient.fromEnv()) {
    const { filters, folders } = await fetchFiltersAndFolders(client);
    const foldersById = new Map(folders.map(folder => [String(folder.id), folder]));

    return jsonResult({
        filters: filters.map(filter => mapFilter(filter, foldersById)),
        count: filters.length,
        limit: MAX_FILTERS
    });
}

export async function createFilter({
    name,
    folderName,
    criteria
}, client = YahooWebClient.fromEnv()) {
    if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('name is required');
    }
    if (typeof folderName !== 'string' || folderName.trim() === '') {
        throw new Error('folderName is required');
    }

    const { filters, folders } = await fetchFiltersAndFolders(client);
    if (filters.length >= MAX_FILTERS) {
        throw new Error(`Yahoo Mail allows at most ${MAX_FILTERS} filters`);
    }

    const matchingFolders = folders.filter(folder =>
        folder.name?.toLocaleLowerCase() === folderName.trim().toLocaleLowerCase()
    );
    if (matchingFolders.length === 0) {
        throw new Error(`Yahoo Mail folder "${folderName}" was not found`);
    }
    if (matchingFolders.length > 1) {
        throw new Error(`Yahoo Mail folder name "${folderName}" is ambiguous`);
    }

    const folder = matchingFolders[0];
    const priority = Math.max(
        FILTER_PRIORITY_MIN - 1,
        ...filters.map(filter => filter.priority)
    ) + 1;

    if (priority > FILTER_PRIORITY_MAX) {
        throw new Error('Yahoo Mail has no remaining filter-priority slots');
    }

    const query = buildFilterQuery(criteria, String(folder.acctId || '1'));
    const requestId = `createFilter_${priority}`;
    const responses = await client.batch('savedSearches.saveMessageFilters', [
        {
            id: requestId,
            uri: `/ws/v3/mailboxes/@.id==${client.mailboxId}/savedsearches`,
            method: 'POST',
            payload: {
                savedSearch: {
                    name: name.trim(),
                    query,
                    priority,
                    types: ['USER'],
                    decorations: [{
                        id: `F${folder.id}`,
                        type: 'FOLDER'
                    }]
                }
            }
        }
    ]);

    const created = responses.get(requestId)?.response?.result;
    return jsonResult({
        created: true,
        filter: {
            id: created?.id || null,
            name: name.trim(),
            priority,
            criteria,
            destination: {
                id: String(folder.id),
                name: folder.name
            },
            rawQuery: query
        }
    });
}
