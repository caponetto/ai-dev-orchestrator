# Artifact storage and recovery

The filesystem implementation lives under
`packages/artifacts/src/infrastructure/artifact-system/`. A run owns its artifact directory;
version allocation and all store operations share a queue across store instances in that process.
Independent processes must obey run ownership; this queue is not a cross-process lock.

## Write and visibility contract

After ownership and content validation, a write allocates a version and atomically saves
`artifacts/.pending-write.yaml`. This record contains the owning run ID, exact content and complete
metadata, including version, checksum, byte size and any completion session identity. Once this
record has been saved, recovery finishes that version even if `store()` subsequently rejects.

Recovery checks the record's schema, run identity, safe filename, checksum and size. It checks
existing content, metadata and inventory summaries for conflicts before writing missing files.
It then writes content, writes metadata, adds the inventory entry and removes the pending record.
Repeating this sequence after a crash preserves the reference and adds no duplicate inventory
entry. Conflicting files are retained and produce `InventoryCorruptionError`; recovery does not
overwrite them to make the record fit.

Every `FilesystemArtifactStore` operation first finishes a pending write under the shared queue.
A read may therefore complete persistence left by an interrupted write. `list`, `getLatest`,
`history` and `inventory` use the committed inventory, rather than treating any content filename
as completed output. `get` validates sidecar schema/identity; `verify` checks content against an
exact reference's checksum.

A rejected write after record preparation has an uncertain return value but a recoverable effect.
Inspect/reconcile before directly repeating `store()`: ordinary store calls intentionally create
new versions and have no general idempotency key. Session completion recovery uses run/session
metadata to reuse the recovered artifact before deciding whether another store is needed.

## Inventory reconciliation

An invalid inventory is reported, never silently replaced with an empty one. The existing
`InventoryManager.rebuild(artifactsDir)` API provides explicit reconstruction; there is no new CLI
repair command. Use it with the run stopped and no concurrent owner writing files.

Rebuild validates each sidecar's schema, filename/type/version identity, optional run ID, content
existence, SHA-256 checksum and UTF-8 byte size. Older sidecars without `predecessorRef` remain
readable as having no predecessor. Rebuild stages all entries before replacing the inventory, so
an invalid artifact leaves the previous inventory file intact. A missing artifact directory cannot
clear a nonempty inventory.

Legacy content-only remnants have no trusted metadata: they remain on disk and are omitted from
rebuilt inventory. Both content-only and metadata-only filenames reserve their version numbers;
subsequent writes cannot overwrite them. A metadata-only remnant or corrupt pair blocks rebuilding
with the offending path in the error. Complete, valid legacy pairs can be indexed explicitly and
then reused by normal workflow recovery.

Rebuilding refuses a pending write record. First let the artifact store complete a valid record.
If the record or inventory is corrupt, stop the run, preserve the record/files and reconcile the
reported conflict against trusted evidence or backups before retrying. A corrupt index also blocks
pending recovery; restore/reconcile the index rather than discarding the pending record to bypass
validation. These APIs deliberately do not guess which conflicting evidence is authoritative.

## Guarantees and limits

Fresh-process tests terminate at the actual atomic rename boundaries before content publication,
after content, after metadata and after inventory publication. Workflow resume then produces the
same artifact identity and usage as uninterrupted execution, with one physical agent dispatch.

This is a process-restart protocol, not a transaction across the workflow journal, network effects
and every file. It does not establish power-loss durability or exactly-once arbitrary external
operations. An interrupted record preparation can leave an atomic-writer temporary file but no
committed artifact. Temporary files and legacy orphan files are not automatically deleted.
Manual edits, filesystem corruption and independent writers can require explicit reconciliation.
