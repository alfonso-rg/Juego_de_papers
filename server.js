require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');

// --- CONFIGURACION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conectado a MongoDB Atlas"))
    .catch(err => console.error("Error MongoDB:", err));

// --- MODELOS ---
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    stats: {
        totalPoints: { type: Number, default: 0 },
        weeklyPoints: { type: Number, default: 0 },
        timelineWins: { solo: { type: Number, default: 0 }, duel: { type: Number, default: 0 } },
        matchingWins: { solo: { type: Number, default: 0 }, duel: { type: Number, default: 0 } }
    }
});
const Player = mongoose.model('Player', PlayerSchema);

const PaperSchema = new mongoose.Schema({
    title: { type: String, required: true },
    authors: { type: String, required: true },
    journal: { type: String, required: true },
    year: { type: Number, required: true },
    addedBy: { type: String }
});
const Paper = mongoose.model('Paper', PaperSchema);

// --- VARIABLES DE JUEGO MULTIJUGADOR ---
let activeGames = {};

// --- SOCKET.IO (LOGICA DE DUELOS 2-3 JUGADORES) ---
io.on('connection', (socket) => {
    console.log('Nuevo jugador conectado:', socket.id);

    // Al entrar al lobby, enviamos lista de partidas
    socket.on('enter_lobby', () => {
        socket.emit('lobby_update', activeGames);
    });

    // Crear una partida nueva
    socket.on('create_game', ({ playerName, gameType, paperCount, maxPlayers }) => {
        const gameId = 'game_' + Math.random().toString(36).substr(2, 9);
        activeGames[gameId] = {
            id: gameId,
            host: playerName,
            gameType: gameType, // 'timeline' o 'matching'
            paperCount: paperCount,
            maxPlayers: maxPlayers, // 2 o 3
            players: [{ id: socket.id, name: playerName }],
            state: 'waiting',
            finishOrder: [] // Para guardar el orden de llegada
        };

        socket.join(gameId);
        io.emit('lobby_update', activeGames);
        socket.emit('game_created', { gameId });
    });

    // Unirse a una partida existente
    socket.on('join_game', async ({ gameId, playerName }) => {
        const game = activeGames[gameId];
        if (game && game.state === 'waiting' && game.players.length < game.maxPlayers) {
            game.players.push({ id: socket.id, name: playerName });
            socket.join(gameId);

            // Si se llena, empezar partida
            if (game.players.length === game.maxPlayers) {
                game.state = 'playing';
                game.finishOrder = [];

                try {
                    const papers = await getGamePapers(game.paperCount);

                    // Preparar datos segun tipo de juego
                    const gameData = {
                        papers: papers,
                        gameType: game.gameType,
                        players: game.players.map(p => p.name)
                    };

                    io.to(gameId).emit('game_start', gameData);

                    // Quitar del lobby
                    delete activeGames[gameId];
                    io.emit('lobby_update', activeGames);

                    // Guardar referencia para el resultado
                    activeGames['playing_' + gameId] = game;

                } catch (e) {
                    io.to(gameId).emit('error', 'No hay suficientes papers para jugar.');
                }
            } else {
                // Avisar a todos en la sala que alguien se unio
                io.to(gameId).emit('player_joined', {
                    players: game.players.map(p => p.name),
                    needed: game.maxPlayers - game.players.length
                });
                io.emit('lobby_update', activeGames);
            }
        }
    });

    // Alguien termino (puede no ser el primero)
    socket.on('duel_finish', async ({ gameId, playerName, correct }) => {
        const game = activeGames['playing_' + gameId];
        if (!game || !correct) return;

        // Evitar duplicados
        if (game.finishOrder.includes(playerName)) return;

        game.finishOrder.push(playerName);
        const position = game.finishOrder.length;

        // Calcular puntos segun posicion (3-2-1)
        const points = Math.max(4 - position, 1);

        // Guardar puntos
        const gameTypeKey = game.gameType === 'timeline' ? 'timelineWins' : 'matchingWins';
        await Player.findOneAndUpdate(
            { name: playerName },
            {
                $inc: {
                    "stats.totalPoints": points,
                    "stats.weeklyPoints": points,
                    [`stats.${gameTypeKey}.duel`]: 1
                }
            }
        );

        // Avisar a todos del resultado parcial
        io.to(gameId).emit('duel_position', {
            playerName,
            position,
            points,
            finishOrder: game.finishOrder
        });

        // Si todos terminaron, cerrar partida
        if (game.finishOrder.length === game.maxPlayers) {
            io.to(gameId).emit('duel_complete', {
                finishOrder: game.finishOrder,
                winner: game.finishOrder[0]
            });
            delete activeGames['playing_' + gameId];
        }
    });

    // Abandonar partida en espera
    socket.on('leave_game', ({ gameId }) => {
        const game = activeGames[gameId];
        if (game) {
            game.players = game.players.filter(p => p.id !== socket.id);
            socket.leave(gameId);

            if (game.players.length === 0) {
                delete activeGames[gameId];
            }
            io.emit('lobby_update', activeGames);
        }
    });

    socket.on('disconnect', () => {
        // Limpiar partidas donde estaba el jugador
        for (const gameId in activeGames) {
            const game = activeGames[gameId];
            if (game.state === 'waiting') {
                game.players = game.players.filter(p => p.id !== socket.id);
                if (game.players.length === 0) {
                    delete activeGames[gameId];
                }
            }
        }
        io.emit('lobby_update', activeGames);
    });
});

