import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

// Railway mounts the SQLite volume at runtime, after the pre-deploy step.
const sqlite = new Database(databaseUrl)

try {
  migrate(drizzle(sqlite), { migrationsFolder: './drizzle' })
  console.log('Database migrations applied.')
} finally {
  sqlite.close()
}
