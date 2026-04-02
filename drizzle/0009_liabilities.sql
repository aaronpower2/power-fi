CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"liability_type" varchar(128),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"current_balance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"secured_by_asset_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_secured_by_asset_id_assets_id_fk" FOREIGN KEY ("secured_by_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_secured_asset_uidx" ON "liabilities" USING btree ("secured_by_asset_id") WHERE "liabilities"."secured_by_asset_id" IS NOT NULL;--> statement-breakpoint
