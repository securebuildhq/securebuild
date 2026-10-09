# CMX SSH host keys

SecureBuild uses trust on first use (TOFU) for CMX builders. The first SSH
handshake pins the host public key to the CMX VM ID in PostgreSQL. Subsequent
connections must present exactly that key. IP addresses and ports are routing
information; a new VM ID can enroll a different key at a recycled endpoint.

TOFU assumes the first connection reaches the intended VM. It does not protect
against interception of that first connection. Every new VM has a new first-use
window. This deliberately narrows sc-139902 to key continuity during a VM's
lifetime. Vandoor forwarding and static-host policy are outside this change.

## Enrollment and verification

Provisioning atomically creates both the builder row and an empty
`machine_ssh_host_key` enrollment row. SSH cannot create a missing enrollment
row. During the SSH handshake, before client authentication or any commands or
files are sent, a transaction locks the enrollment row and either records the
first key or checks the existing pin. Concurrent first connections serialize:
the first committed key wins. Only plain SSH host keys are accepted.

The identity table is separate from `machine_pool` because pool assignment can
hold a builder-row lock while resolving the remote home directory over SSH.
Identity verification must not wait on that builder-row lock.

Missing enrollment records fail closed. A missing or malformed enrolled key,
an inconsistent enrollment timestamp, or a changed key permanently quarantines
the identity. An original key is still rejected after quarantine. Database
errors fail the connection without erasing trust or creating a new enrollment.
The runner does not retry identity failures as transient connection failures.

Pool assignment and scan/SBOM builder selection exclude unavailable identities.
Pool reconciliation retires these VMs through the authenticated CMX deletion
API and provisions replacements under new VM IDs. A concurrent status update
or completed setup cannot make a quarantined identity eligible again.

## Rotation, retirement, and rollout

In-place host-key rotation is not supported. Replace the VM through CMX; its
new ID receives a fresh enrollment record. Do not clear a pin or reset its
timestamp to repair a mismatch. Identity rows remain after builder removal for
diagnostics, and a retired VM ID cannot enroll again without an active builder
row. Public host keys are not SSH client credentials.

Apply the new SchemaHero table before deploying the worker. Existing CMX
builders have no enrollment record and are excluded from selection, then
retired by reconciliation. Expect a one-time builder replacement during rollout.
Drain active work before upgrading if disruption is undesirable. There is no
fallback to unverified connections or automatic enrollment of legacy builders.

Failures produce structured logs containing the VM ID, endpoint, and reason,
without key material. Metrics are `securebuild.cmx.ssh_host_key.enrolled` and
`securebuild.cmx.ssh_host_key.failed`; failure counters have a bounded `reason`
tag and no VM-ID or endpoint labels. Failure details are also retained in the
builder's existing diagnostic history when it is archived.
