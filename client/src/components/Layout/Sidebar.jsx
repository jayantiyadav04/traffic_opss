import { useContext, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FilePlus, FileText, BarChart3, LogOut, ShieldCheck } from 'lucide-react';
import AuthContext from '../../auth/AuthContext';

const menuItems = [
    { path: '/', Icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'officer', 'citizen'] },
    { path: '/register-violation', Icon: FilePlus, label: 'Register violation', roles: ['admin', 'officer'] },
    { path: '/violations', Icon: FileText, label: 'Violations', roles: ['admin', 'officer', 'citizen'] },
    { path: '/analytics', Icon: BarChart3, label: 'Analytics', roles: ['admin'] },
];

export default function Sidebar({ mobile = false, onNavigate }) {
    const { logout, user } = useContext(AuthContext);
    const [signingOut, setSigningOut] = useState(false);
    return <aside className={`sidebar${mobile ? ' sidebar-mobile' : ''}`}>
        <div className="sidebar-brand"><ShieldCheck size={30} aria-hidden="true" /><div>
            <h2>TrafficOps</h2><p>Management portal</p></div>
        </div>
        <nav aria-label="Main navigation">{menuItems.filter(item => item.roles.includes(user?.role)).map(({ path, Icon, label }) =>
            <NavLink key={path} to={path} end={path === '/'} onClick={onNavigate}
                className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}>
                <Icon aria-hidden="true" size={20} /><span>{label}</span>
            </NavLink>)}</nav>
        <div className="sidebar-user"><p>{user?.full_name}</p><small>{user?.role}</small>
            <button className="btn" disabled={signingOut} onClick={async () => {
                setSigningOut(true);
                try { await logout(); } catch { /* Local session is cleared even if revocation is unavailable. */ }
                finally { setSigningOut(false); }
            }}><LogOut aria-hidden="true" size={18} />{signingOut ? 'Signing out...' : 'Sign out'}</button>
        </div>
    </aside>;
}
