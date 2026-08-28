## Change Attribution

You are reviewing a **change**, not auditing the entire codebase.

A finding is **in-scope** only if the defect is **introduced or worsened** by the implementation under review.

Before starting your review methodology, **anchor to what changed**:

1. List changed files from `pr_diff_context.changedFiles` when that artifact is available, otherwise from the implementation artifact's changed-file lists (`steps[].filesChanged`, `summary.filesCreated` / `summary.filesModified`, or equivalent fields).
2. Treat all added/modified hunks (or files created/modified per the implementation artifact) as your review surface. Unchanged files are out of scope unless you need to read them to verify a claim about changed code.
3. Every finding must trace to a specific added or modified hunk or file.

Before reporting any finding, classify it internally:

| Class            | Definition                                                                                                     | Action                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **introduced**   | The added/changed lines create a new defect                                                                    | Report normally; set `attribution: "introduced"`                                    |
| **worsened**     | This change makes an existing issue materially worse (broader blast radius, new call path, weaker guard)       | Report normally; set `attribution: "worsened"`                                      |
| **propagated**   | New code copies an existing pattern from unchanged code in the same module or documented in `codebase_context` | Omit entirely, or cap at `minor` with `attribution: "propagated"`                   |
| **pre-existing** | The issue exists in unchanged context; this change merely touches adjacent code                                | Omit entirely; set `attribution: "pre-existing"` only if noting as advisory `minor` |

**Baseline check:** Ask: "If I reverted only the added/changed lines, would this issue still exist?" If no → not introduced → do not block approval at `major` or `critical`.

**Evidence rule:** For `critical`/`major`, `evidence` MUST be a verbatim snippet from **added or modified lines** in the diff (lines prefixed with `+`, or content inside a modified hunk), or from a file the implementation artifact marks as created/modified. Citing unchanged surrounding code is insufficient for blocking severity.

**Convention matching:** Use `codebase_context` to judge whether new code **matches** established conventions — not to demand this change remediate every documented imperfection in adjacent unchanged code. Following an established (even imperfect) convention is intentional consistency, not a regression.
