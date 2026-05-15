// ===================================================================
// PlayGround Points – Slack Recognition Bot
// Monitors a specific Slack channel for recognition messages
// ===================================================================

const { App } = require('@slack/bolt');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ===== CONFIGURATION =====
// Set these in your environment or replace directly:
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'xoxb-your-bot-token';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || 'your-signing-secret';
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || 'xapp-your-app-token'; // For Socket Mode
const RECOGNITION_CHANNEL = process.env.RECOGNITION_CHANNEL || 'playgroundpoints'; // Channel name to monitor
const PORT = process.env.PORT || 3000;

// ===== DATA STORE =====
const DATA_FILE = path.join(__dirname, 'recognition-data.json');
const USERS_FILE = path.join(__dirname, 'registered-users.json');

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading data:', e.message);
    }
    return { recognitions: [], lastUpdated: null };
}

function saveData(data) {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading users:', e.message);
    }
    return [];
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isRegisteredUser(name) {
    const users = loadUsers();
    const normalised = name.toLowerCase().trim();
    return users.some(u => {
        const fullName = `${u.firstName} ${u.lastName}`.toLowerCase().trim();
        return fullName === normalised;
    });
}

let store = loadData();

// ===== RECOGNITION PATTERNS =====
// The bot looks for these patterns in the monitored channel:
//
//   @user kudos for teamwork! +25
//   :star: @user great job on the release!
//   /recognize @user 50 innovation Amazing work
//   @user +10 :trophy: incredible leadership
//
const RECOGNITION_REGEX = /(?:kudos|recognize|props|shoutout|thanks|thank you|well done|great job|amazing|awesome|bravo|:star:|:trophy:|:tada:|:clap:|:100:|:raised_hands:|\+\d+)/i;

const CATEGORY_KEYWORDS = {
    teamwork: ['teamwork', 'team', 'collaboration', 'together', 'helped', 'support', 'cooperative'],
    innovation: ['innovation', 'innovative', 'creative', 'idea', 'solution', 'clever', 'inventive'],
    leadership: ['leadership', 'leader', 'led', 'guided', 'mentor', 'direction', 'initiative'],
    customer: ['customer', 'client', 'user', 'service', 'satisfaction', 'delivery'],
    growth: ['growth', 'learning', 'improved', 'development', 'progress', 'skills', 'grew'],
    culture: ['culture', 'values', 'positive', 'energy', 'morale', 'spirit', 'champion', 'fun']
};

function detectCategory(text) {
    const lower = text.toLowerCase();
    let bestCat = 'teamwork';
    let bestScore = 0;
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        const score = keywords.filter(kw => lower.includes(kw)).length;
        if (score > bestScore) {
            bestScore = score;
            bestCat = cat;
        }
    }
    return bestCat;
}

function detectPoints(text) {
    // Look for explicit points: +25, +50, etc.
    const match = text.match(/\+(\d+)/);
    if (match) {
        const pts = parseInt(match[1]);
        if ([5, 10, 25, 50, 100].includes(pts)) return pts;
        if (pts <= 10) return 10;
        if (pts <= 25) return 25;
        if (pts <= 50) return 50;
        return 100;
    }
    // Default points based on recognition intensity
    const lower = text.toLowerCase();
    if (lower.includes(':100:') || lower.includes('outstanding') || lower.includes('exceptional')) return 50;
    if (lower.includes(':trophy:') || lower.includes('amazing') || lower.includes('incredible')) return 25;
    return 10; // default
}

// ===== SLACK BOT =====
const hasSlackTokens = !SLACK_BOT_TOKEN.startsWith('xoxb-your') && !SLACK_APP_TOKEN.startsWith('xapp-your');

let slackApp = null;
if (hasSlackTokens) {
    slackApp = new App({
        token: SLACK_BOT_TOKEN,
        signingSecret: SLACK_SIGNING_SECRET,
        socketMode: true,
        appToken: SLACK_APP_TOKEN,
    });
}

