**Time management — CRITICAL:**

- **Do NOT re-read the task file.** The task definition is already provided in this prompt. Reading it again wastes turns and tokens.
- **Write the output artifact as early as possible.** Produce a complete output before any cleanup or teardown. If you time out during cleanup, the artifact is still saved. If you time out during artifact writing, the entire run is lost.
- **You have a strict 10-minute time budget.** Prioritize producing a complete, valid output over exhaustive analysis. If time is running short, finalize and write what you have rather than starting new work.
- **Run one command per shell invocation.** Simple, single-purpose commands are easier to auto-approve via the permission allow list. Avoid chaining with `&&`, `||`, or `;`.
- **Validate your JSON output.** After writing the artifact, run a quick validation (e.g., `python3 -m json.tool < file.json > /dev/null`) to catch syntax errors before the orchestrator reads it.
