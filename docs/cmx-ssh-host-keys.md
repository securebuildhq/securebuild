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
`machine_ssh_host_key` enrollment row. Startup also initializes enrollment once
for existing CMX builders. The `machine_pool.ssh_host_key_enrollment_source`
marker is set atomically with enrollment: `provisioning` for new VMs or `legacy`
for existing VMs. Once marked, startup cannot recreate a missing record or
overwrite a pin or quarantine. SSH cannot create a missing enrollment row.
During the SSH handshake, before client authentication or any commands or
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
Caller cancellation or an expired caller deadline aborts the connection without
recording an identity/storage failure or replacing the VM's failure diagnostics.
An internal verification timeout while the caller is still active remains a
reported storage failure.

Pool assignment and scan/SBOM builder selection exclude unavailable identities.
Existing running builders with a pending legacy enrollment remain selectable;
their next SSH handshake persists a pin before authentication. Their running
state and active assignments are preserved. New builders must enroll during
environment setup before becoming ready.
Pool reconciliation retires VMs with unavailable identities through the
authenticated CMX deletion API and provisions replacements under new VM IDs.
A concurrent status update or completed setup cannot make a quarantined
identity eligible again.
SSH identity failures during environment setup are archived with termination
reason `ssh_host_key_verification_failed`; ordinary setup failures retain
`build_env_failed`.
If concurrent cleanup removes a VM before setup can mark it ready, setup
reports a missing machine rather than an SSH identity failure. Failed status
updates re-check the current machine and its identity eligibility; a live CMX
VM with an unavailable identity still fails closed.

## Rotation, retirement, and rollout

In-place host-key rotation is not supported. Replace the VM through CMX; its
new ID receives a fresh enrollment record. Do not clear a pin or reset its
timestamp to repair a mismatch. Identity rows remain after builder removal for
diagnostics, and a retired VM ID cannot enroll again without an active builder
row. Public host keys are not SSH client credentials.

Apply the new SchemaHero table and enrollment-source column before deploying
the worker. Startup initializes existing CMX builders without recycling them
or clearing active assignments. Each existing VM has a first-use window on its
next SSH connection, just as a newly provisioned VM does. Multiple workers can
run this migration concurrently; it initializes each VM at most once.

Do not clear an enrollment-source marker, pin, or quarantine to repair a
verification failure. A lost record after initialization fails closed even
after a worker restart. Rollout requires no fleet-wide replacement; subsequent
identity failures still retire only the affected VMs.

Failures produce structured logs containing the VM ID, endpoint, and reason,
without key material. Metrics are `securebuild.cmx.ssh_host_key.enrolled` and
`securebuild.cmx.ssh_host_key.failed`; failure counters have a bounded `reason`
tag and no VM-ID or endpoint labels. Failure details are also retained in the
builder's existing diagnostic history when it is archived.
