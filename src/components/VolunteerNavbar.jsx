import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

// Navigation bar for the Volunteer dashboard — matches DonorNavbar / NgoNavbar styling
export default function VolunteerNavbar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  function linkClass({ isActive }) {
    return `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-emerald-600 text-white'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
    }`;
  }

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Brand + volunteer name */}
        <Link to="/volunteer" className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-sm">
            FOR
          </span>
          <div className="hidden sm:block">
            <span className="font-bold text-slate-900 text-sm">Food on Rescue</span>
            <span className="ml-2 text-xs text-slate-500">
              {profile?.name || user?.email}
            </span>
          </div>
        </Link>

        {/* Navigation links + Logout */}
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <NotificationBell />
          <NavLink to="/volunteer" end className={linkClass}>
            Dashboard
          </NavLink>
          <button
            type="button"
            onClick={handleLogout}
            className="ml-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
