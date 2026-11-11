const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const serverDir = path.join(rootDir, 'server');
const clientDir = path.join(rootDir, 'client');

const requiredFiles = [
    // Backend
    'server/package.json',
    'server/server.js',
    'server/.env',
    'server/src/app.js',
    'server/src/config/db.js',
    'server/src/models/User.js',
    'server/src/models/Violation.js',
    'server/src/models/Area.js',
    'server/src/models/ViolationType.js',
    'server/src/controllers/authController.js',
    'server/src/controllers/violationController.js',
    'server/src/controllers/analyticsController.js',
    'server/src/routes/authRoutes.js',
    'server/src/routes/violationRoutes.js',
    'server/src/routes/analyticsRoutes.js',
    'server/src/middleware/authMiddleware.js',
    'server/src/middleware/roleMiddleware.js',

    // Frontend
    'client/package.json',
    'client/src/main.jsx',
    'client/src/App.jsx',
    'client/src/api/axios.js',
    'client/src/auth/AuthContext.jsx',
    'client/src/pages/Login.jsx',
    'client/src/pages/Dashboard.jsx',
    'client/src/pages/RegisterViolation.jsx',
    'client/src/pages/ViewViolations.jsx',
    'client/src/pages/Analytics.jsx',
    'client/src/routes/ProtectedRoute.jsx',
];

const requiredServerDeps = [
    'express', 'mongoose', 'dotenv', 'cors', 'bcryptjs', 'jsonwebtoken', 'helmet', 'morgan'
];

const requiredClientDeps = [
    'react', 'react-dom', 'react-router-dom', 'axios', 'chart.js', 'react-chartjs-2'
];

let allPassed = true;

console.log('🔍 Starting TrafficGuard Project Verification...\n');

// 1. Check Files
console.log('📂 Checking File Structure...');
requiredFiles.forEach(file => {
    if (fs.existsSync(path.join(rootDir, file))) {
        console.log(` ✅ Found: ${file}`);
    } else {
        console.log(` ❌ MISSING: ${file}`);
        allPassed = false;
    }
});
console.log('');

// 2. Check Server Dependencies
console.log('📦 Checking Backend Dependencies (server/package.json)...');
try {
    const serverPkg = require(path.join(serverDir, 'package.json'));
    requiredServerDeps.forEach(dep => {
        if (serverPkg.dependencies && serverPkg.dependencies[dep]) {
            console.log(` ✅ Dependency: ${dep}`);
        } else {
            console.log(` ❌ MISSING DEPENDENCY: ${dep}`);
            allPassed = false;
        }
    });
} catch (e) {
    console.log(` ❌ Could not read server/package.json`);
    allPassed = false;
}
console.log('');

// 3. Check Client Dependencies
console.log('🎨 Checking Frontend Dependencies (client/package.json)...');
try {
    const clientPkg = require(path.join(clientDir, 'package.json'));
    requiredClientDeps.forEach(dep => {
        if (clientPkg.dependencies && clientPkg.dependencies[dep]) {
            console.log(` ✅ Dependency: ${dep}`);
        } else {
            console.log(` ❌ MISSING DEPENDENCY: ${dep}`);
            allPassed = false;
        }
    });
} catch (e) {
    console.log(` ❌ Could not read client/package.json`);
    allPassed = false;
}

console.log('\n----------------------------------------------');
if (allPassed) {
    console.log('🎉 SUCCESS: All requirements match the project specifications!');
} else {
    console.log('⚠️  WARNING: Some requirements are missing. Check the logs above.');
}
console.log('----------------------------------------------');
