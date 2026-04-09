# Backlog: AI Spending Analysis on Summary Dashboard

## Problem
Claude is already integrated for transaction categorisation during imports, but the rich historical data in the database is never analysed for patterns. Users have to manually spot trends across months. A conversational, natural-language "how am I tracking?" insight panel would surface anomalies, spending drift, and goal alignment automatically.

---

## Desired Outcome
- Summary dashboard gains an **AI Insights** panel that:
  - Auto-generates 3–5 bullet insights on load (or on demand via a "Refresh" button)
  - Answers a specific question: "How is my spending affecting my FI timeline?"
  - Highlights: top spending categories, month-over-month changes, savings rate trend, any category that grew >20% MoM
- Optional: user can type a question ("why is my timeline slipping?") and get a response in the same panel

---

## Technical Spec

### 1. Data payload for the AI (`lib/anthropic/spending-analysis.ts`)

New file. Build a structured JSON context object from the database to send to Claude:

```typescript
interface SpendingAnalysisContext {
  goal: {
    fiDate: string;
    requiredPrincipal: number;
    currency: string;
    withdrawalRate: number;
  };
  currentNetWorth: number;
  monthsToFi: number;
  last3Months: Array<{
    label: string;            // "Jan 2026"
    income: number;
    expenses: number;
    savingsRate: number;
    byCategory: Array<{
      name: string;
      amount: number;
      vsLastMonth: number;   // % change
    }>;
  }>;
  projectedFiDate: string;   // from engine — when portfolio actually hits required principal
  shortfallOrSurplus: number;
}
```

This context is assembled server-side using existing `lib/data/budget.ts` and `lib/data/summary.ts` functions. Keep the payload compact — stay well under 4k tokens.

---

### 2. Claude prompt (`lib/anthropic/spending-analysis.ts`)

```typescript
export async function generateSpendingInsights(context: SpendingAnalysisContext): Promise<string[]> {
  const prompt = `
You are a direct, no-nonsense FIRE planning assistant. Analyse the financial data below and return EXACTLY 4 insights as a JSON array of strings. Each insight should be 1–2 sentences, specific (include numbers), and actionable. Focus on: savings rate trend, biggest expense changes, FI timeline impact, and one specific recommendation.

Data:
${JSON.stringify(context, null, 2)}

Return format: ["insight 1", "insight 2", "insight 3", "insight 4"]
`;

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
  return JSON.parse(raw) as string[];
}
```

Use existing `lib/anthropic/` Anthropic client initialisation pattern.

---

### 3. Server action (`lib/actions/analysis.ts`)

New server action `getSpendingInsights()`:
1. Loads summary data + last 3 months of budget data
2. Builds `SpendingAnalysisContext`
3. Calls `generateSpendingInsights(context)`
4. Returns `{ insights: string[], generatedAt: Date }`

This is called on-demand (not on every page load) to avoid unnecessary API calls and latency.

---

### 4. UI: AI Insights panel (`components/summary/AiInsightsPanel.tsx`)

New component. Layout:

```
┌─────────────────────────────────────────┐
│ AI Insights                  [Refresh ↻] │
│                                          │
│ • Your savings rate dropped to 38% in   │
│   Mar vs 44% avg — driven by a 31%      │
│   increase in Dining spend (AED 3,200). │
│                                          │
│ • At current pace, FI date slips by     │
│   ~4 months to Sep 2031.                │
│                                          │
│ • Cutting Dining to your Feb level      │
│   recovers 2 of those 4 months.         │
│                                          │
│ • Side income is up 18% MoM — strong.  │
│                                          │
│  Ask a question...          [→]          │
└─────────────────────────────────────────┘
```

State:
- `idle` — shows last cached insights + timestamp, or a "Generate insights" CTA if none
- `loading` — skeleton / spinner while Claude call is in flight
- `error` — "Couldn't generate insights. Check ANTHROPIC_API_KEY is set."

The optional question input calls the same `getSpendingInsights()` action but appends the user question to the prompt: "Also specifically answer: {question}."

Cache the last result in React state (not persisted to DB) — refresh is manual.

---

### 5. Guard: only render if ANTHROPIC_API_KEY is set

In `getSummaryPageData()`, return `aiInsightsEnabled: boolean` based on whether `process.env.ANTHROPIC_API_KEY` is present. If false, render a soft "Connect Claude API to enable AI insights" prompt instead of the panel.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/anthropic/spending-analysis.ts` | New — context builder + Claude call |
| `lib/actions/analysis.ts` | New server action `getSpendingInsights` |
| `lib/data/summary.ts` | Expose `aiInsightsEnabled` flag |
| `components/summary/SummaryDashboard.tsx` | Render `AiInsightsPanel` (bottom of page) |
| `components/summary/AiInsightsPanel.tsx` | New component |

---

### Edge cases
- Less than 2 months of data: skip category trend analysis, generate insights only from available data; note the limitation in the output.
- Claude returns malformed JSON: wrap parse in try/catch, fall back to `["Unable to parse insights — please try again."]`.
- Rate limit / API error: surface the error message from the Anthropic SDK in the UI. Use the same retry logic pattern from `lib/anthropic/import-matcher.ts`.
- ANTHROPIC_API_KEY not set: hide the panel entirely (not just disable); don't show broken UI.
