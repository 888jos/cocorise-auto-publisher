import type { AppSettingsRow, SchedulerSettings } from "@/lib/types/domain";

export const defaultSchedulerSettings: SchedulerSettings = {
  postsPerDay: 3,
  reuseCooldownHours: 96,
  scheduleHorizonDays: 7,
  minStaggerMinutes: 0,
  maxStaggerMinutes: 59,
  minMinutesBetweenPosts: 150,
  timezone: "Europe/Paris",
  windows: [
    { name: "Morning", start: "06:30", end: "07:30" },
    { name: "Afternoon", start: "16:30", end: "17:30" },
    { name: "Evening", start: "21:30", end: "22:30" }
  ]
};

export function schedulerSettingsFromRow(row: AppSettingsRow | null): SchedulerSettings {
  if (!row) return defaultSchedulerSettings;
  return {
    postsPerDay: row.posts_per_day,
    reuseCooldownHours: row.reuse_cooldown_hours,
    scheduleHorizonDays: row.schedule_horizon_days,
    minStaggerMinutes: row.min_stagger_minutes,
    maxStaggerMinutes: row.max_stagger_minutes,
    minMinutesBetweenPosts: row.min_minutes_between_posts,
    timezone: row.timezone,
    windows: [
      { name: "Morning", start: row.morning_start, end: row.morning_end },
      { name: "Afternoon", start: row.afternoon_start, end: row.afternoon_end },
      { name: "Evening", start: row.evening_start, end: row.evening_end }
    ]
  };
}
