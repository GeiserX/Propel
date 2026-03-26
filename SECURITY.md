# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

Only the latest version deployed from `main` receives security updates. There are no LTS or backport branches.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/GeiserX/Pumperly/security/advisories/new) or by emailing **support@pumperly.com**. Include:

- Description of the vulnerability
- Steps to reproduce
- Affected component (scraper, API, frontend, infrastructure)
- Potential impact assessment

You can expect an initial response within 72 hours. Critical vulnerabilities affecting production will be patched and deployed within 24 hours of confirmation.

## Security Architecture

### Application Stack

| Layer | Technology | Security Considerations |
| ----- | ---------- | ---------------------- |
| Frontend | Next.js (React) | Server-rendered, CSP headers via Cloudflare |
| API | Next.js Route Handlers | Server-side only, no direct DB exposure |
| Database | PostgreSQL + PostGIS | Internal network only, not internet-exposed |
| Geocoding | Photon (Elasticsearch) | Internal network only |
| Routing | Valhalla | Internal network only |
| Reverse Proxy | Caddy + Cloudflare | TLS termination, DDoS protection |
| Container Runtime | Docker (Portainer) | Non-root containers, read-only where possible |

### Network Boundaries

```
Internet → Cloudflare (WAF/DDoS) → Caddy (TLS) → Next.js App
                                                    ├── PostGIS (internal only)
                                                    ├── Photon  (internal only)
                                                    └── Valhalla (internal only)
```

- **PostGIS, Photon, and Valhalla are never exposed to the internet.** They are only reachable from the Next.js application container via Docker internal networking.
- All external traffic passes through Cloudflare's WAF and Caddy's TLS termination.
- API routes validate input with [Zod](https://zod.dev/) schemas before any database interaction.

### Data Handling

- **No user accounts or authentication.** Pumperly is a read-only public tool. There are no user credentials, sessions, or personal data to protect.
- **No cookies or tracking.** User preferences (theme, language, currency) are stored in `localStorage` only.
- **Fuel price data is public.** All scraped data originates from government APIs, open data portals, or publicly accessible community sources.
- **No PII is collected, stored, or transmitted.**

### Input Validation

- All API route parameters are validated with Zod schemas (coordinates, country codes, fuel types, pagination).
- Scraper outputs are sanitized before database insertion (HTML stripping with loop-until-stable for malformed tags, numeric range checks for prices).
- SQL injection is prevented by Prisma's parameterized queries — raw SQL is never used.
- The frontend does not render user-supplied HTML; all dynamic content is rendered via React's built-in XSS protections.

### Dependency Management

- **Dependabot** is enabled for npm, GitHub Actions, and Docker base images with automatic PR creation.
- **npm overrides** pin transitive dependencies to patched versions when upstream packages lag behind advisories.
- **CodeQL** runs on every push and pull request via GitHub Actions, scanning for JavaScript/TypeScript vulnerabilities.
- **GitGuardian** scans all commits for accidentally committed secrets.
- Dependencies are reviewed before merging — major version bumps are manually inspected for breaking changes.

### Container Security

- The Docker image is built from `node:lts-slim` (minimal attack surface).
- The application runs as a non-root user inside the container.
- Only port 3000 is exposed from the application container.
- Base image updates are tracked via Dependabot.

### Secrets Management

- All secrets (database credentials, API keys) are injected via environment variables at deploy time.
- No secrets are committed to the repository. `.env` files are in `.gitignore`.
- GitGuardian monitors all pushes for accidental secret exposure.

## Known Limitations

- **Scraper data integrity**: Fuel prices are scraped from third-party sources. While sanity checks exist (price range validation, staleness detection), Pumperly cannot guarantee the accuracy of upstream data.
- **No rate limiting at the application level**: Rate limiting is handled by Cloudflare. Self-hosted instances should configure rate limiting at the reverse proxy layer.
- **No CSP headers at the application level**: Content Security Policy is enforced by Cloudflare. Self-hosted instances should configure CSP in their reverse proxy (Caddy/Nginx).

## Security Best Practices for Self-Hosters

If you're self-hosting Pumperly:

1. **Never expose PostGIS, Photon, or Valhalla to the internet.** Keep them on an internal Docker network.
2. **Use a reverse proxy with TLS** (Caddy, Nginx, Traefik) in front of the Next.js app.
3. **Set strong database credentials** and restrict PostgreSQL to listen only on the Docker internal network.
4. **Enable rate limiting** at your reverse proxy to prevent abuse of the geocoding and routing APIs.
5. **Keep images updated.** Run `docker compose pull` regularly or enable Watchtower for automatic updates.
6. **Set environment variables securely.** Use Docker secrets or a `.env` file with restrictive permissions (`chmod 600`).

## Vulnerability Disclosure Timeline

| Date | Event |
| ---- | ----- |
| 2026-03-26 | Resolved all Dependabot advisories (hono, lodash, effect, brace-expansion) via npm overrides |
| 2026-03-26 | Fixed CodeQL alerts for incomplete HTML sanitization in Finland scraper |
