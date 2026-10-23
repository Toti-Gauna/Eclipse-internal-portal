#!/usr/bin/env bash
# Executed on Hostinger over SSH; no credentials are passed to this script.
set -Eeuo pipefail

action=${1:?Expected publish or rollback}
target=${2:?Expected the verified public_html directory}
release=${3:?Expected a release identifier}
[[ "$action" == publish || "$action" == rollback ]] || exit 2
[[ "$release" =~ ^[0-9]+-[0-9]+-[a-f0-9]{40}$ ]] || exit 2
case "$target" in
  /*/domains/interno.eclipse-business.com/public_html) ;;
  *) echo 'Unexpected deployment directory.' >&2; exit 2 ;;
esac
[[ -d "$target" && ! -L "$target" ]] || exit 2
base="${target%/public_html}/.eclipse-deploy"
stage="$base/staging/$release"
backup="$base/backups/$release.tar.gz"
umask 077
mkdir -p "$base/backups"
chmod 700 "$base" "$base/backups"
mkdir "$base/lock" || { echo 'Another deployment is active; inspect the lock before retrying.' >&2; exit 1; }
trap 'rmdir "$base/lock"' EXIT

restore() {
  [[ -f "$backup" && -f "$backup.list" && -d "$stage" ]] || return 1
  # Jailed Hostinger shells may not expose /dev/fd for Bash process substitution.
  # Use a private on-disk manifest instead, including when restoring an older release.
  local incoming="$base/backups/$release.incoming"
  find "$stage" -type f -print0 > "$incoming" || return 1
  # Remove only files introduced by this release, then restore the complete backup.
  while IFS= read -r -d '' file; do
    relative=${file#"$stage/"}
    if ! grep -Fxq -- "./$relative" "$backup.list"; then
      rm -f -- "$target/$relative" || return 1
    fi
  done < "$incoming"
  tar --same-permissions -xzf "$backup" -C "$target" || return 1
  echo "Restored backup for release $release."
}

if [[ "$action" == rollback ]]; then
  restore
  exit
fi

for file in index.html .htaccess public-config.json deploy-info.json src/app.js styles.css live.css live-comms.css live-crm.css planner.css; do
  [[ -s "$stage/$file" ]] || { echo 'Incomplete static export.' >&2; exit 1; }
done
[[ -d "$stage/src" && -d "$stage/assets" ]] || exit 1
if [[ -s "$target/.htaccess" ]] && ! grep -Fxq '# Eclipse internal Hostinger managed static site' "$target/.htaccess"; then
  echo 'Existing .htaccess needs review before the first deployment; live files were not changed.' >&2
  exit 1
fi
# Do not follow pre-existing symlinks while copying into the public directory.
[[ -z "$(find "$target" "$stage" -type l -print -quit)" ]] || {
  echo 'Review symbolic links before deploying.' >&2; exit 1;
}
[[ ! -e "$backup" ]] || { echo 'Release already has a backup.' >&2; exit 1; }
tar -czf "$backup" -C "$target" .
tar -tzf "$backup" > "$backup.list"

publication_failed() {
  trap - ERR
  echo 'Publication failed; restoring the previous files.' >&2
  if ! restore; then
    echo 'Automatic restore failed. Use the saved backup before retrying.' >&2
  fi
  exit 1
}
trap publication_failed ERR
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
# The private backup uses umask 077; public files must retain the readable modes
# above, including when overwriting files left private by an earlier deployment.
umask 022
# Modules and fonts before the entry page. Preserve unrelated public files.
cp -R --preserve=mode "$stage/src" "$stage/assets" "$target/"
cp -R --preserve=mode "$stage/." "$target/"
trap - ERR
echo "Published release $release. Backup: $backup"
