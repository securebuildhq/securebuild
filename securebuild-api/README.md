# securebuild-api

## Public health check

`GET /api/health` requires no authentication. It returns only:

- HTTP 200: `{"status":"healthy"}`
- HTTP 503: `{"status":"unhealthy"}`

Every response has `Cache-Control: no-store`. Concurrent requests share an
in-flight check, but completed results are not cached.

The endpoint checks PostgreSQL using the API's shared connection pool and rejects
recovery/read-only mode (authentication writes a last-used timestamp). Connection
acquisition and query execution each have a two-second timeout. Failed queries
discard their connection. This detects connectivity and read-only configuration;
it does not perform a write or validate all schema permissions.

In parallel, it checks R2 using the same S3 client, credentials, endpoint, and
`R2_IMAGE_SCANS_BUCKET_NAME` as scan/SBOM retrieval. A `HeadObject` request to
`_health/securebuild-api` verifies access to a dedicated marker object without
reading customer data. HEAD requires object-read permission, just like GET; see
the [S3 HeadObject documentation](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).
The entire R2 request, including retries, is limited to two seconds and aborted
on timeout. Missing configuration, a missing marker, denied access, and dependency
errors all report unhealthy. The expected overall dependency-check budget is
four seconds, since the two checks run concurrently.

### Deployment setup

Before enabling monitoring, create a small, non-sensitive object with the exact
key `_health/securebuild-api` in each environment's configured scans bucket. It
may be empty. Use deployment/operator credentials to create it; the API only
needs its existing object-read access. For example, with the AWS CLI configured
with credentials for that R2 bucket:

```sh
aws s3api put-object \
  --endpoint-url "$R2_ENDPOINT" \
  --bucket "$R2_IMAGE_SCANS_BUCKET_NAME" \
  --key '_health/securebuild-api' \
  --body /dev/null
```

The marker lives at the bucket root, independently of `R2_USE_DYNAMIC_FOLDER`.
Exclude it from any expiration/cleanup rules. The endpoint never creates or
changes it. Object contents and metadata are never returned to the caller.

Route `/api/health` to securebuild-api on the same public hostname used by
vendor-api. Configure the Datadog HTTP synthetic to require HTTP 200, JSON
`status` equal to `healthy`, and an appropriate response-time limit (for example,
five seconds). Only dependency names are logged on failure; exception messages,
credentials, and internal addresses are omitted.

This endpoint reports API dependency availability, not worker/build progress,
individual customer artifact integrity, or vendor-api token/network validity.
