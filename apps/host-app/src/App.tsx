import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.js';
import { SSEProvider } from './context/SSEContext.js';
import { Navbar } from './components/Navbar.js';
import { ToastContainer } from './components/ToastContainer.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <SSEProvider>
        <BrowserRouter>
          <div className="app-container">
            <Navbar />
            <main className="main-content">
              <Routes>
                <Route path="/" element={<Navigate to="/expenses" replace />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/approvals" element={<ApprovalsPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="*" element={<Navigate to="/expenses" replace />} />
              </Routes>
            </main>
            <ToastContainer />
          </div>
        </BrowserRouter>
      </SSEProvider>
    </AuthProvider>
  );
};
