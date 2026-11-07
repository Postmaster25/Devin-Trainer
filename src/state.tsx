import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import bundledPlan from './data/plan.json';
import { validatePlan, type Plan } from './data/schema';
import {
  clearImportedPlan, loadImportedPlan, loadProgress, loadSettings, saveImportedPlan, saveProgress, saveSettings,
  type Progress, type Settings,
} from './lib/storage';

const defaultPlanResult = validatePlan(bundledPlan);
if (!defaultPlanResult.ok) throw new Error(`Bundled plan is invalid: ${defaultPlanResult.errors.join('; ')}`);
export const DEFAULT_PLAN: Plan = defaultPlanResult.plan;

type AppState = {
  plan: Plan;
  planSource: 'bundled' | 'imported';
  planReady: boolean;
  settings: Settings;
  progress: Progress;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProgress: (fn: (p: Progress) => Progress) => void;
  importPlan: (plan: Plan) => Promise<void>;
  restoreDefaultPlan: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN);
  const [planSource, setPlanSource] = useState<'bundled' | 'imported'>('bundled');
  const [planReady, setPlanReady] = useState(false);
  const [progress, setProgress] = useState<Progress>(() => loadProgress(DEFAULT_PLAN.name));

  useEffect(() => {
    loadImportedPlan().then((imported) => {
      if (imported) {
        setPlan(imported);
        setPlanSource('imported');
        setProgress(loadProgress(imported.name));
      }
      setPlanReady(true);
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const updateProgress = useCallback(
    (fn: (p: Progress) => Progress) => {
      setProgress((p) => {
        const next = fn(p);
        saveProgress(plan.name, next);
        return next;
      });
    },
    [plan.name],
  );

  const importPlan = useCallback(async (p: Plan) => {
    await saveImportedPlan(p);
    const fresh: Progress = { missed: {}, repeats: {} };
    saveProgress(p.name, fresh);
    setPlan(p);
    setPlanSource('imported');
    setProgress(fresh);
  }, []);

  const restoreDefaultPlan = useCallback(async () => {
    await clearImportedPlan();
    setPlan(DEFAULT_PLAN);
    setPlanSource('bundled');
    setProgress(loadProgress(DEFAULT_PLAN.name));
  }, []);

  const value = useMemo(
    () => ({ plan, planSource, planReady, settings, progress, updateSettings, updateProgress, importPlan, restoreDefaultPlan }),
    [plan, planSource, planReady, settings, progress, updateSettings, updateProgress, importPlan, restoreDefaultPlan],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState outside provider');
  return v;
}
