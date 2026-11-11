# Demonstration data (generated)

Generated deterministically from `eval/catalogue.ts` by `node tools/demo/generate.ts`.

- `framework.json`: Annex A import payload for the 30 demonstration controls (R1).
- `evidence/`: 60 evidence documents matching the catalogue `fileName` list.
  Documents carrying `.pdf`, `.png`, `.docx`, or `.xlsx` names are currently
  stored as structured UTF-8 text/markdown so the offline reader can extract
  Annex B fields without binary parsers; CSV exports are stored as real CSV.
