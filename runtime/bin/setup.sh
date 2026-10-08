#!/usr/bin/env bash
set -euo pipefail

require_nonempty_file() {
  test -s "$1" || {
    echo "missing file path=$1" >&2
    exit 1
  }
}

require_dir() {
  test -d "$1" || {
    echo "missing directory path=$1" >&2
    exit 1
  }
}

runtime_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
runtime_manifest="$runtime_root/manifest.json"
node_path="$runtime_root/bin/node.exe"
node_repl_path="$runtime_root/bin/node_repl.exe"
node_modules="$runtime_root/bin/node_modules"
node_bin_dir="$(dirname "$node_path")"

require_nonempty_file "$runtime_manifest"
require_nonempty_file "$node_path"
require_nonempty_file "$node_repl_path"
require_dir "$node_modules/@oai/sky"
require_nonempty_file "$node_bin_dir/corepack"
require_dir "$node_modules/corepack"

manifest_node_version="$(
  "$node_path" --eval \
    'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).node_version);' \
    "$runtime_manifest"
)"
if [ "$("$node_path" --version)" != "v${manifest_node_version}" ]; then
  echo "node version mismatch node_path=$node_path manifest_node_version=$manifest_node_version" >&2
  exit 1
fi
"$node_bin_dir/corepack" --version >/dev/null

validation_dir="$(mktemp -d)"
trap 'rm -rf "$validation_dir"' EXIT
ln -s "$node_modules" "$validation_dir/node_modules"
(
  cd "$validation_dir"
  "$node_path" --input-type=module --eval 'const imported = await import("@oai/sky"); if (!imported.sky) throw new Error("@oai/sky missing sky export");'
)
"$node_repl_path" --help >/dev/null
echo "validated node_path=$node_path node_repl_path=$node_repl_path node_modules=$node_modules"
