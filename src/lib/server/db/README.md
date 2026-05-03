# Server Database Layer

This directory is server-only. Client components and shared domain modules should not import from it.

`getDb()` lazily initializes the Neon HTTP client so local tests and builds can run without `DATABASE_URL`. Server routes, actions, and domain services should call `getDb()` at request time.

Better Auth will own its auth tables in a later step. Until then, app tables keep user references as text IDs without foreign keys to generated auth tables.
