# Compatibility and migration policy

## Supported runtimes

| Dependency | Supported range | Notes |
| --- | --- | --- |
| Node.js | `>=20.19.0` | Nuxt 4 requires a compatible Node 22+ runtime. |
| Nuxt | `>=3.15.0` | Nuxt 4.5 is the primary verification target. |
| Zod | `^3.23.0 || ^4.0.0` | The same normalized schema layer supports both majors. |
| TypeScript | `^5.9.3` | Kept compatible with the declaration build toolchain. |

The package is published as a library and does not install a second Nuxt or Vue
copy in the consuming application. Consumers must install the framework first,
then install `nuxt-api-contract` and a supported Zod version.

## SemVer

- Patch releases fix behavior without changing the public API.
- Minor releases add compatible exports, schema kinds or optional behavior.
- Major releases may change the frozen public API listed in
  `docs/public-api.md`.
- Removing a supported Zod or Nuxt major is a major release and requires a
  migration note in `CHANGELOG.md`.

## Contract migration checklist

1. Update the contract schema and handler together.
2. Run `node dist/cli.mjs check <entry> --strict`.
3. Run `node dist/cli.mjs openapi <entry> --output openapi.json`.
4. Run `node dist/cli.mjs openapi <entry> --output openapi.json --check`.
5. Run `npm run test:unit`, `npm run test:integration`, `npm run test:type` and
   `npm run test:consumer`.
6. Review breaking type changes before merging or publishing.
7. Add a changelog entry and migration note for every breaking change.

## Governance commands

The repository intentionally has no GitHub Actions workflow. Governance is run
locally or by the consuming project's own CI:

```bash
npm run test:governance
npm run test:consumer
```

`test:governance` validates the playground contracts and OpenAPI generation.
`test:consumer` installs the actual packed tarball into a clean Nuxt project.
