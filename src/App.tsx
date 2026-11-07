import { AppStateProvider, useAppState } from './state';
import { useRoute } from './router';
import { weekContaining, todayISO } from './lib/dates';
import ScheduleView from './views/ScheduleView';
import WorkoutDetail from './views/WorkoutDetail';
import TimerView from './views/TimerView';
import SettingsView from './views/SettingsView';

function Shell() {
  const route = useRoute();
  const { plan, settings, planReady } = useAppState();
  const numbers = plan.weeks.map((w) => w.number);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);

  if (!planReady) return <div className="loading">Loading…</div>;

  switch (route.name) {
    case 'workout':
      return <WorkoutDetail workoutKey={route.key} />;
    case 'timer':
      return <TimerView workoutKey={route.key} />;
    case 'settings':
      return <SettingsView />;
    default: {
      const requested = route.week && numbers.includes(route.week) ? route.week : undefined;
      // With no explicit week (e.g. on launch), open the week containing today, clamped to the plan.
      const week = requested ?? weekContaining(settings.startDate, todayISO(), first, last);
      return <ScheduleView weekNumber={week} />;
    }
  }
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
