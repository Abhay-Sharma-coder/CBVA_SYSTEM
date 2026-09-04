# CBVA Workspace

Office seat and meeting room booking for CBV & Associates LLP, Mumbai — and the
occupancy analytics behind it, which is the actual point.

```bash
cp .env.example .env.local     # fill in both connection strings
npm install
npm run db:migrate
npm run seed
npm run dev                    # http://127.0.0.1:8081
```

- **[CLAUDE.md](CLAUDE.md)** — read first. Stack, the clock rule, the adapter
  rules, design tokens, folder layout.
- **[docs/PROJECT.md](docs/PROJECT.md)** — the living spec.
- **[docs/PHASE-3-HANDOFF.md](docs/PHASE-3-HANDOFF.md)** — what exists today:
  the booking engine, the eighteen edge cases, and the defects they found.
  Earlier: [Phase 2](docs/PHASE-2-HANDOFF.md) (the CAD pipeline and floor plan),
  [Phase 1](docs/PHASE-1-HANDOFF.md) (the foundation).
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — ADR log.
- **[docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)** — everything the client has not
  confirmed. Five questions are open and blocking; A17, on who owns meeting room
  booking, is new and is the one that can embarrass the product in front of
  staff.

Visit `/styleguide` for the design system.
