# Roadmap

Versions in this table are **npm package versions**, not milestone numbers.
The initial release (0.1.0) shipped the first three planned milestones at once
— core contracts, OpenAPI generation and the DevTools panel — so the plan was
re-numbered against actual releases.

| npm version | Scope | Status |
| --- | --- | --- |
| 0.1.0 | Core contracts (`defineApiContract`, `defineContractHandler`, `useApi`, `useApiClient`), runtime validation, typed errors, SSR transport, contract registry, mocks, `callContract`, OpenAPI generation (build-time + CLI), optional DevTools panel, tests, playground | ✅ released |
| 0.2.0 | Standalone mock server (`nuxt-api-contract mock`), mock presets generated from contracts / OpenAPI | ✅ released |
| 0.3.0 | Extended contract testing (`testContract` suites, coverage report over contracts) | ✅ released |
| 0.4.0 | OpenAPI client generation for external consumers | ✅ released |
| 0.5.0 | External API contracts (pluggable transports, e.g. GitHub API) | ✅ released |
| 0.6.0 | Contract versioning helpers (`version`, negotiation, deprecation) | planned |
| 1.0.0 | Stable public API, Zod 4 support, multipart/file-upload bodies, strict SemVer | planned |

Patch releases (0.x.y) carry fixes; minor releases (0.x.0) may carry features
and documented breaking changes until 1.0.

Non-goals (deliberately): ORM, database abstraction, auth framework, custom
HTTP server/router, custom schema language, custom serializer.
