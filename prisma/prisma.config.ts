import { defineConfig } from '@prisma/config';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Prisma 7 では環境変数は自動ロードされないため明示的に読む
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../.env.local'), override: true });

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
	process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
	engine: 'classic',
	datasource: {
		url: process.env.DATABASE_URL!,
		directUrl: process.env.DIRECT_URL,
	},
});
