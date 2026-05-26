#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });

const { PrismaClient } = require('../src/generated/prisma');

function getPgAdapterConfig(connectionString) {
  try {
    const url = new URL(connectionString);
    const sslMode = (url.searchParams.get('sslmode') ?? '').toLowerCase();
    const shouldUseSupabaseSsl =
      sslMode === 'require' ||
      url.hostname.endsWith('.supabase.co') ||
      url.hostname.endsWith('.pooler.supabase.com');

    if (!shouldUseSupabaseSsl) {
      return { connectionString };
    }

    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: false,
      },
    };
  } catch {
    return { connectionString };
  }
}

(async () => {
  // Construct PrismaClient with adapter if available (mirrors src/server/db/prisma.ts)
  const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
  let prisma;
  try {
    const adapterModule = require('@prisma/adapter-pg');
    const PrismaPg = adapterModule?.PrismaPg;
    if (typeof PrismaPg === 'function') {
      const adapter = new PrismaPg(getPgAdapterConfig(connectionString));
      prisma = new PrismaClient({ adapter });
    } else {
      prisma = new PrismaClient();
    }
  } catch {
    // Adapter not available; try default constructor
    try {
      prisma = new PrismaClient();
    } catch (err) {
      console.error('Failed to construct PrismaClient:', err && err.message ? err.message : err);
      process.exitCode = 2;
      return;
    }
  }
  try {
    const userId = '__MASTER_HUB_GLOBAL__';
    console.log('Checking user', userId);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (u) {
      console.log('User exists:', u.id);
    } else {
      console.log('User not found — creating...');
      const created = await prisma.user.create({ data: { id: userId, name: 'MASTER_HUB_GLOBAL' } });
      console.log('Created user id:', created.id);
    }

    const key = 'ui.page-theme.global.v1';
    const setting = await prisma.userUiSetting.findUnique({
      where: { userId_key: { userId, key } },
      select: { value: true, updatedAt: true },
    });

    if (!setting) {
      console.log('Global setting not found. Creating a test empty override (will not overwrite existing).');
      const createdSetting = await prisma.userUiSetting.create({
        data: {
          userId,
          key,
          value: { schemaVersion: 2, overrides: {}, elements: {} },
        },
      });
      console.log('Created setting updatedAt:', createdSetting.updatedAt.toISOString());
    } else {
      console.log('Found global setting updatedAt:', setting.updatedAt.toISOString());
      console.log('Value (truncated):', JSON.stringify(setting.value).slice(0, 500));
    }
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    process.exitCode = 2;
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
})();
