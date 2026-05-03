import { defineConfig } from 'drizzle-kit';

const isGenerateCommand = process.argv.some((value) => value === 'generate');

if (!process.env.DATABASE_URL && !isGenerateCommand) {
	throw new Error('DATABASE_URL is required for Drizzle commands that connect to the database.');
}

export default defineConfig({
	schema: './src/lib/server/db/schema.js',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgresql://user:password@localhost:5432/todolist'
	},
	strict: true,
	verbose: true
});
