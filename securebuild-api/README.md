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
`R2_IMAGE_SCANS_BUCKET_NAME` as scan/SBOM retrieval. One `ListObjectsV2` request
with `MaxKeys: 1` verifies access to the bucket without downloading objects or
paginating through its contents. An empty bucket is healthy. The listing result
is discarded; object names and metadata are never returned or logged. This
checks bucket-list access rather than individual object-read permissions; see
the [S3 ListObjectsV2 documentation](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html).
The entire R2 request, including retries, is limited to two seconds and aborted
on timeout. Missing configuration, a missing bucket, denied access, and dependency
errors all report unhealthy. The expected overall dependency-check budget is
four seconds, since the two checks run concurrently.

### Deployment setup

The API's R2 credentials must allow listing the configured scans bucket. No
marker object or other test data is required. The listing checks the bucket
root, independently of `R2_USE_DYNAMIC_FOLDER`.

Route `/api/health` to securebuild-api on the same public hostname used by
vendor-api. Configure the Datadog HTTP synthetic to require HTTP 200, JSON
`status` equal to `healthy`, and an appropriate response-time limit (for example,
five seconds). Only dependency names are logged on failure; exception messages,
credentials, and internal addresses are omitted.

This endpoint reports API dependency availability, not worker/build progress,
individual customer artifact integrity, or vendor-api token/network validity.
