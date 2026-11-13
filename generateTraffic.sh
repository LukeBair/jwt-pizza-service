#!/bin/bash
# Usage: ./generateTraffic.sh https://pizza-service.<domain>
if [ -z "$1" ]; then
  echo "Usage: $0 https://pizza-service.<domain>"
  exit 1
fi
host="$1"
PIDS=()
cleanup() {
  echo; echo "Stopping traffic..."
  kill "${PIDS[@]}" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

login() { # email password -> token
  curl -s -X PUT "$host/api/auth" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.token'
}
logout() {
  curl -s -X DELETE "$host/api/auth" -H "Authorization: Bearer $1" > /dev/null
}
order() { # token count
  local items='' i
  for ((i = 0; i < $2; i++)); do
    items+='{"menuId":1,"description":"Veggie","price":0.05},'
  done
  curl -s -X POST "$host/api/order" -H 'Content-Type: application/json' -H "Authorization: Bearer $1" \
    -d "{\"franchiseId\":1,\"storeId\":1,\"items\":[${items%,}]}" > /dev/null
}

# Menu every 3s
( while true; do curl -s "$host/api/order/menu" > /dev/null; sleep 3; done ) & PIDS+=($!)

# Bad login every 25s
( while true; do
    curl -s -X PUT "$host/api/auth" -H 'Content-Type: application/json' \
      -d '{"email":"d@jwt.com","password":"wrong"}' > /dev/null
    sleep 25
  done ) & PIDS+=($!)

# Good login + logout every ~25s
( while true; do
    t=$(login d@jwt.com diner); logout "$t"; sleep 25
  done ) & PIDS+=($!)

# Order 1 pizza every ~20s
( while true; do
    t=$(login d@jwt.com diner); order "$t" 1; sleep 20; logout "$t"
  done ) & PIDS+=($!)

# Order 21 pizzas (factory failure) every ~60s
( while true; do
    t=$(login d@jwt.com diner); order "$t" 21; sleep 60; logout "$t"
  done ) & PIDS+=($!)

# Register random user (POST) then logout (DELETE) every ~45s; includes PUT via login
( while true; do
    n="u$RANDOM$RANDOM"
    t=$(curl -s -X POST "$host/api/auth" -H 'Content-Type: application/json' \
      -d "{\"name\":\"$n\",\"email\":\"$n@jwt.com\",\"password\":\"pw\"}" | jq -r '.token')
    logout "$t"; sleep 45
  done ) & PIDS+=($!)

echo "Generating traffic against $host. Press Ctrl+C to stop."
wait
