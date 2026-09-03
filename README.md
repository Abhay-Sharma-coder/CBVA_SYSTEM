# CBVA Workspace

Office seat and meeting room booking for CBV & Associates LLP, Mumbai — and the
occupancy analytics behind it, which is the actual point.

```bash
cp .env.example .env.local     # fill in both connection strings
npm install
npm run db:migrate
npm run seed
npm run dev                    # http://localhost:3000
```

- **[CLAUDE.md](CLAUDE.md)** — read first. Stack, the clock rule, the adapter
  rules, design tokens, folder layout.
- **[docs/PROJECT.md](docs/PROJECT.md)** — the living spec.
- **[docs/PHASE-1-HANDOFF.md](docs/PHASE-1-HANDOFF.md)** — what exists today.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — ADR log.
- **[docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)** — everything the client has not
  confirmed. Three questions are open and blocking.

Visit `/styleguide` for the design system.