// Funcion auxiliar para obtener papers aleatorios
async function getGamePapers(count) {
    const papers = await Paper.aggregate([{ $sample: { size: count } }]);
    if (papers.length < count) throw new Error("Faltan papers");
    return papers;
}

// --- RUTAS API ---

// Jugadores
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find().sort('name');
        res.json(players);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

// Papers CRUD
app.post('/api/paper', async (req, res) => {
    try {
        const { title, authors, journal, year, addedBy } = req.body;
        const newPaper = new Paper({ title, authors, journal, year: parseInt(year), addedBy });
        await newPaper.save();
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/paper/:id', async (req, res) => {
    try {
        const { title, authors, journal, year } = req.body;
        await Paper.findByIdAndUpdate(req.params.id, {
            title, authors, journal, year: parseInt(year)
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/paper/:id', async (req, res) => {
    try {
        await Paper.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/papers/all', async (req, res) => {
    try {
        const papers = await Paper.find().sort({ year: -1 });
        res.json(papers);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Obtener papers para juego
app.get('/api/game', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 5;
        const papers = await getGamePapers(count);
        res.json(papers);
    } catch (e) {
        res.status(400).json({ error: "No hay suficientes papers" });
    }
});

// Guardar puntuacion (modo solo)
app.post('/api/score', async (req, res) => {
    try {
        const { playerName, points, gameType } = req.body;
        const gameTypeKey = gameType === 'timeline' ? 'timelineWins' : 'matchingWins';

        await Player.findOneAndUpdate(
            { name: playerName },
            {
                $inc: {
                    "stats.totalPoints": points,
                    "stats.weeklyPoints": points,
                    [`stats.${gameTypeKey}.solo`]: points > 0 ? 1 : 0
                }
            }
        );
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Rankings
app.get('/api/hof', async (req, res) => {
    try {
        const total = await Player.find().sort({ "stats.totalPoints": -1 }).limit(10);
        const weekly = await Player.find().sort({ "stats.weeklyPoints": -1 }).limit(10);
        res.json({ total, weekly });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin
app.post('/api/admin/reset-weekly', async (req, res) => {
    try {
        await Player.updateMany({}, { $set: { "stats.weeklyPoints": 0 } });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/reset-total', async (req, res) => {
    try {
        await Player.updateMany({}, { $set: { "stats.totalPoints": 0 } });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Inicializar jugadores
app.get('/init-players', async (req, res) => {
    const nombres = ["Berti", "Ismael", "Alfonso"];
    for (const nombre of nombres) {
        await Player.findOneAndUpdate(
            { name: nombre },
            { name: nombre },
            { upsert: true }
        );
    }
    res.send("Jugadores creados/verificados: Berti, Ismael, Alfonso");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));
