#!/usr/bin/env node
'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
const mongodb_1 = require('mongodb');
const assert_1 = __importDefault(require('assert'));
const http_1 = __importDefault(require('http'));
const url_1 = require('url');
// @ts-ignore
const basic_logger_1 = __importDefault(require('basic-logger'));
const Query_1 = require('./Query');
const SearchIndex_1 = require('./SearchIndex');
process.title = 'search-transport';
const MAXIMUM_QUERY_LENGTH = 100;
const STANDARD_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
};
const log = new basic_logger_1.default({
  showTimestamp: true,
});
function escapeHTML(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
/**
 * If the request method does not match the method parameter, return false
 * and write a 405 status code. Otherwise return true.
 */
function checkMethod(req, res, method) {
  if (req.method !== method) {
    res.writeHead(405, {});
    res.end('');
    return false;
  }
  return true;
}
class InvalidQuery extends Error {}
class Marian {
  constructor(index) {
    this.index = index;
    // Fire-and-forget loading
    this.index
      .load()
      .then((result) => {
        if (result) {
          log.info(JSON.stringify(result));
        }
      })
      .catch((err) => {
        log.error(err);
      });
  }
  start(port) {
    const server = http_1.default.createServer(async (req, res) => {
      try {
        await this.handle(req, res);
      } catch (err) {
        log.error(err);
        res.writeHead(500, {});
        res.end('');
      }
    });
    server.listen(port, () => {
      log.info(`Listening on port ${port}`);
    });
  }
  handle(req, res) {
    const url = req.url;
    if (!url) {
      assert_1.default.fail('Assertion: Missing url');
    }
    const parsedUrl = url_1.parse(url, true);
    const pathname = (parsedUrl.pathname || '').replace(/\/+$/, '');
    if (pathname === '/search') {
      if (checkMethod(req, res, 'GET')) {
        this.handleSearch(parsedUrl, req, res);
      }
    } else if (pathname === '/refresh') {
      if (checkMethod(req, res, 'POST')) {
        this.handleRefresh(req, res);
      }
    } else if (pathname === '/status') {
      if (checkMethod(req, res, 'GET')) {
        this.handleStatus(parsedUrl, req, res);
      }
    } else if (pathname === '') {
      if (checkMethod(req, res, 'GET')) {
        this.handleUI(parsedUrl, req, res);
      }
    } else {
      res.writeHead(400, {});
      res.end('');
    }
  }
  async fetchResults(parsedUrl) {
    const rawQuery = (parsedUrl.query.q || '').toString();
    if (!rawQuery) {
      throw new InvalidQuery();
    }
    if (rawQuery.length > MAXIMUM_QUERY_LENGTH) {
      throw new InvalidQuery();
    }
    const query = new Query_1.Query(rawQuery);
    let searchProperty = parsedUrl.query.searchProperty || null;
    if (typeof searchProperty === 'string') {
      searchProperty = [searchProperty];
    }
    return await this.index.search(query, searchProperty);
  }
  async handleSearch(parsedUrl, req, res) {
    const start = process.hrtime.bigint();
    const headers = {
      'Content-Type': 'application/json',
      Vary: 'Accept-Encoding',
      'Cache-Control': 'public,max-age=120,must-revalidate',
      'Access-Control-Allow-Origin': '*',
    };
    Object.assign(headers, STANDARD_HEADERS);
    let results;
    try {
      results = await this.fetchResults(parsedUrl);
    } catch (err) {
      if (err instanceof InvalidQuery) {
        res.writeHead(400, headers);
        res.end('[]');
        return;
      }
      throw err;
    }
    let responseBody = JSON.stringify(results);
    res.writeHead(200, headers);
    res.end(responseBody);
    const end = process.hrtime.bigint();
    log.info(Number(end - start) / 1000000);
  }
  async handleRefresh(req, res) {
    const headers = {
      Vary: 'Accept-Encoding',
    };
    Object.assign(headers, STANDARD_HEADERS);
    try {
      await this.index.load();
    } catch (err) {
      log.error(err);
      headers['Content-Type'] = 'application/json';
      const body = JSON.stringify({ errors: [err] });
      if (err.message === 'already-indexing') {
        res.writeHead(503, headers);
      } else {
        res.writeHead(500, headers);
      }
      res.end(body);
      return;
    }
    if (this.index.lastRefresh && this.index.lastRefresh.errors.length > 0) {
      headers['Content-Type'] = 'application/json';
      const body = JSON.stringify({ errors: this.index.lastRefresh.errors });
      res.writeHead(200, headers);
      res.end(body);
      return;
    }
    res.writeHead(200, headers);
    res.end('');
  }
  async handleStatus(parsedUrl, req, res) {
    const headers = {
      'Content-Type': 'application/json',
      Vary: 'Accept-Encoding',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*',
    };
    Object.assign(headers, STANDARD_HEADERS);
    if (this.index.manifests === null) {
      res.writeHead(503, headers);
      res.end('');
      return;
    }
    const response = {
      manifests: this.index.manifests.map((manifest) => manifest.searchProperty),
    };
    if (parsedUrl.query.verbose) {
      response.lastSync = this.index.lastRefresh;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(response));
  }
  async handleUI(parsedUrl, req, res) {
    const headers = {
      'Content-Type': 'text/html',
      Vary: 'Accept-Encoding',
      'Cache-Control': 'public,max-age=120,must-revalidate',
    };
    Object.assign(headers, STANDARD_HEADERS);
    const dataList = (this.index.manifests || []).map((manifest) => encodeURIComponent(manifest.searchProperty));
    if (dataList.length > 0) {
      dataList.unshift('');
    }
    let query = parsedUrl.query.q || '';
    if (Array.isArray(query)) {
      query = query[0];
    }
    let searchProperty = parsedUrl.query.searchProperty || '';
    if (Array.isArray(searchProperty)) {
      searchProperty = searchProperty[0];
    }
    let results = [];
    let resultError = false;
    try {
      results = await this.fetchResults(parsedUrl);
    } catch (err) {
      resultError = true;
    }
    const resultTextParts = results.map((result) => {
      return `<li class="result">
                <div class="result-title"><a href="${encodeURI(result.url)}">${escapeHTML(result.title)}</a></div>
                <div class="result-preview">${escapeHTML(result.preview)}</div>
            </li>`;
    });
    let responseBody = `<!doctype html><html lang="en">
        <head><title>Marian</title><meta charset="utf-8">
        <style>
        .results{list-style:none}
        .result{padding:10px 0;max-width:50em}
        </style>
        </head>
        <body>
        <form>
        <input placeholder="Search query" maxLength=100 id="input-search" autofocus value="${escapeHTML(query)}">
        <input placeholder="Property to search" maxLength=50 list="properties" id="input-properties" value="${escapeHTML(
          searchProperty
        )}">
        <input type="submit" value="search" formaction="javascript:search()">
        </form>
        <datalist id=properties>
        ${dataList.join('<option>')}
        </datalist>
        ${resultError ? '<p>Error fetching results</p>' : ''}
        <ul class="results">
        ${resultTextParts.join('\n')}
        </ul>
        <script>
        function search() {
            const rawQuery = document.getElementById("input-search").value
            const rawProperties = document.getElementById("input-properties").value.trim()
            const propertiesComponent = rawProperties.length > 0 ? "&searchProperty=" + encodeURIComponent(rawProperties) : ""
            document.location.search = "q=" + encodeURIComponent(rawQuery) + propertiesComponent
        }
        </script>
        </body>
        </html>`;
    res.writeHead(200, headers);
    res.end(responseBody);
  }
}
const MANIFEST_URI_KEY = 'MANIFEST_URI';
const ATLAS_URI_KEY = 'ATLAS_URI';
const DATABASE_NAME_KEY = 'ATLAS_DATABASE';
const DEFAULT_DATABASE_NAME = 'search';
function help() {
  console.error(`Usage: search-transport <manifest-uri> <mongodb-uri>
If a value is "ENV", consult the environment.

The following environment variables are used:
* ${MANIFEST_URI_KEY}
* ${ATLAS_URI_KEY}
* ${DATABASE_NAME_KEY}`);
}
async function main() {
  basic_logger_1.default.setLevel('info', true);
  if (
    process.argv.length < 2 ||
    process.argv.length > 4 ||
    process.argv.includes('--help') ||
    process.argv.includes('-h')
  ) {
    help();
    process.exit(1);
  }
  let manifestUri = process.argv[2];
  if (!manifestUri || manifestUri === 'ENV') {
    manifestUri = process.env[MANIFEST_URI_KEY];
  }
  let atlasUri = process.argv[3];
  if (!atlasUri || atlasUri === 'ENV') {
    atlasUri = process.env[ATLAS_URI_KEY];
  }
  let databaseName = DEFAULT_DATABASE_NAME;
  const envDBName = process.env[DATABASE_NAME_KEY];
  if (envDBName) {
    databaseName = envDBName;
  }
  if (!manifestUri || !atlasUri) {
    if (!manifestUri) {
      console.error(`Missing ${MANIFEST_URI_KEY}`);
    }
    if (!atlasUri) {
      console.error(`Missing ${ATLAS_URI_KEY}`);
    }
    help();
    process.exit(1);
  }
  const client = await mongodb_1.MongoClient.connect(atlasUri, { useUnifiedTopology: true });
  const searchIndex = new SearchIndex_1.SearchIndex(manifestUri, client, databaseName);
  await searchIndex.createRecommendedIndexes();
  const server = new Marian(searchIndex);
  server.start(8080);
}
try {
  main();
} catch (err) {
  console.error(err);
}