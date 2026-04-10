# codex-thread-merge-weak

Use this skill when user asks to merge/compact/sync Codex conversations for the current project.

## Required workflow

Follow this order strictly:

1. Call `preview_project_threads` first.
2. Show candidate sessions to the user with both:
   - list index (1-based)
   - `threadId`
3. Ask the user in chat to choose which sessions to merge.
   - Accept either index list (for example: `1,3,4`)
   - Or direct `threadId` list
4. Resolve the final selected thread set from user reply.
5. Call `merge_project_threads` only after user selection is explicit.

Do not skip preview.
Do not auto-merge all candidates without explicit user selection in chat.
Do not use CLI-style checkbox prompts.

## Output expectations

When merge completes, report:

- canonical thread id/name
- canonical turn id/status
- resume verification result
- generated artifact paths under `.codex/codex-thread-merge/`, including:
  - `CONTEXT.md`
  - `context/<session_id>.md`
  - `MEMORY.md`
  - `record.log`

If canonical thread is created but resume is not visible/verified, treat as failure and report it clearly.

## Tools

- `preview_project_threads`
- `merge_project_threads`
- `refresh_project_memory`

