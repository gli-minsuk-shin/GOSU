# Generated JSON Schemas

These files are generated from the Zod contracts in `../../src/`. Run `pnpm --filter @gosu/contracts generate`; do not edit them manually.

- `*.v1.schema.json`: standalone Draft-07 schemas
- `index.json`: stable contract name, file, and URN mapping
- `gosu-contracts.v1.bundle.schema.json`: self-contained definitions bundle for non-TypeScript consumers, including the Go Runner boundary
