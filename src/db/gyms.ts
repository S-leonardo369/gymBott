export interface Gym {
  id: number;
  telegram_user_id: string;
  gym_name: string;
  owner_name: string;
  owner_phone: string;
  grace_period_days: number;
  default_plan_price: number;
  is_active: number;
  dev_paid_until: string | null;
  created_at: string;
}

export interface CreateGymInput {
  telegram_user_id: string;
  gym_name: string;
  owner_name: string;
  owner_phone: string;
  default_plan_price: number;
  grace_period_days: number;
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

/** Inserts a new gym row and returns its auto-increment ID. */
export async function createGym(
  db: D1Database,
  input: CreateGymInput
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO gyms
         (telegram_user_id, gym_name, owner_name, owner_phone, default_plan_price, grace_period_days)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.telegram_user_id,
      input.gym_name,
      input.owner_name,
      input.owner_phone,
      input.default_plan_price,
      input.grace_period_days
    )
    .run();
  return result.meta.last_row_id as number;
}
