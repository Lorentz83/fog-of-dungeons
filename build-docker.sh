#!/bin/sh

img="lorentz83/fog-of-dungeons"

git="$(git rev-parse --short HEAD)"

if [ -n "$(git status --porcelain)" ]; then 
  echo "Uncommitted changes detected, building dev label."
  version="dev-${git}"
  latest="dev"
else
  version="git-${git}"
  latest="latest"
fi

docker build -t "${img}:${version}" -t "${img}:${latest}" .