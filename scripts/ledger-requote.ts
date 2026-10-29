/**
 * 現場台帳・関係会社の引用し直し(クリーンアップ)。既定は dry-run(読み取りのみ)。
 *
 *   dry-run : npx tsx scripts/ledger-requote.ts --file "<作業伝票.xls>" [--env .env.local] [--out <dir>]
 *   apply   : npx tsx scripts/ledger-requote.ts --file "<作業伝票.xls>" --apply --ids-file <承認済みID.json> --confirm-host <DBホスト>
 *
 * apply は「承認済みID.json({ siteIds: string[], partnerIds: string[] })」に載り、かつ実行時点でも
 * 削除候補(作業伝票2タブに無く手動データの参照も無い)と判定される行だけを削除する。冪等。
 * 削除前に対象行の JSON バックアップを出力先(既定: ホーム直下 masterhub-requote/。リポジトリ外)へ書く。
 * 出力にはシート/現場/会社名が含まれるので git 管理下へ置かないこと。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

type SiteKind = 'NORMAL' | 'DAILY';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string) => process.argv.includes(name);

function loadEnvFile(path: string) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2];
  }
}

function looseKey(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/[\s\u3000・･\-ー_/／.,、。'"“”‘’]/g, '')
    .toLowerCase();
}

function hasSyncMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const o = meta as Record<string, unknown>;
  const v = o.sharedExcelSync;
  if (v && typeof v === 'object') return true;
  return typeof o.labelColor === 'string' || typeof o.scheduleGroupIndex === 'number' || typeof o.scheduleItemIndex === 'number';
}

function isSyncDoc(tags: unknown): boolean {
  return !!tags && typeof tags === 'object' && !Array.isArray(tags) && (tags as Record<string, unknown>).sharedSync === true;
}

const nonEmpty = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v != null && !(Array.isArray(v) && v.length === 0));

async function main() {
  const filePath = arg('--file');
  if (!filePath) throw new Error('--file <作業伝票ファイル> は必須です');
  const envPath = resolve(arg('--env') ?? '.env.local');
  if (!existsSync(envPath)) throw new Error(`env ファイルがありません: ${envPath}`);
  loadEnvFile(envPath);
  const dbHost = new URL(process.env.DATABASE_URL ?? 'postgres://invalid').hostname;
  const apply = has('--apply');
  const outDir = resolve(arg('--out') ?? join(homedir(), 'masterhub-requote'));
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`DB host: ${dbHost} / mode: ${apply ? 'APPLY' : 'dry-run'}`);

  const { prisma } = await import('../src/server/db/prisma');
  const { readWorkbook, extractWorkSlipLedgerRows } = await import('../src/server/shared-excel-sync');
  const { normalizeSiteLookupKey } = await import('../src/shared/site-lookup');
  const { normalizeRegistryText } = await import('../src/server/site-registry');
  const siteKey = (s: string | null | undefined) => normalizeSiteLookupKey(s ?? '').replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
  const companyKey = (s: string | null | undefined) => normalizeRegistryText(s).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');

  // --- 作業伝票の2タブ ---
  const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const wb = readWorkbook(filePath);
  const { rows: tabRows, sheets } = extractWorkSlipLedgerRows(wb, asOf);
  const only = (name: string | null) =>
    name ? extractWorkSlipLedgerRows({ ...wb, SheetNames: [name], Sheets: { [name]: wb.Sheets[name] } } as typeof wb, asOf).rows : [];
  const monthRows = only(sheets.monthSheet);
  const originalRows = only(sheets.originalSheet);
  const k = (r: { companyName: string | null; siteName: string }) => `${companyKey(r.companyName)}|${siteKey(r.siteName)}`;
  const monthMap = new Map(monthRows.map((r) => [k(r), r] as const));
  let overlap = 0;
  let amountConflict = 0;
  for (const r of originalRows) {
    const hit = monthMap.get(k(r));
    if (!hit) continue;
    overlap += 1;
    if (hit.amount != null && r.amount != null && hit.amount !== r.amount) amountConflict += 1;
  }

  const tabSiteKeys = new Map<string, Set<string>>(); // siteKey -> companyKeys
  const tabLoose = new Map<string, string>(); // looseKey -> 表示名
  const tabCompanyKeys = new Set<string>();
  for (const r of tabRows) {
    const sk = siteKey(r.siteName);
    if (!tabSiteKeys.has(sk)) tabSiteKeys.set(sk, new Set());
    tabSiteKeys.get(sk)!.add(companyKey(r.companyName));
    tabLoose.set(looseKey(r.siteName), r.siteName);
    if (r.companyName) tabCompanyKeys.add(companyKey(r.companyName));
  }
  const inTabs = (name: string, company: string | null) => {
    const companies = tabSiteKeys.get(siteKey(name));
    if (!companies) return false;
    return companies.has(companyKey(company)) || companies.has('') || !companyKey(company);
  };

  // --- 現場 ---
  const sites = await prisma.site.findMany({
    select: {
      id: true, kind: true, name: true, companyName: true, address: true, phone: true, contactName: true, notes: true,
      pace: true, detail: true, peopleCount: true, caution: true, repeatRule: true, amount: true, createdAt: true,
      _count: { select: { timeClocks: true, members: true, outlookSendLogs: true } },
    },
  });
  const outside = sites.filter((s) => !inTabs(s.name, s.companyName));
  const outsideIds = outside.map((s) => s.id);
  const entries = await prisma.workEntry.findMany({ where: { siteId: { in: outsideIds } }, select: { siteId: true, accountingMeta: true } });
  const docs = await prisma.storedDocument.findMany({ where: { siteId: { in: outsideIds } }, select: { siteId: true, tags: true } });
  const refs = new Map<string, { syncEntries: number; manualEntries: number; syncDocs: number; otherDocs: number }>();
  const ref = (id: string) => {
    let r = refs.get(id);
    if (!r) refs.set(id, (r = { syncEntries: 0, manualEntries: 0, syncDocs: 0, otherDocs: 0 }));
    return r;
  };
  for (const e of entries) if (e.siteId) hasSyncMeta(e.accountingMeta) ? (ref(e.siteId).syncEntries += 1) : (ref(e.siteId).manualEntries += 1);
  for (const d of docs) if (d.siteId) isSyncDoc(d.tags) ? (ref(d.siteId).syncDocs += 1) : (ref(d.siteId).otherDocs += 1);

  type SiteRow = (typeof sites)[number];
  const siteDeleteCandidates: Array<SiteRow & { refs: ReturnType<typeof ref> }> = [];
  const siteInUse: Array<{ id: string; kind: SiteKind; name: string; companyName: string | null; reasons: string[]; mergeSuggestion: string | null }> = [];
  for (const s of outside) {
    const r = ref(s.id);
    const reasons: string[] = [];
    if (r.manualEntries) reasons.push(`手動の予定 ${r.manualEntries}`);
    if (r.otherDocs) reasons.push(`書類/写真 ${r.otherDocs}`);
    if (s._count.timeClocks) reasons.push(`打刻 ${s._count.timeClocks}`);
    if (s._count.members) reasons.push(`メンバー ${s._count.members}`);
    if (s._count.outlookSendLogs) reasons.push(`メール送信履歴 ${s._count.outlookSendLogs}`);
    const handFields = ['address', 'phone', 'contactName', 'notes', 'pace', 'detail', 'caution'] as const;
    for (const f of handFields) if (nonEmpty(s[f])) reasons.push(`入力済み:${f}`);
    if (s.peopleCount != null) reasons.push('入力済み:peopleCount');
    if (s.repeatRule != null) reasons.push('入力済み:repeatRule');
    if (reasons.length > 0) {
      siteInUse.push({ id: s.id, kind: s.kind, name: s.name, companyName: s.companyName, reasons, mergeSuggestion: tabLoose.get(looseKey(s.name)) ?? null });
    } else {
      siteDeleteCandidates.push({ ...s, refs: r });
    }
  }

  // --- 関係会社 ---
  const partners = await prisma.partner.findMany({
    include: { _count: { select: { outlookSendLogs: true, storedDocuments: true } } },
  });
  const keptSiteCompanyKeys = new Set(
    sites.filter((s) => !siteDeleteCandidates.some((d) => d.id === s.id)).map((s) => companyKey(s.companyName)).filter(Boolean),
  );
  const partnerDeleteCandidates: typeof partners = [];
  const partnerInUse: Array<{ id: string; name: string; reasons: string[] }> = [];
  const partnerInTabs = partners.filter((p) => tabCompanyKeys.has(companyKey(p.name))).length;
  for (const p of partners) {
    if (tabCompanyKeys.has(companyKey(p.name))) continue;
    const reasons: string[] = [];
    if (keptSiteCompanyKeys.has(companyKey(p.name))) reasons.push('残る現場が会社として参照');
    if (p._count.outlookSendLogs) reasons.push(`メール送信履歴 ${p._count.outlookSendLogs}`);
    if (p._count.storedDocuments) reasons.push(`書類 ${p._count.storedDocuments}`);
    for (const f of ['email', 'emails', 'notes', 'address', 'phone', 'fax', 'detail', 'caution', 'extraFields', 'outlookToEmailDefault', 'outlookSubjectReportDefault', 'outlookSubjectInvoiceDefault'] as const) {
      if (nonEmpty(p[f])) reasons.push(`入力済み:${f}`);
    }
    if (reasons.length > 0) partnerInUse.push({ id: p.id, name: p.name, reasons });
    else partnerDeleteCandidates.push(p);
  }

  const missingInDb = tabRows.filter((r) => !sites.some((s) => inTabs(s.name, s.companyName) && siteKey(s.name) === siteKey(r.siteName))).length;
  const summary = {
    dbHost,
    asOf,
    tabs: { month: sheets.monthSheet, original: sheets.originalSheet, warnings: sheets.warnings },
    tabRows: { month: monthRows.length, original: originalRows.length, mergedUnique: tabRows.length, overlap, overlapAmountConflict: amountConflict },
    sites: { total: sites.length, inTabs: sites.length - outside.length, deleteCandidates: siteDeleteCandidates.length, inUse: siteInUse.length, tabRowsMissingInDb: missingInDb },
    partners: { total: partners.length, inTabs: partnerInTabs, deleteCandidates: partnerDeleteCandidates.length, inUse: partnerInUse.length },
  };

  const report = {
    summary,
    siteDeleteCandidates: siteDeleteCandidates.map((s) => ({ id: s.id, kind: s.kind, name: s.name, companyName: s.companyName, syncEntries: s.refs.syncEntries, syncDocs: s.refs.syncDocs })),
    siteInUse,
    partnerDeleteCandidates: partnerDeleteCandidates.map((p) => ({ id: p.id, name: p.name })),
    partnerInUse,
  };
  const reportPath = join(outDir, `requote-report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 1), 'utf8');
  console.log(JSON.stringify(summary, null, 1));
  console.log(`report: ${reportPath}`);

  if (apply) {
    if (arg('--confirm-host') !== dbHost) throw new Error(`--confirm-host に接続先 (${dbHost}) を指定してください`);
    const idsFile = arg('--ids-file');
    if (!idsFile) throw new Error('--ids-file(承認済みID)が必要です');
    const approved = JSON.parse(readFileSync(resolve(idsFile), 'utf8')) as { siteIds?: string[]; partnerIds?: string[] };
    const siteIds = new Set(approved.siteIds ?? []);
    const partnerIds = new Set(approved.partnerIds ?? []);
    const siteTargets = siteDeleteCandidates.filter((s) => siteIds.has(s.id));
    const partnerTargets = partnerDeleteCandidates.filter((p) => partnerIds.has(p.id));

    const backupPath = join(outDir, `requote-backup-${stamp}.json`);
    const targetSiteIds = siteTargets.map((s) => s.id);
    writeFileSync(
      backupPath,
      JSON.stringify(
        {
          sites: await prisma.site.findMany({ where: { id: { in: targetSiteIds } } }),
          syncDocs: await prisma.storedDocument.findMany({ where: { siteId: { in: targetSiteIds } }, select: { id: true, siteId: true, fileName: true, storedPath: true, tags: true } }),
          partners: partnerTargets,
        },
        null,
        1,
      ),
      'utf8',
    );
    console.log(`backup: ${backupPath}`);

    // 現場の削除で WorkEntry/StoredDocument の siteId は SetNull になる(予定/書類そのものは残る)。
    const siteRes = await prisma.site.deleteMany({ where: { id: { in: targetSiteIds } } });
    const partnerRes = await prisma.partner.deleteMany({ where: { id: { in: partnerTargets.map((p) => p.id) } } });
    console.log(JSON.stringify({ deletedSites: siteRes.count, deletedPartners: partnerRes.count }));
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
