# Server Database Layer

This directory is server-only. Client components and shared domain modules should not import from it.

`getDb()` lazily initializes the Neon HTTP client so local tests and builds can run without `DATABASE_URL`. Server routes, actions, and domain services should call `getDb()` at request time.

Better Auth and passkey tables are defined in `schema.js` alongside the app tables. App tables keep user references as text IDs while task ownership and import flows are still being designed.
