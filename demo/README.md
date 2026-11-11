# Demonstration data (generated)

Generated deterministically from `eval/catalogue.ts` by:

```bash
node tools/demo/generate.ts           # regenerate the files
node tools/demo/generate.ts --check   # verify SHA-256 in CI
```

- `framework.json`: Annex A import payload for the 30 demonstration controls (R1).
- `evidence/`: 60 evidence documents matching the catalogue `fileName` list.
  Documents carrying `.pdf`, `.png`, `.docx`, or `.xlsx` names are stored as
  structured UTF-8 text/markdown so the offline reader extracts Annex B fields
  without binary parsers; CSV exports are stored as real CSV.

See `docs/DEMO.md` for the three-minute video script and the seeded scenarios.
