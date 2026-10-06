# POS101 Kiosk Auth Worker

This Worker replaces only the Kiosk Auth Functions. It uses Firebase RTDB as
the source of truth and signs Firebase Custom Tokens with secrets held by
Cloudflare. The browser never receives or stores the service-account key.

Production setup:

1. Create a Cloudflare KV namespace and bind it as `KIOSK_RATE_LIMIT`.
2. Set `ALLOWED_ORIGIN=https://najf8.github.io`.
3. Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
   with `wrangler secret put`.
4. Deploy with Wrangler, then verify health and negative tests before Rules.

The local admin activation-code CLI remains at
`functions/admin/create-activation-code.mjs`; it uses Application Default
Credentials and stores only a salted hash in RTDB.