// Listen to ALL messages in the recognition channel (only if Slack is configured)
if (slackApp) {
slackApp.message(async ({ message, client }) => {
    try {
        // Ignore bot messages, edits, and deletions
        if (message.subtype || message.bot_id) return;

        // Check if this message is in our recognition channel
        const channelInfo = await client.conversations.info({ channel: message.channel });
        const channelName = channelInfo.channel.name;

        if (channelName !== RECOGNITION_CHANNEL) return;

        console.log(`📨 Message in #${channelName}: ${message.text}`);

        // Extract mentioned users
        const mentionedUsers = [];
        const mentionRegex = /<@(\w+)>/g;
        let mentionMatch;
        while ((mentionMatch = mentionRegex.exec(message.text)) !== null) {
            mentionedUsers.push(mentionMatch[1]);
        }

        if (mentionedUsers.length === 0) {
            console.log('   ↳ No users mentioned, skipping.');
            return;
        }

        // Get sender info
        const senderInfo = await client.users.info({ user: message.user });
        const senderName = senderInfo.user.real_name || senderInfo.user.name;

        // Process each mentioned user as a recognition recipient
        for (const userId of mentionedUsers) {

            const recipientInfo = await client.users.info({ user: userId });
            const recipientName = recipientInfo.user.real_name || recipientInfo.user.name;

            // Only capture if the recipient is a registered user in the app
            if (!isRegisteredUser(recipientName)) {
                console.log(`   ⏭️  Skipping ${recipientName} — not a registered user.`);
                continue;
            }

            // Resolve <@USER_ID> mentions to real names in the message
            let resolvedText = message.text;
            const idMatches = resolvedText.match(/<@(\w+)>/g) || [];
            for (const idMatch of idMatches) {
                const uid = idMatch.replace(/<@|>/g, '');
                try {
                    const info = await client.users.info({ user: uid });
                    const name = info.user.real_name || info.user.name;
                    resolvedText = resolvedText.replace(idMatch, `@${name}`);
                } catch (e) { /* keep raw ID if lookup fails */ }
            }

            const recognition = {
                id: Date.now() + Math.random(),
                from: {
                    slackId: message.user,
                    name: senderName
                },
                to: {
                    slackId: userId,
                    name: recipientName
                },
                category: detectCategory(resolvedText),
                points: detectPoints(resolvedText),
                message: resolvedText,
                slackMessageTs: message.ts,
                channel: channelName,
                timestamp: new Date().toISOString()
            };

            store.recognitions.push(recognition);
            saveData(store);

            console.log(`   ✅ Recognition: ${senderName} → ${recipientName} | ${recognition.points} pts | ${recognition.category}`);
        }

        // React to the message to confirm it was captured
        await client.reactions.add({
            channel: message.channel,
            name: 'star',
            timestamp: message.ts
        });

    } catch (error) {
        // If reaction already exists, that's fine
        if (error.data?.error !== 'already_reacted') {
            console.error('Error processing message:', error.message);
        }
    }
});

// Slash command: /recognize @user 25 teamwork Great job!
slackApp.command('/recognize', async ({ command, ack, client }) => {
    await ack();

    const text = command.text;
    const mentionRegex = /<@(\w+)\|?[^>]*>/;
    const mentionMatch = text.match(mentionRegex);

    if (!mentionMatch) {
        await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: '❌ Please mention someone to recognize. Usage: `/recognize @user 25 teamwork Great job!`'
        });
        return;
    }

    const recipientId = mentionMatch[1];
    const restOfText = text.replace(mentionRegex, '').trim();

    const senderInfo = await client.users.info({ user: command.user_id });
    const recipientInfo = await client.users.info({ user: recipientId });

    const recognition = {
        id: Date.now(),
        from: {
            slackId: command.user_id,
            name: senderInfo.user.real_name || senderInfo.user.name
        },
        to: {
            slackId: recipientId,
            name: recipientInfo.user.real_name || recipientInfo.user.name
        },
        category: detectCategory(restOfText),
        points: detectPoints(restOfText),
        message: restOfText,
        channel: command.channel_name,
        timestamp: new Date().toISOString()
    };

    store.recognitions.push(recognition);
    saveData(store);

    // Post a public message in the channel
    await client.chat.postMessage({
        channel: command.channel_id,
        text: `🌟 *${recognition.from.name}* recognized *${recognition.to.name}* for *${recognition.category}*! (+${recognition.points} pts)\n> ${restOfText}`
    });
});
} // end if (slackApp)

// ===== EXPRESS API (serves data to the frontend) =====
const api = express();
api.use(cors());
api.use(express.json());
api.use(express.static(__dirname)); // Serve playground.html

