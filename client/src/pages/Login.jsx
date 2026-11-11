import { useState, useContext } from 'react';
import AuthContext from '../auth/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Mail, Lock, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { errorMessage } from '../api/axios';

const Login = () => {
    const { login } = useContext(AuthContext);
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const submitting = useRef(false);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setLoading(true);
        setError(null);
        try {
            await login(formData.email, formData.password);
            navigate('/');
        } catch (err) {
            setError(errorMessage(err, 'Invalid email or password'));
        } finally {
            setLoading(false);
            submitting.current = false;
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
            {/* Animated Background Elements */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />
                <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-400 to-cyan-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000" />
                <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-gradient-to-br from-purple-400 to-pink-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-md relative z-10 border border-white/20"
                style={{ padding: '3.5rem' }}
            >
                {/* Header */}
                <div className="flex flex-col items-center mb-8">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                        className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-2xl mb-4 shadow-lg"
                    >
                        <ShieldCheck size={40} className="text-white" strokeWidth={2.5} />
                    </motion.div>
                    <motion.h2
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent"
                    >
                        Welcome Back
                    </motion.h2>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="text-slate-600 mt-1"
                    >
                        Sign in to access TrafficOps
                    </motion.p>
                </div>

                {/* Error Message */}
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start gap-3" role="alert"
                    >
                        <div className="w-1 h-full bg-red-500 rounded-full" />
                        <p className="flex-1">{error}</p>
                    </motion.div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 }}
                        className="form-group"
                    >
                        <label htmlFor="login-email" className="form-label">
                            Email address
                        </label>
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', transition: 'color 0.2s' }}>
                                <Mail size={20} />
                            </div>
                            <input
                                name="email"
                                id="login-email"
                                type="email"
                                autoComplete="username"
                                className="form-control"
                                style={{ paddingLeft: '3rem' }}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 }}
                        className="form-group"
                    >
                        <label htmlFor="login-password" className="form-label">
                            Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', transition: 'color 0.2s' }}>
                                <Lock size={20} />
                            </div>
                            <input
                                name="password"
                                id="login-password"
                                autoComplete="current-password"
                                type="password"
                                placeholder="••••••••"
                                className="form-control"
                                style={{ paddingLeft: '3rem' }}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </motion.div>

                    <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="submit"
                        disabled={loading}
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '0.875rem', marginTop: '0.5rem' }}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                <span>Signing in...</span>
                            </>
                        ) : (
                            'Sign in'
                        )}
                    </motion.button>
                </form>

                <p className="account-link"><Link to="/register">Create citizen account</Link></p>

                {/* Footer */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-center text-xs text-slate-400"
                >
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span>Traffic violation management</span>
                    </div>
                    <p className="mt-2">&copy; 2026 TrafficOps Management System</p>
                </motion.div>
            </motion.div>

            <style>{`
                @keyframes blob {
                    0%, 100% { transform: translate(0, 0) scale(1); }
                    33% { transform: translate(30px, -50px) scale(1.1); }
                    66% { transform: translate(-20px, 20px) scale(0.9); }
                }
                .animate-blob {
                    animation: blob 7s infinite;
                }
                .animation-delay-2000 {
                    animation-delay: 2s;
                }
                .animation-delay-4000 {
                    animation-delay: 4s;
                }
            `}</style>
        </div>
    );
};

export default Login;
