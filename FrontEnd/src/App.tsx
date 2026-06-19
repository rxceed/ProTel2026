import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { MainLayout } from '@/layout/MainLayout';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/login';
import { FieldsPage } from './pages/master/fields';
import { SubBlocksPage } from './pages/monitoring/sub-blocks';
import { DevicesPage } from './pages/master/devices';
import { DssPage } from './pages/recommendations/dss';
import { RecommendationsHistoryPage } from './pages/recommendations/history';

import { CyclesPage } from './pages/master/cycles';
import { RulesPage } from './pages/master/rules';

import { MapPage } from './pages/monitoring/map';
import { ProfilePage } from './pages/profile';
import { SettingsPage } from './pages/settings';
import { TasksPage } from './pages/tasks';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="smart-awd-theme">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/monitoring/map" element={<MapPage />} />
            <Route path="/monitoring/sub-blocks" element={<SubBlocksPage />} />
            <Route path="/recommendations/dss" element={<DssPage />} />
            <Route path="/recommendations/history" element={<RecommendationsHistoryPage />} />
            <Route path="/master/fields" element={<FieldsPage />} />
            <Route path="/master/cycles" element={<CyclesPage />} />
            <Route path="/master/rules" element={<RulesPage />} />
            <Route path="/master/devices" element={<DevicesPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
