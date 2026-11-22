# Playwright part 2 integration

Add these development dependencies to the E2E package:

| Package | Tested version | Used for |
|---|---|---|
| `@axe-core/playwright` | `4.10.2` | WCAG scans |
| `exceljs` | `4.4.0` | Reading downloaded workbooks |
| `pdf-parse` | `2.4.5` | Extracting text from downloaded PDFs |

`pdf-parse` requires Node.js 20.16+ within the Node.js 20 line, or Node.js 22.3+. The suite uses the existing `@playwright/test`, `typescript`, and `@types/node` dependencies.

- Discover `tests/part2/*.spec.ts` alongside part 1. Use a single Playwright worker across both parts when they share a server because tests reset its database, clock and sessions. Set `BASE_URL` or Playwright's `use.baseURL` to the web app with `TEST_MODE=1`.
- For the database inspection, set `DB_PATH` to the active database file as seen by the E2E process. The test also checks SQLite journal and WAL sidecars when present. Set `DB_DUMP_PATH` and `WEB_LOG_PATH` when those files are available. Set `DB_ENCRYPTION_METHOD` to the method confirmed by the implementation team for inclusion in the Playwright report.
- If a second instance is available with test mode disabled, set `NO_TEST_BASE_URL` so the health and reset test also verifies that its reset endpoint returns 404.