// Get all recognitions
api.get('/api/recognitions', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const sorted = [...store.recognitions].sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    res.json(sorted.slice(0, limit));
});

// Get recognitions for a specific user
api.get('/api/recognitions/user/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name).toLowerCase();
    const userRecs = store.recognitions.filter(r =>
        r.to.name.toLowerCase().includes(name) ||
        r.from.name.toLowerCase().includes(name)
    );
    res.json(userRecs);
});

// Get leaderboard
api.get('/api/leaderboard', (req, res) => {
    const scores = {};
    store.recognitions.forEach(r => {
        const key = r.to.name;
        if (!scores[key]) scores[key] = { name: key, received: 0, points: 0 };
        scores[key].received++;
        scores[key].points += r.points;
    });
    const sorted = Object.values(scores).sort((a, b) => b.points - a.points);
    res.json(sorted);
});

// Get stats summary
api.get('/api/stats', (req, res) => {
    const total = store.recognitions.length;
    const totalPoints = store.recognitions.reduce((sum, r) => sum + r.points, 0);
    const uniqueGivers = new Set(store.recognitions.map(r => r.from.name)).size;
    const uniqueReceivers = new Set(store.recognitions.map(r => r.to.name)).size;
    res.json({ total, totalPoints, uniqueGivers, uniqueReceivers, lastUpdated: store.lastUpdated });
});

// ===== USER REGISTRATION =====
api.get('/api/users', (req, res) => {
    res.json(loadUsers());
});

api.post('/api/users', (req, res) => {
    const { firstName, lastName } = req.body;
    if (!firstName || !lastName || !firstName.trim() || !lastName.trim()) {
        return res.status(400).json({ error: 'First name and last name are required.' });
    }
    const users = loadUsers();
    const fn = firstName.trim();
    const ln = lastName.trim();
    // Check for duplicate
    const exists = users.some(u =>
        u.firstName.toLowerCase() === fn.toLowerCase() &&
        u.lastName.toLowerCase() === ln.toLowerCase()
    );
    if (exists) {
        return res.status(409).json({ error: 'User already registered.' });
    }
    const newUser = {
        id: Date.now(),
        firstName: fn,
        lastName: ln,
        registeredAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);
    console.log(`👤 New user registered: ${fn} ${ln}`);
    res.status(201).json(newUser);
});

api.delete('/api/users/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let users = loadUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return res.status(404).json({ error: 'User not found.' });
    users.splice(idx, 1);
    saveUsers(users);
    res.json({ ok: true });
});

// ===== PADEL SESSION REGISTRATION =====
const PADEL_FILE = path.join(__dirname, 'padel-registrations.json');

