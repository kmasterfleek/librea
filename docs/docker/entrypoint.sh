#!/bin/sh
# Librea container entrypoint.
#
# Data is never baked into the image: the image is code, the volume is the
# school. On first start, if the data directory has no ledger, optionally seed
# the synthetic demo district. On every later start, do nothing and serve what
# is already there.
#
# Set LIBREA_SEED_ON_EMPTY=0 to start empty and bootstrap the first admin
# through the sign-in page instead.
set -eu

DATA="${LIBREA_DATA:-/data}"
SEED="${LIBREA_SEED_ON_EMPTY:-1}"

mkdir -p "$DATA"

if [ ! -f "$DATA/ledger.jsonl" ]; then
  if [ "$SEED" = "1" ]; then
    echo "librea: $DATA is empty, seeding the synthetic demo district"
    LIBREA_DATA="$DATA" node scripts/seed.js
  else
    echo "librea: $DATA is empty, starting with no records (LIBREA_SEED_ON_EMPTY=0)"
  fi
else
  echo "librea: using the existing ledger in $DATA"
fi

exec node src/server.js
