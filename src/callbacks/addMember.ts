/**
 * Shared constants for the /add conversation.
 *
 * The actual button handling (plan selection, save/cancel) is done via
 * conversation.waitForCallbackQuery() inside src/conversations/addMember.ts —
 * no separate bot-level callback handlers are needed for those callbacks.
 */

export const PLAN_OPTIONS: Record<string, { label: string; days: number }> = {
  "plan:30":  { label: "1 month",  days: 30  },
  "plan:90":  { label: "3 months", days: 90  },
  "plan:180": { label: "6 months", days: 180 },
  "plan:365": { label: "1 year",   days: 365 },
};
