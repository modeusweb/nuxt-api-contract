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
| 0.6.0 | Contract versioning helpers (`versionedPath`, `version` registry, negotiation, deprecation) | ✅ released |
| 1.0.0 | Stable public API (frozen + documented in `docs/public-api.md`), Zod 4 support (dual Zod 3/4 introspection), multipart/file-upload bodies, strict SemVer | ✅ released |
| 1.1.0 | Audit fixes: typed-error rewrapping, deprecation headers on all response paths, mock delay/range bugs, strict version parsing, real DevTools HTML panel, clientgen requiredness | ✅ released |

Patch releases (1.x.y) carry fixes only; features land in minor releases (1.x.0)
and any breaking change requires a major release — see
[`docs/public-api.md`](docs/public-api.md) for the frozen surface.

Post-1.0 candidates (not committed):

- OpenAPI 3.1 / `z.toJSONSchema()`-based generation behind the same abstraction
  layer (JSON Schema dialects instead of hand-mapped keywords);
- file uploads in the generated standalone client (multipart request bodies);
- DevTools "diff contract vs. response" view;
- contract versioning ergonomics (`defineApiContract` version registry UI).

Non-goals (deliberately): ORM, database abstraction, auth framework, custom
HTTP server/router, custom schema language, custom serializer.
