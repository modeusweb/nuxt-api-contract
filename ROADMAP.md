# Roadmap

| Version | Scope | Status |
| --- | --- | --- |
| 0.1 | Core contracts: `defineApiContract`, `defineContractHandler`, `useApi`, `useApiClient`, validation, typed errors, SSR, tests, playground | ✅ done |
| 0.2 | OpenAPI generation (build-time + CLI) | ✅ done |
| 0.3 | DevTools panel (optional, no hard dependency) | ✅ done |
| 0.4 | Standalone mock server (`nuxt-api-contract mock`), mock presets from OpenAPI | planned |
| 0.5 | Extended contract testing (`testContract` suites, coverage report) | planned |
| 0.6 | OpenAPI client generation for external consumers | planned |
| 0.7 | External API contracts (custom transports, e.g. GitHub API) | planned |
| 0.8 | Contract versioning helpers (`version`, negotiation, deprecation) | planned |
| 1.0 | Stable public API, Zod 4 support, multipart/file upload bodies | planned |

Non-goals (deliberately): ORM, database abstraction, auth framework, custom
HTTP server/router, custom schema language, custom serializer.
