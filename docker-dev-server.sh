#!/bin/sh

# Set up a docker container which watches for file changes and rebuild
# the code (both typescript and go) whenever needed.

[ -z "$port" ] && port="127.0.0.1:8080"

img="lorentz83/fog-of-dungeons-dev"

# Build the docker image if it doesn't exist.
# The docker image contains only the build scripts and some configuration.
# It should seldom change.
if [ -z "$( docker images "$img" -q 2>/dev/null )" ]; then
    docker build -t "$img" -f Dockerfile.dev . 
fi

# We want to watch for changes of the files in the host.
# But docker runs as a different user. To avoid permission issues
# we mount the local directory in readonly.
# We mount an extra tmpFS for typescrit to put the compiled files in
# what would be otherwise a read only directory in the GO tree. 

docker run --rm -it \
    -p "${port}:8080/tcp" \
    -v "$(pwd):/home/srv/src:ro" \
    --mount type=tmpfs,destination=/home/srv/src/go/ui/js,tmpfs-mode=777 \
    "$img"
