CREATE TYPE "public"."asset_category" AS ENUM('investment', 'cash', 'real_estate_primary', 'real_estate_rental', 'vehicle', 'depreciating_other', 'other');--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "asset_category" "asset_category";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "include_in_fi_projection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "assets" SET "asset_category" = (
  CASE
    WHEN lower(btrim("asset_type")) = 'cash' THEN 'cash'::"asset_category"
    WHEN lower(btrim("asset_type")) = 'equity'
      OR lower("asset_type") LIKE '%stock%'
      OR lower("asset_type") LIKE '%etf%'
      OR lower("asset_type") LIKE '%bond%' THEN 'investment'::"asset_category"
    WHEN lower("asset_type") LIKE '%vehicle%'
      OR lower("asset_type") LIKE '%car%'
      OR lower(btrim("asset_type")) = 'auto' THEN 'vehicle'::"asset_category"
    WHEN lower("asset_type") LIKE '%rental%'
      OR lower("asset_type") LIKE '%investment property%' THEN 'real_estate_rental'::"asset_category"
    WHEN lower("asset_type") LIKE '%real estate%'
      OR lower("asset_type") LIKE '%home%'
      OR lower("asset_type") LIKE '%primary%' THEN 'real_estate_primary'::"asset_category"
    WHEN lower("asset_type") LIKE '%depreciat%'
      OR lower("asset_type") LIKE '%appliance%' THEN 'depreciating_other'::"asset_category"
    ELSE 'other'::"asset_category"
  END
);--> statement-breakpoint
UPDATE "assets" SET "include_in_fi_projection" = ("asset_category" IN ('investment', 'cash', 'real_estate_rental'));--> statement-breakpoint
DELETE FROM "allocation_targets" WHERE "asset_id" IN (SELECT "id" FROM "assets" WHERE "include_in_fi_projection" = false);--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "asset_category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "asset_category" SET DEFAULT 'investment'::"asset_category";--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "include_in_fi_projection" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "asset_type";
