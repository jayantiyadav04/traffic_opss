import { Navigate, Outlet } from 'react-router-dom';


// Let's inline usage or make a hook file. For simplicity, reading context here directly or creating a hook helper.
import { useContext } from 'react';
import AuthContext from '../auth/AuthContext';

const ProtectedRoute = ({ allowedRoles }) => {
    const { user, loading, sessionError, revalidate, logout } = useContext(AuthContext);

    if (loading) return <p role="status">Verifying your session...</p>;

    if (sessionError) return <div role="alert" className="card">
        <p>{sessionError}</p>
        <button className="btn btn-primary" onClick={() => revalidate()}>Retry session</button>
        <button className="btn btn-ghost" onClick={() => logout().catch(() => {})}>Sign out</button>
    </div>;

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
        return <div className="unauthorized">Access Denied: You do not have permission to view this page.</div>;
    }

    return <Outlet />;
};

export default ProtectedRoute;
