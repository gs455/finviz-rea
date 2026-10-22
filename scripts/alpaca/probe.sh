#!/bin/bash
# Phase-0 Alpaca probe. Usage: probe.sh <outfile> <url>. Keys come from env, never printed.
out="$1"; url="$2"
curl -s -o "$out" -w "http=%{http_code} time=%{time_total}s size=%{size_download}B\n" \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY_ID" -H "APCA-API-SECRET-KEY: $ALPACA_API_SECRET_KEY" "$url"
