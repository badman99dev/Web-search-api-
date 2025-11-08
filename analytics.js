const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');

// Vercel serverless functions have a writable /tmp directory
const DATA_DIR = process.env.VERCEL ? '/tmp' : './data';
const COUNTS_FILE = path.join(DATA_DIR, "request_counts.json");
const TIMES_FILE = path.join(DATA_DIR, "request_times.json");

// Ensure data directory exists
(async () => {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
})();

async function _loadJson(filePath) {
    try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

async function _saveJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function recordRequest(duration = null, numResults = null) {
    const today = new Date().toISOString().split('T')[0];
    let release;
    try {
        // Use a temporary lock file path for Vercel's read-only filesystem
        const lockPath = path.join(DATA_DIR, 'analytics.lock');
        release = await lockfile.lock(DATA_DIR, { lockfilePath: lockPath, retries: 3 });

        // Update counts
        const counts = await _loadJson(COUNTS_FILE);
        counts[today] = (counts[today] || 0) + 1;
        await _saveJson(COUNTS_FILE, counts);

        // Record duration for standard requests
        if (duration !== null && (numResults === null || numResults === 4)) {
            const times = await _loadJson(TIMES_FILE);
            if (!times[today]) {
                times[today] = [];
            }
            times[today].push(Math.round(duration * 100) / 100);
            await _saveJson(TIMES_FILE, times);
        }
    } catch (err) {
        console.error("Failed to record analytics:", err);
    } finally {
        if (release) {
            await release();
        }
    }
}

async function getLastNDaysData(n = 14) {
    const counts = await _loadJson(COUNTS_FILE);
    const records = [];
    for (let i = 0; i < n; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (n - 1 - i));
        const dayStr = d.toISOString().split('T')[0];
        const displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        records.push({
            date: displayDate,
            count: counts[dayStr] || 0
        });
    }
    return records;
}

async function getLastNDaysAvgTimeData(n = 14) {
    const times = await _loadJson(TIMES_FILE);
    const records = [];
    for (let i = 0; i < n; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (n - 1 - i));
        const dayStr = d.toISOString().split('T')[0];
        const displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        const dayTimes = times[dayStr] || [];
        const avgTime = dayTimes.length > 0
            ? Math.round((dayTimes.reduce((a, b) => a + b, 0) / dayTimes.length) * 100) / 100
            : 0;
            
        records.push({
            date: displayDate,
            avg_time: avgTime
        });
    }
    return records;
}

module.exports = { recordRequest, getLastNDaysData, getLastNDaysAvgTimeData };
