# Anti-abuse protections

> Status: implemented (plan 3)

These protections are always active.

- **ABU-001** — Form submissions are subject to a generous per-IP-address limit, only to stop automated bursts: dozens of prospects sharing the same Wi-Fi IP at a trade show are not blocked.
- **ABU-002** — The form contains an invisible honeypot field: a submission that fills it in is silently ignored.
- **ABU-003** — In the dashboard, the owner can mark a lead as spam.
- **ABU-004** — In the dashboard, the owner can delete a lead.

## Details

- **ABU-005** — A submission whose honeypot field (ABU-002) is not empty after trimming spaces gets exactly the same response as an accepted submission, but nothing is recorded and it does not count toward the per-device limit (EVT-014). The honeypot field is a text field named `fax`, placed off-screen (without `display: none`), with no autocompletion, outside keyboard navigation and hidden from screen readers.
- **ABU-006** — The limit of ABU-001 is 120 submissions per IP address over any sliding 10-minute window, across all events, whether accepted or rejected. Beyond that, the submission is rejected with `429 rate_limited` and a `Retry-After` header in seconds.
- **ABU-007** — Wrong access codes are limited to 30 per IP address over any sliding 10-minute window; beyond that, every code check is rejected with `429 rate_limited` and a `Retry-After` header. A correct code does not count.
- **ABU-008** — The IP address used is the one placed by the reverse proxy in `X-Forwarded-For`: the n-th from the right, n being the `TRUSTED_PROXY_HOPS` variable (1 by default). With 0, or if the header contains fewer addresses, it is the connection's address. An IPv6 address counts as its /64 prefix.
- **ABU-009** — A lead marked as spam stays in the list with a "Spam" label, and the owner can remove this mark.
- **ABU-010** — Deleting a lead is permanent and requires confirmation.
