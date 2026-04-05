#!/usr/bin/env bash
set -euo pipefail

status=0

echo "Checking Rust for transcript/summary content logs..."
if grep -RniE "log::(info|debug|warn)!.*(text='|result: '|content: '|Raw response|Formatted summary|First parsed segment: text=)" frontend/src-tauri/src --include='*.rs' \
  | grep -v "ADAMANT_VERBOSE\|lib_old_complex.rs"; then
  echo "ERROR: Rust content log found above. Wrap in ADAMANT_VERBOSE guard or convert to metadata log."
  status=1
fi

echo "Checking Python for transcript/summary content logs..."
if grep -RniE "(Summary result for chunk|print\\(content|print\\(\"\\\\n\", summary\.model_dump_json|save-transcript request for meeting:)" backend --include='*.py' \
  | grep -v '/venv/' \
  | grep -v "ADAMANT_VERBOSE\|examples/"; then
  echo "ERROR: Python content log found above. Wrap in ADAMANT_VERBOSE guard or convert to metadata log."
  status=1
fi

echo "Checking TypeScript for console.log..."
if grep -Rni 'console\.log' frontend/src --include='*.ts' --include='*.tsx' \
  | grep -v '\.test\.\|\.spec\.\|__tests__'; then
  echo "ERROR: console.log found above. Use console.debug/error/warn or remove it."
  status=1
fi

echo "Checking TypeScript for likely content/config leaks..."
if grep -RniE "console\.(debug|warn|error).*?(apiKey|customOpenAIApiKey|Raw response|Formatted summary|Latest transcript)" frontend/src --include='*.ts' --include='*.tsx' \
  | grep -v 'ADAMANT_VERBOSE'; then
  echo "ERROR: likely sensitive frontend logging found above. Sanitize or guard it."
  status=1
fi

exit $status
