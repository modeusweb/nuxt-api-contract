import type { AnyApiContract } from '../runtime/shared/types'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

interface ContractRow {
  label: string
  method: string
  path: string
  params: string[]
  tags: readonly string[]
  errorCodes: string[]
}

function contractRows(contracts: AnyApiContract[]): ContractRow[] {
  return contracts
    .map((contract) => {
      const params = [...contract.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!)
      return {
        label: contract.name ?? '(anonymous)',
        method: contract.method,
        path: contract.path,
        params,
        tags: contract.tags ?? [],
        errorCodes: contract.errors ? Object.keys(contract.errors) : [],
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/** Document head + styles for the DevTools panel page. */
const PANEL_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Contracts</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; background: #15151a; color: #e4e4e9; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .muted { color: #8b8b98; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2a33; vertical-align: top; }
    th { color: #8b8b98; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
    .path { font-family: ui-monospace, monospace; }
    .method { display: inline-block; min-width: 58px; padding: 1px 8px; border-radius: 999px; font: 600 11px/1.6 ui-monospace, monospace; text-align: center; background: #33333d; }
    .method-get { background: #143d2b; color: #6ee7a2; }
    .method-post { background: #12344d; color: #74c0fc; }
    .method-put, .method-patch { background: #4d3a12; color: #ffd43b; }
    .method-delete { background: #4d1a1a; color: #ff8787; }
    .tag { display: inline-block; padding: 1px 8px; border-radius: 4px; background: #2a2a33; font-size: 12px; }
    code { font-family: ui-monospace, monospace; font-size: 12px; color: #b197fc; }
    .panel { border: 1px solid #2a2a33; border-radius: 8px; padding: 16px; background: #1c1c22; }
    .panel h2 { margin: 0 0 12px; font-size: 15px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; align-items: center; }
    select, input, button { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid #3a3a45; background: #15151a; color: inherit; }
    select { min-width: 320px; }
    button.primary { background: #4c6ef5; border-color: #4c6ef5; color: #fff; cursor: pointer; }
    label { display: inline-flex; gap: 6px; align-items: center; font-family: ui-monospace, monospace; font-size: 13px; }
    input { width: 180px; }
    pre { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: #15151a; border: 1px solid #2a2a33; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
    #status { font-family: ui-monospace, monospace; }
    .status-ok { color: #6ee7a2; }
    .status-error { color: #ff8787; }
    .status-invalid { color: #ffd43b; }
    .empty { color: #8b8b98; font-style: italic; }
  </style>
</head>
<body>
  <h1>API Contracts</h1>
  <p class="muted">`
/** "Try request" panel + page bootstrap. Receives the escaped JSON data set. */
function PANEL_FOOT(data: string): string {
  return `  <div class="panel">
    <h2>Try request</h2>
    <div class="row">
      <select id="op" aria-label="Contract"></select>
      <button class="primary" id="send" type="button">Send</button>
      <span id="status"></span>
    </div>
    <div class="row" id="params"></div>
    <pre id="out" class="empty">Response will appear here.</pre>
  </div>
  <script>
    const CONTRACTS = ${data};
    const select = document.getElementById('op');
    const paramsEl = document.getElementById('params');
    const out = document.getElementById('out');
    const statusEl = document.getElementById('status');

    CONTRACTS.forEach(function (row, index) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = row.method + ' ' + row.path + ' (' + row.label + ')';
      select.appendChild(option);
    });

    function renderParams() {
      const row = CONTRACTS[Number(select.value)];
      paramsEl.textContent = '';
      statusEl.textContent = '';
      if (!row) return;
      row.params.forEach(function (name) {
        const wrap = document.createElement('label');
        wrap.textContent = name + ' ';
        const input = document.createElement('input');
        input.dataset.param = name;
        input.placeholder = name;
        wrap.appendChild(input);
        paramsEl.appendChild(wrap);
      });
    }

    async function send() {
      const row = CONTRACTS[Number(select.value)];
      if (!row) return;
      let path = row.path;
      paramsEl.querySelectorAll('input').forEach(function (input) {
        const name = input.dataset.param;
        const value = input.value || ':' + name;
        path = path.split(':' + name).join(encodeURIComponent(value));
      });
      out.classList.remove('empty');
      out.textContent = '…';
      statusEl.className = '';
      statusEl.textContent = '';
      const started = performance.now();
      try {
        const response = await fetch(path, { method: row.method });
        const text = await response.text();
        const duration = Math.round(performance.now() - started);
        statusEl.textContent = response.status + ' ' + response.statusText + ' · ' + duration + 'ms';
        statusEl.className = response.ok ? 'status-ok' : 'status-error';
        try {
          out.textContent = JSON.stringify(JSON.parse(text), null, 2);
        } catch (_parseError) {
          statusEl.className = 'status-invalid';
          statusEl.textContent += ' · invalid JSON';
          out.textContent = text;
        }
      } catch (error) {
        statusEl.className = 'status-error';
        statusEl.textContent = 'request failed · ' + Math.round(performance.now() - started) + 'ms';
        out.textContent = String(error);
      }
    }

    select.addEventListener('change', renderParams);
    document.getElementById('send').addEventListener('click', send);
    renderParams();
  </script>
</body>
</html>
`
}


/**
 * Builds a self-contained DevTools panel page (served as `text/html` by the
 * `/_api-contracts` route): a table of all contracts plus a "Try request"
 * form that substitutes path parameters and performs a real `fetch`.
 *
 * Everything rendered into markup goes through `escapeHtml`; the embedded
 * JSON data set is `<`-escaped so a contract name cannot break out of the
 * `<script>` tag.
 */
export function buildDevtoolsHtml(contracts: AnyApiContract[]): string {
  const rows = contractRows(contracts)
  const data = JSON.stringify(rows)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

  const tableRows = rows.map(row => `
        <tr>
          <td><span class="method method-${escapeHtml(row.method.toLowerCase())}">${escapeHtml(row.method)}</span></td>
          <td class="path">${escapeHtml(row.path)}</td>
          <td>${escapeHtml(row.label)}</td>
          <td>${row.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ') || '—'}</td>
          <td>${row.errorCodes.map(code => `<code>${escapeHtml(code)}</code>`).join(' ') || '—'}</td>
        </tr>`).join('')

  return PANEL_HEAD
    + `${rows.length} operation(s) — contract-driven (nuxt-api-contract)</p>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Name</th><th>Tags</th><th>Error codes</th></tr></thead>
    <tbody>${tableRows}
    </tbody>
  </table>${PANEL_FOOT(data)}`
}
