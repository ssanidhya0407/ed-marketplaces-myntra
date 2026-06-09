#!/usr/bin/env bash
ORDER="f2f3f0cd-c747-4cbb-a699-1cee74090c93"
for i in $(seq 1 20); do
  resp=$(curl -s "https://myntra.experiencecart.net/orders/api/detail/$ORDER")
  sc=$(echo "$resp" | grep -o '"status_code":"[^"]*"' | head -1)
  ts=$(date '+%H:%M:%S')
  echo "[$ts] try $i -> $sc"
  if echo "$sc" | grep -qv 'RFR'; then
    if ! echo "$sc" | grep -q 'RFR'; then
      echo "STATUS CHANGED from RFR: $sc"
      break
    fi
  fi
  sleep 180
done
echo "watch done"
