CREATE TABLE "goal_lifestyle_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"monthly_amount" numeric(16, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_lifestyle_lines" ADD CONSTRAINT "goal_lifestyle_lines_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "goal_lifestyle_lines" ("goal_id", "name", "monthly_amount", "sort_order")
SELECT "id", 'Lifestyle', "monthly_funding_requirement", 0 FROM "goals";
