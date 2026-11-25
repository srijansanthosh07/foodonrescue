import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

/**
 * Top navigation bar for the admin dashboard.
 * Shows the FOR brand, the admin's name, and a Logout button.
 */
export default function AdminNavbar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  return (
    <nav className="sticky top-0 z-10 bg-indigo-700 text-white shadow-sm">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <span className="font-extrabold text-lg tracking-tight">
          FOR <span className="font-normal text-indigo-200 text-sm">Admin</span>
        </span>

        {/* Admin name + logout */}
        <div className="flex items-center gap-4">
          <NotificationBell dark />
          <span className="text-sm text-indigo-200 hidden sm:inline">
            {profile?.name || 'Admin'}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-indigo-900 text-white text-sm font-medium hover:bg-indigo-800 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
