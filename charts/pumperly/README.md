# Pumperly Helm Chart

This chart deploys the Pumperly web application plus optional bundled PostGIS, Valhalla, and Photon components.

## What This Chart Handles

- Pumperly web Deployment
- Optional bundled PostGIS StatefulSet
- Optional Valhalla routing Deployment
- Optional Photon Deployment when you provide a real image and startup command
- Automatic `npx prisma db push` init step for the primary database

## Important Notes

- Keep `replicaCount: 1` unless you intentionally disable or externalize scraping. Pumperly runs scrapers inside the web process.
- The chart defaults the web Deployment to `Recreate` so upgrades do not overlap two scraper pods.
- Photon is not plug-and-play. If `photon.enabled=true`, you must provide a working image plus `photon.command`/`photon.args`.
- For external infrastructure, disable `postgis.enabled` and use `externalDatabase` plus `externalServices.valhallaUrl` / `externalServices.photonUrl`.
- If you rely on chart-managed secrets, `helm upgrade` will now roll the web pod when the generated Secret changes.

## Minimal Example

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: pumperly.example.com
      paths:
        - path: /
          pathType: Prefix

config:
  defaultCountry: ES
  enabledCountries: ES,FR,PT

apiKeys:
  tankerkoenig: your-key
  openChargeMap: your-ocm-key

valhalla:
  enabled: true
```

Install with:

```bash
helm upgrade --install pumperly ./charts/pumperly -f my-values.yaml
```

## Useful Values

- `existingSecret`: reuse an externally managed Secret
  - always provide `DATABASE_URL`
  - if `postgis.enabled=true`, also provide `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`
  - optional API key entries: `TANKERKOENIG_API_KEY`, `PUMPERLY_OCM_API_KEY`, `FUELPRICES_DK_API_KEY`
- `externalDatabase.*`: required when `postgis.enabled=false` and you are not supplying a full `externalDatabase.url`
- `waitForDatabase.enabled`: if you keep it enabled with an external DB, also set `externalDatabase.host` so the init container has something to probe
- `waitForDatabase.timeoutSeconds`: fail startup if the database never becomes reachable instead of waiting forever
- `deploymentStrategy.type`: switch back to `RollingUpdate` only if you are comfortable with overlapping scraper pods during upgrades
- `postgis.enabled`: disable bundled PostGIS for managed PostgreSQL/PostGIS
- `databaseInit.enabled`: run `npx prisma db push` before the app starts
- `externalServices.valhallaUrl`: use an external Valhalla instance
- `externalServices.photonUrl`: use an external Photon instance
- `extraEnv` / `extraEnvFrom`: inject additional app settings without editing templates
