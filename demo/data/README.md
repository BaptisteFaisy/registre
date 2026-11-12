# Demonstration data (generated)

Generated deterministically from `eval/catalogue.ts` by `node tools/demo/generate.ts`.

- `framework.json`: Annex A import payload for the 30 demonstration controls (R1).
- `evidence/`: 60 evidence documents matching the catalogue `fileName` list.
  They are real binaries: `.pdf` files with extractable text, real `.docx` and
  `.xlsx` (OOXML in a ZIP), real `.png` for the three screenshots, and CSV for
  the exports. The offline extractor in `src/support/documents/` reads the same
  bytes Bedrock Data Automation would read.
- `offline-text.json`: text twins of the three screenshots only. The scripted
  offline reader does no OCR, so a screenshot is read from its twin; on AWS the
  image itself is read. No twin means "unreadable", never a guess (EF-LEC-04).
