# Credential state

The PAT lives in the DSH credential store record `dsh-figma-local-mcp/personal-access-token` and is never printed, echoed, or returned by any tool.

## Where users configure it

Only the native plugin settings panel, opened from the left-sidebar Figma row (`/dsh-figma` on the local web server). Never ask for a token in chat, never send users to the isolated sidebar browser, never read a token out of a file.

## States reported by `figma_token_status`

| `state` | Meaning | What to do |
| --- | --- | --- |
| `missing` | No record | Direct the user to the panel, then resume the task |
| `valid` | Last check authenticated | Continue |
| `expiring` | Valid and the user-supplied expiry is within 7 days | Continue, and mention early replacement |
| `expired` | User-supplied expiry has passed (no network call) | Stop exporting; ask for a new token |
| `invalid_or_expired` | Figma explicitly rejected the token (401 / explicit rejection text) | Stop; ask for a new token |
| `permission_denied` | 403 without token-rejection evidence | Check scopes and file sharing; this is **not** proof of expiry |
| `rate_limited` | Figma asked to retry later | Wait; do not re-save the token |
| `network_error` | Transport or 5xx failure | Retry later; the credential is not invalidated |
| `credential_error` | The stored record is malformed | Report it; the plugin does not delete the record |

## Audit trail

`figma_token_status` and the panel return the last five credential events (`save`, `remove`, `read-invalid`, `check-fail`, `check-ok`) with timestamp, actor (`panel` / `tool` / `background` / `plugin`), the affected token's SHA-256 prefix, and the expiry that applied. The trail is append-only at `~/.dsh/figma-local-mcp/audit.jsonl` (mode 0600) and contains no token material.

Use it to explain a disappeared credential instead of assuming a bug: a `remove` entry means the record was explicitly deleted (the panel's 移除 button, confirm-gated), and the fingerprint plus timestamp identifies which token was affected.

## Checks that happen without being asked

- On save, the candidate token is verified before the old one is replaced (`GET /v1/me`). A failed candidate never destroys a working credential.
- Every 6 hours, a background probe checks the saved token.
- Every export validates the credential before spending render quota.
- The panel polls status every 60 seconds while visible.
