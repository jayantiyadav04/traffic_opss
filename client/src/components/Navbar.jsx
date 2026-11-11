import { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthContext from '../auth/AuthContext';

const Navbar = () => {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <nav className="navbar">
            <div className="logo">
                <Link to="/" style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                    TrafficGuard
                </Link>
            </div>
            <div className="nav-links">
                {user ? (
                    <>
                        <Link to="/">Dashboard</Link>
                        {(user.role === 'admin' || user.role === 'officer') && (
                            <Link to="/register-violation">Register Violation</Link>
                        )}
                        <Link to="/violations">Violations</Link>
                        {user.role === 'admin' && <Link to="/analytics">Analytics</Link>}
                        <button onClick={handleLogout} className="btn btn-danger">
                            Logout
                        </button>
                    </>
                ) : (
                    <Link to="/login" className="btn btn-primary">
                        Login
                    </Link>
                )}
            </div>
        </nav>
    );
};

export default Navbar;
