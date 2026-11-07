import { z } from 'zod';

/** Power target stored as % of FTP. lowW/highW document the watts at plan.referenceFtp. */
export const powerTargetSchema = z.object({
  lowPct: z.number().positive().optional(),
  highPct: z.number().positive().optional(),
  lowW: z.number().positive().optional(),
  highW: z.number().positive().optional(),
  note: z.string().optional(),
});

export const phaseKindSchema = z.enum(['warmup', 'work', 'recovery', 'steady', 'cooldown']);

export const phaseSchema = z.object({
  name: z.string().min(1),
  kind: phaseKindSchema,
  durationSec: z.number().int().positive(),
  /** Building block or section the phase belongs to, e.g. "WU-V", "Main set", "CD-5". */
  group: z.string().optional(),
  power: powerTargetSchema.optional(),
  hr: z.string().optional(),
  rpe: z.string().optional(),
  cadence: z.string().optional(),
  rep: z.object({ index: z.number().int().positive(), count: z.number().int().positive() }).optional(),
  set: z.object({ index: z.number().int().positive(), count: z.number().int().positive() }).optional(),
  note: z.string().optional(),
});

export const workoutCategorySchema = z.enum(['ride', 'strength', 'run', 'rest']);

export const workoutSchema = z.object({
  /** Library code: E1, L1, SS, T, V4, V30, RP1, RP2, TEST30, RAMP, SEG, VOLT, RUN, REST. */
  type: z.string().min(1),
  category: workoutCategorySchema,
  /** Short title the user copies into Strava, e.g. "SS 2 x 15". */
  title: z.string().min(1),
  /** One-line summary without watts (watts are computed at runtime from FTP). */
  summary: z.string(),
  /** Indoor trainer workouts get a timer; outdoor rides get detail only. */
  indoor: z.boolean(),
  totalMinutes: z.number().positive().optional(),
  notes: z.array(z.string()).default([]),
  phases: z.array(phaseSchema).default([]),
});

export const daySchema = z.object({
  /** 0-based offset within the week (0 = first day of the plan week). */
  offset: z.number().int().min(0).max(6),
  notes: z.array(z.string()).default([]),
  workouts: z.array(workoutSchema).default([]),
});

export const weekSchema = z.object({
  number: z.number().int().positive(),
  stage: z.string().optional(),
  deload: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
  days: z.array(daySchema),
});

export const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    /** FTP the documented watt ranges were written at. */
    referenceFtp: z.number().positive(),
    weeks: z.array(weekSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<number>();
    plan.weeks.forEach((w, i) => {
      if (seen.has(w.number)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weeks', i, 'number'], message: `Duplicate week ${w.number}` });
      }
      seen.add(w.number);
      const offsets = new Set<number>();
      w.days.forEach((d, j) => {
        if (offsets.has(d.offset)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weeks', i, 'days', j, 'offset'], message: `Duplicate day offset ${d.offset} in week ${w.number}` });
        }
        offsets.add(d.offset);
      });
    });
  });

export type PowerTarget = z.infer<typeof powerTargetSchema>;
export type PhaseKind = z.infer<typeof phaseKindSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type Day = z.infer<typeof daySchema>;
export type Week = z.infer<typeof weekSchema>;
export type Plan = z.infer<typeof planSchema>;

export type ValidationResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

export function validatePlan(data: unknown): ValidationResult {
  const result = planSchema.safeParse(data);
  if (result.success) {
    const plan = { ...result.data, weeks: [...result.data.weeks].sort((a, b) => a.number - b.number) };
    return { ok: true, plan };
  }
  return {
    ok: false,
    errors: result.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
