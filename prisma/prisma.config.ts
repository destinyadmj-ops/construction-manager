import { defineConfig } from '@prisma/internals';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// .envファイルを明示的に読み込む
dotenv.config({ path: resolve(__dirname, '../.env') });

export default defineConfig({
  datasource: {
    db: {
      provider: 'postgresql',
      url: 'postgresql://masterhub:masterhub@100.74.210.96:5432/masterhub',
    },
  },
});
