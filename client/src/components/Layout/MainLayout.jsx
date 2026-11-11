import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Dialog from '../Dialog';

export default function MainLayout() {
    const [navigationOpen, setNavigationOpen] = useState(false);
    const closeNavigation = useCallback(() => setNavigationOpen(false), []);
    return <div className="app-layout">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div className="desktop-navigation"><Sidebar /></div>
        <header className="mobile-header"><strong>TrafficOps</strong>
            <button className="btn btn-outline" aria-label="Open navigation" aria-expanded={navigationOpen}
                onClick={() => setNavigationOpen(true)}>Menu</button>
        </header>
        {navigationOpen && <Dialog title="Navigation" onClose={closeNavigation}>
            <Sidebar mobile onNavigate={closeNavigation} />
        </Dialog>}
        <main id="main-content" className="app-main" tabIndex={-1}><Outlet /></main>
    </div>;
}