function loadPadelRegistrations() {
    try {
        if (fs.existsSync(PADEL_FILE)) {
            return JSON.parse(fs.readFileSync(PADEL_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading padel registrations:', e.message);
    }
    return [];
}

function savePadelRegistrations(data) {
    fs.writeFileSync(PADEL_FILE, JSON.stringify(data, null, 2));
}

api.post('/api/padel/register', (req, res) => {
    const { name, email, session, time, type, date } = req.body;
    if (!name || !email || !session) {
        return res.status(400).json({ error: 'Name, email, and session are required.' });
    }
    const registrations = loadPadelRegistrations();
    const entry = {
        id: Date.now(),
        name: name.trim(),
        email: email.trim(),
        session,
        time,
        type,
        date,
        registeredAt: new Date().toISOString()
    };
    registrations.push(entry);
    savePadelRegistrations(registrations);
    console.log(`🎾 Padel registration: ${name} for ${session} ${time}`);
    res.status(201).json(entry);
});

api.get('/api/padel/registrations', (req, res) => {
    res.json(loadPadelRegistrations());
});

// Health check
api.get('/api/health', (req, res) => {
    res.json({ status: 'ok', channel: RECOGNITION_CHANNEL, recognitions: store.recognitions.length });
});

// Re-scrape history on demand
api.post('/api/scrape', async (req, res) => {
    if (!hasSlackTokens || !slackApp) {
        return res.status(400).json({ error: 'Slack bot not configured.' });
    }
    await scrapeHistory();
    res.json({ ok: true, recognitions: store.recognitions.length });
});

// ===== START =====
async function start() {
    // Start Express API
    api.listen(PORT, () => {
        console.log(`\n🎮 PlayGround Points API running at http://localhost:${PORT}`);
        console.log(`📄 Open http://localhost:${PORT}/playground.html\n`);
    });

    // Start Slack bot (only if real tokens are configured)
    if (!hasSlackTokens) {
        console.log('⚠️  Slack bot NOT started — set your tokens in environment variables.');
        console.log('   See SLACK-SETUP.md for instructions.');
        console.log('   Existing recognition data will still be served via the API.\n');
    } else {
        await slackApp.start();
        console.log(`🤖 Slack bot connected! Monitoring #${RECOGNITION_CHANNEL} channel.`);
        await scrapeHistory();
    }
}

// ===== SCRAPE CHANNEL HISTORY =====
async function scrapeHistory() {
    try {
        console.log(`\n📜 Scraping history from #${RECOGNITION_CHANNEL}...`);

        // Find the channel ID by name
        let channelId = null;
        let cursor;
        do {
            const list = await slackApp.client.conversations.list({
                types: 'public_channel,private_channel',
                limit: 200,
                cursor
            });
            const ch = list.channels.find(c => c.name === RECOGNITION_CHANNEL);
            if (ch) { channelId = ch.id; break; }
            cursor = list.response_metadata?.next_cursor;
        } while (cursor);

        if (!channelId) {
            console.log(`   ❌ Channel #${RECOGNITION_CHANNEL} not found.`);
            return;
        }

        // Track existing message timestamps to avoid duplicates
        const existingTs = new Set(store.recognitions.map(r => r.slackMessageTs).filter(Boolean));

        // Paginate through all history
        let allMessages = [];
        let historyCursor;
        do {
            const result = await slackApp.client.conversations.history({
                channel: channelId,
                limit: 200,
                cursor: historyCursor
            });
            allMessages = allMessages.concat(result.messages || []);
            historyCursor = result.response_metadata?.next_cursor;
        } while (historyCursor);

        console.log(`   Found ${allMessages.length} total messages.`);

        // User info cache to avoid repeated API calls
        const userCache = {};
        async function getUserName(userId) {
            if (userCache[userId]) return userCache[userId];
            const info = await slackApp.client.users.info({ user: userId });
            const name = info.user.real_name || info.user.name;
            userCache[userId] = name;
            return name;
        }

        let scraped = 0;
        let skipped = 0;

        for (const msg of allMessages) {
            // Skip bot messages, edits, subtyped messages
            if (msg.subtype || msg.bot_id) continue;
            // Skip already-captured messages
            if (existingTs.has(msg.ts)) continue;
            if (!msg.text) continue;

            // Extract mentioned users
            const mentionRegex = /<@(\w+)>/g;
            const mentionedUsers = [];
            let match;
            while ((match = mentionRegex.exec(msg.text)) !== null) {
                mentionedUsers.push(match[1]);
            }
            if (mentionedUsers.length === 0) continue;

            const senderName = await getUserName(msg.user);

            for (const userId of mentionedUsers) {

                const recipientName = await getUserName(userId);

                if (!isRegisteredUser(recipientName)) {
                    skipped++;
                    continue;
                }

                // Resolve <@USER_ID> mentions to real names
                let resolvedText = msg.text;
                const idMatches = resolvedText.match(/<@(\w+)>/g) || [];
                for (const idMatch of idMatches) {
                    const uid = idMatch.replace(/<@|>/g, '');
                    resolvedText = resolvedText.replace(idMatch, `@${await getUserName(uid)}`);
                }

                const recognition = {
                    id: Date.now() + Math.random(),
                    from: { slackId: msg.user, name: senderName },
                    to: { slackId: userId, name: recipientName },
                    category: detectCategory(resolvedText),
                    points: detectPoints(resolvedText),
                    message: resolvedText,
                    slackMessageTs: msg.ts,
                    channel: RECOGNITION_CHANNEL,
                    timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString()
                };

                store.recognitions.push(recognition);
                scraped++;
            }
        }

        if (scraped > 0) {
            saveData(store);
        }
        console.log(`   ✅ Scraped ${scraped} recognitions (${skipped} skipped — not registered).`);
    } catch (error) {
        console.error('   ❌ History scrape error:', error.message);
        if (error.data) console.error('   Error details:', JSON.stringify(error.data));
    }
}

start().catch(console.error);
