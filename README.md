# emaildeliverability

## Local development

Run the scan API and frontend in separate terminals:

```bash
pnpm --filter ./apps/runner dev
```

```bash
pnpm --filter ./apps/web dev
```

The web app expects the runner API at `http://localhost:8787`.
