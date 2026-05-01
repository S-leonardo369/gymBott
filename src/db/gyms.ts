export interface Gym {
  id:                number;
  telegram_user_id:  string;
  gym_name:          string;
  owner_name:        string;
  owner_phone:       string;
  grace_period_days: number;
  default_plan_price: number;
  is_active:         number;
  dev_paid_until:    string | null;
  trial_ends_on:     string | null;  // YYYY-MM-DD; NULL until migration backfill
  last_billed_month: string | null;  // YYYY-MM; NULL until first billing cycle
  created_at:        string;
}

export interface CreateGymInput {
  telegram_user_id:   string;
  gym_name:           string;
  owner_name:         string;
  owner_phone:        string;
  default_plan_price: number;
  grace_period_days:  number;
  trial_ends_on:      string; // YYYY-MM-DD; set to today + 60 days during onboarding
}

/** Returns a gym by its numeric primary-key ID, or null if not found. */
export async function getGymById(
  db: D1Database,
  gymId: number
): Promise<Gym | null> {
  return db
    .prepare("SELECT * FROM gyms WHERE id = ? LIMIT 1")
    .bind(gymId)
    .first<Gym>();
}

/** Returns the gym row for the given Telegram user ID, or null if not registered. */
export async function getGymByTelegramId(
  db: D1Database,
  telegramUserId: string
): Promise<Gym | null> {
  return db
    .prepare("SELECT * FROM gyms WHERE telegram_user_id = ? LIMIT 1")
    .bind(telegramUserId)
    .first<Gym>();
}

/** Returns all gyms where is_active = 1, ordered by id. Used by the daily cron. */
export async function getAllActiveGyms(db: D1Database): Promise<Gym[]> {
  const { results } = await db
    .prepare("SELECT * FROM gyms WHERE is_active = 1 ORDER BY id ASC")
    .all<Gym>();
  return results;
}

/** Sets is_active for a gym. Use 1 to reactivate, 0 to pause. */
export async function setGymActive(
  db: D1Database,
  gymId:    number,
  isActive: 0 | 1
): Promise<void> {
  await db
    .prepare("UPDATE gyms SET is_active = ? WHERE id = ?")
    .bind(isActive, gymId)
    .run();
}

/** Inserts a new gym row and returns its auto-increment ID. */
export async function createGym(
  db: D1Database,
  input: CreateGymInput
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO gyms
         (telegram_user_id, gym_name, owner_name, owner_phone,
          default_plan_price, grace_period_days, trial_ends_on)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.telegram_user_id,
      input.gym_name,
      input.owner_name,
      input.owner_phone,
      input.default_plan_price,
      input.grace_period_days,
      input.trial_ends_on
    )
    .run();
  return result.meta.last_row_id as number;
}
