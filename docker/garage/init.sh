#!/bin/sh
# Prepares the Garage of the development and test stacks. Idempotent: a second run changes nothing.
#   - the private bucket exists and the media key can read and write it (no website access);
#   - the public bucket (created by `garage server --default-bucket`) is served by the web
#     endpoint under the global alias `localhost`, and its CORS allows the app origin only.
# Environment: ADMIN_URL, ADMIN_TOKEN, S3_URL, S3_ACCESS_KEY, S3_SECRET_KEY, PUBLIC_BUCKET,
# PRIVATE_BUCKET, APP_ORIGIN. Runs in curlimages/curl (POSIX sh, no jq).
set -eu

admin() { # method path [json body]
  if [ $# -ge 3 ]; then
    curl -fsS -X "$1" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
      --data "$3" "$ADMIN_URL$2"
  else
    curl -fsS -X "$1" -H "Authorization: Bearer $ADMIN_TOKEN" "$ADMIN_URL$2"
  fi
}

# The id of a bucket from a bucket-info answer: the first "id" of the JSON document.
bucket_id() { sed -n 's/.*"id" *: *"\([0-9a-f]*\)".*/\1/p' | head -n 1; }

echo "garage-init: waiting for the admin API"
tries=0
until curl -fsS -o /dev/null "$ADMIN_URL/health"; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { echo "garage-init: admin API unreachable" >&2; exit 1; }
  sleep 1
done

public_id=$(admin GET "/v2/GetBucketInfo?globalAlias=$PUBLIC_BUCKET" | bucket_id)
[ -n "$public_id" ] || { echo "garage-init: bucket $PUBLIC_BUCKET not found" >&2; exit 1; }

if private_info=$(admin GET "/v2/GetBucketInfo?globalAlias=$PRIVATE_BUCKET" 2>/dev/null); then
  private_id=$(printf '%s' "$private_info" | bucket_id)
else
  private_id=$(admin POST /v2/CreateBucket "{\"globalAlias\":\"$PRIVATE_BUCKET\"}" | bucket_id)
fi
[ -n "$private_id" ] || { echo "garage-init: bucket $PRIVATE_BUCKET not created" >&2; exit 1; }

key_id=$S3_ACCESS_KEY
admin POST /v2/AllowBucketKey \
  "{\"bucketId\":\"$private_id\",\"accessKeyId\":\"$key_id\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":false}}" >/dev/null

admin POST "/v2/UpdateBucket?id=$public_id" \
  '{"websiteAccess":{"enabled":true,"indexDocument":"index.html"}}' >/dev/null

# Adding an alias the bucket already holds answers an error: only that one is success.
if ! admin POST /v2/AddBucketAlias "{\"bucketId\":\"$public_id\",\"globalAlias\":\"localhost\"}" >/dev/null 2>&1; then
  admin GET "/v2/GetBucketInfo?globalAlias=localhost" | bucket_id | grep -qx "$public_id" \
    || { echo "garage-init: alias localhost is held by another bucket" >&2; exit 1; }
fi

cors="<CORSConfiguration><CORSRule><AllowedOrigin>$APP_ORIGIN</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>Accept-Ranges</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>"
curl -fsS -o /dev/null --aws-sigv4 "aws:amz:garage:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" \
  -X PUT --data-binary "$cors" "$S3_URL/$PUBLIC_BUCKET?cors"

echo "garage-init: done ($PUBLIC_BUCKET public, $PRIVATE_BUCKET private)"
