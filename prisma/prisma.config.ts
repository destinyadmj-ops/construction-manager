import { defineConfig } from '@prisma/config';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Prisma 7 では環境変数は自動ロードされないため明示的に読む
dotenv.config({ path: resolve(__dirname, '../.env.local') });

export default defineConfig({
	datasource: {
		url: process.env.DATABASE_URL!,
	},
});
