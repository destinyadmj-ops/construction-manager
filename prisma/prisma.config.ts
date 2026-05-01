import { defineConfig } from '@prisma/config';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Prisma 7 では環境変数は自動ロードされないため明示的に読む
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../.env.local'), override: true });

const prismaDatasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!prismaDatasourceUrl) {
	throw new Error('DIRECT_URL or DATABASE_URL is not set');
}

export default defineConfig({
	datasource: {
		url: prismaDatasourceUrl,
	},
});
