# Roadmap

This roadmap prioritizes a short path from installation to a reliable production
API. The goal is not to add the largest possible feature list; it is to make the
single-source-of-truth workflow fast to adopt, easy to verify and predictable
when contracts change.

## Product principles

1. Correctness before feature count.
2. A five-minute quickstart before optional tooling.
3. Every generated artifact must be inspectable and reproducible.
4. Build-time errors must explain the exact fix.
5. Runtime behavior stays framework-compatible and opt-in.

## 1.3.0 — Consumer confidence and developer experience

**Status: released as `1.3.0`**

### Done in this iteration

- [x] Add `nuxt-api-contract check <entry>` for duplicate names/versions,
  duplicate routes and path-parameter consistency.
- [x] Add `check --strict` for CI use.
- [x] Add unit coverage for the checker.
- [x] Document the checker in the public CLI section.
- [x] Add a clean package-consumer smoke test.

### Exit criteria

- `npm pack` output contains every declared export and the CLI binary.
- A clean consumer can install the tarball and run the module in a Nuxt app.
- The quickstart completes without source-mode assumptions.
- CI runs the checker against the playground and reports actionable failures.

## 1.4.0 — CI and contract governance

**Status: released as `1.4.0`; coverage threshold remains in 1.5.0**

- [x] CI matrix: Node 20/22, Nuxt 3/4, Zod 3/4 (documented compatibility matrix; repository CI intentionally disabled).
- [x] Run `check --strict` in CI (local governance gate `npm run test:governance`).
- [x] Add `openapi --check` and reproducible generated OpenAPI validation.
- [ ] Add a runnable coverage threshold helper to `test:governance`; the
  existing coverage API requires project-specific test hooks.
- [x] Fail CI when a generated client/OpenAPI artifact is stale.
- [x] Publish a compatibility matrix and migration policy.

**Exit criteria:** a pull request cannot merge with broken type contracts,
malformed OpenAPI output, or an untested supported runtime combination.

## 1.5.0 — Better first-run experience

**Status: in progress**

The `init` starter is implemented; framework-neutral examples and expanded
configuration diagnostics remain in progress.

- [x] Add `nuxt-api-contract init <directory>`.
- [x] Generate a minimal contract, Nitro handler and Nuxt config.
- [ ] Provide framework-neutral and Nuxt quickstart examples.
- [ ] Add a focused “one contract” tutorial.
- [ ] Improve configuration errors for missing entry files and dependencies.

**Exit criteria:** a new user can create a working API contract without reading
the architecture document or importing internal entry points.

## 1.6.0 — OpenAPI and generated client completeness

**Status: in progress; multipart, strict mode and security metadata released in `1.5.0`**

- [x] Multipart support in the standalone generated client.
- [ ] Add OpenAPI 3.1/JSON Schema mode behind an explicit option.
- [x] Add strict OpenAPI mode that turns unsupported schema warnings into errors.
- [x] Add generated-client tests for errors, arrays, recursion and multipart.
- [x] Add `auth` security metadata without implementing an auth framework.

**Exit criteria:** generated clients and OpenAPI describe the same transport
behaviour as the Nuxt client for JSON, multipart and declared error payloads.

## 1.7.0 — Developer feedback

- [ ] Show response validation and schema diff in DevTools.
- [ ] Display request timing, status and validation result.
- [ ] Add redaction hooks for sensitive request/response fields.
- [ ] Improve mock-server fixtures and scenario filtering.
- [ ] Add migration hints for deprecated contract versions.

## Later

- Observability hooks without imposing an application framework.
- Optional OpenTelemetry integration behind a lightweight interface.
- Version-aware contract comparison and migration tooling.
- More transport adapters only when real integrations demonstrate a need.

## Explicit non-goals

- ORM or database abstraction.
- Full authentication/authorization implementation.
- A custom HTTP router.
- A second schema language.
- Automatic retry/rate-limit policy inside the core package.
- Generated artifacts that cannot be reviewed or reproduced locally.

## Release gates

Every release must pass:

- lint and TypeScript checks;
- unit, integration and type tests;
- production dependency audit;
- package build and export/binary smoke test;
- checker tests;
- supported runtime matrix on CI.
