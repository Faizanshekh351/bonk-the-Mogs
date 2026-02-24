const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors()); 
app.use(express.static('public')); 

app.get('/', (req, res) => {
    res.send("<h1>🟢 Mogg Backend is Live!</h1><p>The API is ready for your game.</p>");
});

const dbLink = process.env.MONGO_URI || "mongodb+srv://faizanshekh351:Faizan8210@cluster.2qalkge.mongodb.net/moggGame?appName=Cluster";

mongoose.connect(dbLink)
  .then(() => console.log("Connected to MoggDB!"))
  .catch(err => console.error("Database connection error:", err));

const ScoreSchema = new mongoose.Schema({
    playerName: String,
    score: Number,
    date: { type: Date, default: Date.now }
});
const Score = mongoose.model('Score', ScoreSchema);

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    coins: { type: Number, default: 0 },
    unlockedHammers: { type: [String], default: ['default'] },
    equippedHammer: { type: String, default: 'default' },
    unlockedAchievements: { type: [String], default: [] }
});
const User = mongoose.model('User', UserSchema);

// ==========================================
// 2. IN-MEMORY ROOM STORAGE
// ==========================================
const activeRooms = {};

app.post('/api/rooms', (req, res) => {
    const { username } = req.body;
    let passcode;
    do {
        passcode = Math.floor(10000 + Math.random() * 90000).toString();
    } while (activeRooms[passcode]); 

    activeRooms[passcode] = { owner: username, scores: [], infiniteTries: false };

    setTimeout(() => {
        delete activeRooms[passcode];
    }, 86400000); 

    res.json({ passcode });
});

app.get('/api/rooms/:passcode', (req, res) => {
    const { passcode } = req.params;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");
    res.json({ success: true });
});

app.post('/api/rooms/:passcode/toggle-tries', (req, res) => {
    const { passcode } = req.params;
    const { username } = req.body;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");
    if (activeRooms[passcode].owner !== username) return res.status(403).send("Unauthorized.");

    activeRooms[passcode].infiniteTries = !activeRooms[passcode].infiniteTries;
    res.json({ infiniteTries: activeRooms[passcode].infiniteTries });
});

// FIX: Accurately report if they played and what the current rule is
app.get('/api/rooms/:passcode/hasPlayed/:username', (req, res) => {
    const { passcode, username } = req.params;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");

    const room = activeRooms[passcode];
    const hasPlayed = room.scores.some(s => s.playerName === username);

    res.json({ hasPlayed, infiniteTries: room.infiniteTries });
});

app.post('/api/rooms/:passcode/scores', (req, res) => {
    const { passcode } = req.params;
    const { playerName, score } = req.body;

    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");

    const room = activeRooms[passcode];
    const existing = room.scores.find(s => s.playerName === playerName);
    const isOwner = room.owner === playerName;

    if (existing) {
        if (isOwner || room.infiniteTries) {
            if (score > existing.score) existing.score = score;
            return res.send("Score updated!");
        } else {
            return res.status(400).send("Already played in this room.");
        }
    } else {
        room.scores.push({ playerName, score });
        res.send("Room score submitted!");
    }
});

app.get('/api/rooms/:passcode/leaderboard', (req, res) => {
    const { passcode } = req.params;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");

    const sortedScores = activeRooms[passcode].scores.sort((a, b) => b.score - a.score).slice(0, 10);
    res.json(sortedScores);
});

app.post('/api/rooms/:passcode/reset', (req, res) => {
    const { passcode } = req.params;
    const { username } = req.body;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");
    if (activeRooms[passcode].owner !== username) return res.status(403).send("Unauthorized.");

    activeRooms[passcode].scores = [];
    res.send("Scores Reset!");
});

app.post('/api/rooms/:passcode/destroy', (req, res) => {
    const { passcode } = req.params;
    const { username } = req.body;
    if (!activeRooms[passcode]) return res.status(404).send("Room expired.");
    if (activeRooms[passcode].owner !== username) return res.status(403).send("Unauthorized.");

    delete activeRooms[passcode];
    res.send("Room Destroyed!");
});

app.post('/api/guest-login', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || username.trim() === '') return res.status(400).send("Username is required");

        let user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });

        if (!user) {
            user = new User({ username });
            await user.save();
        }

        res.status(200).json({ username: user.username, isReturning: !!user });
    } catch (err) { res.status(500).send("Server Error"); }
});

app.get('/api/anonymous', async (req, res) => {
    try {
        let isUnique = false;
        let anonName = "";
        while (!isUnique) {
            anonName = "AnonMogg_" + Math.floor(Math.random() * 99999);
            const exists = await User.findOne({ username: anonName });
            if (!exists) isUnique = true;
        }
        const newUser = new User({ username: anonName });
        await newUser.save();
        res.status(200).json({ username: anonName });
    } catch (err) { res.status(500).send("Server Error"); }
});

app.post('/api/scores', async (req, res) => {
    try {
        const playerName = req.body.playerName || "Anonymous";
        const newScoreVal = req.body.score;

        let existingScore = await Score.findOne({ playerName: { $regex: new RegExp(`^${playerName}$`, 'i') } });

        if (existingScore) {
            if (newScoreVal > existingScore.score) {
                existingScore.score = newScoreVal;
                existingScore.date = Date.now();
                await existingScore.save();
            }
        } else {
            const newScore = new Score({ playerName, score: newScoreVal });
            await newScore.save();
        }

        res.status(200).send("Score processed!");
    } catch (err) { res.status(500).send("Error saving score"); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topScores = await Score.aggregate([
            { $group: { _id: { $toLower: "$playerName" }, playerName: { $first: "$playerName" }, score: { $max: "$score" } } },
            { $sort: { score: -1 } },
            { $limit: 10 },
            { $project: { _id: 0, playerName: 1, score: 1 } }
        ]);
        res.json(topScores);
    } catch (err) { res.status(500).send("Error fetching leaderboard"); }
});

app.get('/api/scores/:username/best', async (req, res) => {
    try {
        const bestScore = await Score.findOne({ playerName: { $regex: new RegExp(`^${req.params.username}$`, 'i') } }).sort({ score: -1 });
        res.json({ best: bestScore ? bestScore.score : 0 });
    } catch (err) { res.status(500).send("Error fetching best score"); }
});

app.get('/api/users/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: { $regex: new RegExp(`^${req.params.username}$`, 'i') } });
        if (!user) return res.status(404).send("User not found");
        res.json({ coins: user.coins, unlockedHammers: user.unlockedHammers, equippedHammer: user.equippedHammer, unlockedAchievements: user.unlockedAchievements });
    } catch (err) { res.status(500).send("Error fetching user data"); }
});

app.patch('/api/users/:username', async (req, res) => {
    try {
        const { coins, unlockedHammers, equippedHammer, unlockedAchievements } = req.body;
        await User.findOneAndUpdate(
            { username: { $regex: new RegExp(`^${req.params.username}$`, 'i') } },
            { $set: { coins, unlockedHammers, equippedHammer, unlockedAchievements } }
        );
        res.status(200).send("Data synced");
    } catch (err) { res.status(500).send("Error syncing data"); }
});

const listener = app.listen(process.env.PORT || 5000, "0.0.0.0", () => {
    console.log('Your app is listening on port ' + listener.address().port);
});
