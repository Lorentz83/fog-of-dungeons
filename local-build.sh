#!/bin/sh

set -e

( cd ts && tsc )
( cd go && go build -o ../fog-of-dungeons )
