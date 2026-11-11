#!/usr/bin/env bash
# verify-pack.sh — check a frozen audit pack WITHOUT trusting Registre.
#
#   ./scripts/verify-pack.sh <pack-directory> [--public-key <pem>]
#
# The directory is what a partner downloads: `index.json`, `manifest.json` and
# `attestation.json` (see src/pipeline/pack.ts). Only `python3` and, for the
# optional signature check, `openssl` are used — no network, no AWS, no Node.
#
# What is checked:
#   1. the manifest's root hash still matches its own content (canonical JSON,
#      keys sorted, no whitespace) — any edit of a control, a state or a
#      fingerprint breaks it;
#   2. every fingerprint listed in the manifest is 64 hex characters;
#   3. when the archive `index.json` is present, its SHA-256 is reported so the
#      reviewer can compare it with what they were told out of band;
#   4. when `--public-key` is given and a signature exists, the Ed25519/ECDSA
#      signature over the canonical manifest is verified.
#
# Exit codes: 0 verified, 1 verification failed, 2 usage or missing file.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 2; }

DIR="${1:-}"
[ -n "$DIR" ] || die "usage: verify-pack.sh <pack-directory> [--public-key <pem>]"
[ -d "$DIR" ] || die "no such directory: $DIR"
MANIFEST="$DIR/manifest.json"
[ -f "$MANIFEST" ] || die "manifest.json not found in $DIR"

PUBLIC_KEY=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --public-key) PUBLIC_KEY="${2:-}"; [ -n "$PUBLIC_KEY" ] || die "--public-key needs a path"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

STATUS=0
python3 - "$MANIFEST" "$DIR" <<'PY' || STATUS=1
import hashlib
import json
import re
import sys

manifest_path, directory = sys.argv[1], sys.argv[2]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)

declared = manifest.get("rootHash")
body = {key: value for key, value in manifest.items() if key != "rootHash"}
canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
computed = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

ok = True
print("pack            : %s" % manifest.get("packId"))
print("framework       : %s v%s" % (manifest.get("frameworkId"), manifest.get("frameworkVersion")))
print("frozen at       : %s" % manifest.get("frozenAt"))
print("controls        : %s" % manifest.get("controlCount"))
print("evidence        : %s" % manifest.get("evidenceCount"))
print("known gaps      : %s" % manifest.get("knownGapCount"))
print("declared root   : %s" % declared)
print("computed root   : %s" % computed)

if declared != computed:
    print("RESULT root hash: FAILED - the manifest was altered after it was signed")
    ok = False
else:
    print("RESULT root hash: ok")

fingerprints = []
for control in manifest.get("controls", []):
    for evidence in control.get("evidence", []):
        fingerprints.append((control.get("controlId"), evidence.get("evidenceId"), evidence.get("sha256")))

bad = [item for item in fingerprints if not re.fullmatch(r"[0-9a-f]{64}", item[2] or "")]
if bad:
    print("RESULT checksums: FAILED - %d malformed fingerprint(s)" % len(bad))
    ok = False
else:
    print("RESULT checksums: ok (%d fingerprints, 64 hex characters each)" % len(fingerprints))

try:
    with open("%s/index.json" % directory, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    print("archive sha256  : %s (compare with the value you were given)" % digest)
except OSError:
    print("archive sha256  : index.json not present in this directory")

sys.exit(0 if ok else 1)
PY

if [ -n "$PUBLIC_KEY" ] && [ -f "$DIR/attestation.json" ]; then
  SIG_B64=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['signature']['signature'])" "$DIR/attestation.json")
  # The signature covers the WHOLE canonical manifest, root hash included; only
  # the root hash itself is computed over the manifest minus that field.
  python3 -c "
import base64, json, sys
manifest = json.load(open(sys.argv[1]))
canonical = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
open(sys.argv[2], 'wb').write(canonical.encode('utf-8'))
open(sys.argv[3], 'wb').write(base64.b64decode(sys.argv[4]))
" "$MANIFEST" /tmp/registre-verify-payload.bin /tmp/registre-verify-signature.bin "$SIG_B64"
  if openssl pkeyutl -verify -pubin -inkey "$PUBLIC_KEY" -rawin \
      -in /tmp/registre-verify-payload.bin -sigfile /tmp/registre-verify-signature.bin >/dev/null 2>&1; then
    echo "RESULT signature : ok (verified against $PUBLIC_KEY)"
  else
    echo "RESULT signature : FAILED (not produced by this key, or payload altered)"
    STATUS=1
  fi
  rm -f /tmp/registre-verify-payload.bin /tmp/registre-verify-signature.bin
elif [ -n "$PUBLIC_KEY" ]; then
  echo "RESULT signature : skipped (no attestation.json in this directory)"
else
  echo "RESULT signature : not checked (pass --public-key <pem> to verify)"
fi

if [ "$STATUS" -eq 0 ]; then
  echo "VERDICT: the pack is consistent with its manifest."
else
  echo "VERDICT: the pack does NOT verify. Do not accept it as evidence."
fi
exit "$STATUS"
