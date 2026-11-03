# Anti-abuse protections

> Status: specified, not implemented (plan 3)

These protections are always active.

- **ABU-001** — Form submissions are subject to a generous per-IP-address limit, only to stop automated bursts: dozens of prospects sharing the same Wi-Fi IP at a trade show are not blocked.
- **ABU-002** — The form contains an invisible honeypot field: a submission that fills it in is silently ignored.
- **ABU-003** — In the dashboard, the owner can mark a lead as spam.
- **ABU-004** — In the dashboard, the owner can delete a lead.
