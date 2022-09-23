# Grindery Nexus Orchestrator

## Development

Run `npm run server` to start locally. All JSON-RPC methods are callable via the HTTP endpoint. Almost all of the methods require authentication, please go to https://nexus.grindery.org/ and sign in, then get your token from dev tools.

## Deployment

Pushing to the repository will trigger a deployment to the live Grindery GKE cluster. A deployment should complete in ~5 minutes.