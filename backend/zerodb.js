/**
 * ZeroDB client - thin wrapper around the ZeroDB REST API
 */

const API_KEY = process.env.ZERODB_API_KEY;
const PROJECT_ID = process.env.ZERODB_PROJECT_ID;
const BASE = process.env.ZERODB_BASE_URL || 'https://api.ainative.studio/api/v1';

const TABLES_URL = `${BASE}/projects/${PROJECT_ID}/database/tables`;

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

async function request(url, method = 'GET', body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ZeroDB ${method} ${url} failed (${res.status}): ${err}`);
  }
  return res.json();
}

const zerodb = {
  // Insert a row into a table
  async insert(table, rowData) {
    return request(`${TABLES_URL}/${table}/rows`, 'POST', { row_data: rowData });
  },

  // Query rows with MongoDB-style filters
  async query(table, filters = {}, { limit = 100, skip = 0, sort = null } = {}) {
    const body = { filters, limit, skip };
    if (sort) body.sort = sort;
    const result = await request(`${TABLES_URL}/${table}/query`, 'POST', body);
    // Normalize: API returns "data", we expose as "rows"
    if (result.data && !result.rows) {
      result.rows = result.data;
    }
    return result;
  },

  // Get a single row by ID
  async getRow(table, rowId) {
    return request(`${TABLES_URL}/${table}/rows/${rowId}`);
  },

  // Update a row by ID
  async update(table, rowId, rowData) {
    return request(`${TABLES_URL}/${table}/rows/${rowId}`, 'PUT', { row_data: rowData });
  },

  // Bulk update with filter
  async bulkUpdate(table, filter, update) {
    return request(`${TABLES_URL}/${table}/rows/bulk`, 'PUT', { filter, update });
  },

  // Delete a row by ID
  async deleteRow(table, rowId) {
    return request(`${TABLES_URL}/${table}/rows/${rowId}`, 'DELETE');
  },

  // List all rows (paginated)
  async listRows(table, limit = 100, skip = 0) {
    return request(`${TABLES_URL}/${table}/rows?limit=${limit}&skip=${skip}`);
  },
};

module.exports = zerodb;
