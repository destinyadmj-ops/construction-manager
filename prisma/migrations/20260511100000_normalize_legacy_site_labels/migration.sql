CREATE TEMP TABLE "_legacy_normalized_sites" ON COMMIT DROP AS
SELECT
  "id",
  trim((regexp_match("name", '^\s*([^/／]+)\s*[／/]\s*(.+\S)\s*$'))[1]) AS "legacyCompanyName",
  trim((regexp_match("name", '^\s*([^/／]+)\s*[／/]\s*(.+\S)\s*$'))[2]) AS "normalizedSiteName"
FROM "Site"
WHERE "companyName" IS NULL
  AND regexp_match("name", '^\s*([^/／]+)\s*[／/]\s*(.+\S)\s*$') IS NOT NULL;

UPDATE "Site" AS s
SET
  "companyName" = legacy."legacyCompanyName",
  "name" = legacy."normalizedSiteName",
  "updatedAt" = NOW()
FROM "_legacy_normalized_sites" AS legacy
WHERE s."id" = legacy."id";

UPDATE "WorkEntry" AS we
SET
  "accountingMeta" = jsonb_set(we."accountingMeta"::jsonb, '{siteName}', to_jsonb(s."name"), true),
  "updatedAt" = NOW()
FROM "Site" AS s
INNER JOIN "_legacy_normalized_sites" AS legacy
  ON legacy."id" = s."id"
WHERE we."siteId" = s."id"
  AND we."accountingMeta" IS NOT NULL
  AND jsonb_typeof(we."accountingMeta"::jsonb) = 'object'
  AND (we."accountingMeta"::jsonb ->> 'siteName') IS DISTINCT FROM s."name";