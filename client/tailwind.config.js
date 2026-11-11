/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#6366f1',
                    hover: '#4f46e5',
                    light: '#e0e7ff',
                    dark: '#3730a3',
                },
                secondary: {
                    DEFAULT: '#8b5cf6',
                    hover: '#7c3aed',
                },
                accent: {
                    DEFAULT: '#06b6d4',
                    hover: '#0891b2',
                }
            },
            fontFamily: {
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
            },
            borderRadius: {
                sm: '0.375rem',
                md: '0.5rem',
                lg: '0.75rem',
                xl: '1rem',
                '2xl': '1.5rem',
            }
        },
    },
    plugins: [],
}
