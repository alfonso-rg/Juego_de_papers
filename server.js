require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// --- CONFIGURACION ---
const app = express();
const server = http.createServer(app);

// Trust proxy - Necesario para Render y otros servicios de hosting
app.set('trust proxy', 1);

// JWT Secret (debe estar en .env en producción)
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3001'];

// CORS restringido
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true
    }
});

// Helmet para headers de seguridad
app.use(helmet({
    contentSecurityPolicy: false // Desactivado para permitir SweetAlert2 y Socket.io
}));

// CORS con whitelist
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Rate limiting general
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // límite de 100 requests por IP
    message: 'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde'
});

// Rate limiting estricto para operaciones sensibles
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Demasiadas peticiones, intenta de nuevo más tarde'
});

app.use(limiter);
app.use(express.json({ limit: '10kb' })); // Limitar tamaño de payload
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conectado a MongoDB Atlas"))
    .catch(err => console.error("Error MongoDB:", err));

// --- MODELOS ---
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Contraseña hasheada
    mustChangePassword: { type: Boolean, default: true }, // Fuerza cambio en primer login
    stats: {
        totalPoints: { type: Number, default: 0 },
        weeklyPoints: { type: Number, default: 0 },
        timelineWins: { solo: { type: Number, default: 0 }, duel: { type: Number, default: 0 } },
        matchingWins: { solo: { type: Number, default: 0 }, duel: { type: Number, default: 0 } }
    }
});
const Player = mongoose.model('Player', PlayerSchema);

const PaperSchema = new mongoose.Schema({
    title: { type: String, required: true, maxlength: 500 },
    authors: { type: String, required: true, maxlength: 300 },
    journal: { type: String, required: true, maxlength: 300 },
    year: { type: Number, required: true, min: 1800, max: 2100 },
    addedBy: { type: String }
});
const Paper = mongoose.model('Paper', PaperSchema);

// --- MIDDLEWARES DE SEGURIDAD ---

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }
        req.user = user;
        next();
    });
};

// Middleware para validar errores
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Función para sanitizar strings (prevenir NoSQL injection)
const sanitizeString = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim().substring(0, 500);
};

// --- VARIABLES DE JUEGO MULTIJUGADOR ---
let activeGames = {};

// --- SOCKET.IO (LOGICA DE DUELOS 2-3 JUGADORES) ---

// Middleware de autenticación para Socket.io
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return next(new Error('Authentication error'));
        }
        socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    console.log('Nuevo jugador conectado:', socket.id, 'Usuario:', socket.user.name);

    // Al entrar al lobby, enviamos lista de partidas
    socket.on('enter_lobby', () => {
        socket.emit('lobby_update', activeGames);
    });

    // Crear una partida nueva
    socket.on('create_game', ({ playerName, gameType, paperCount, maxPlayers }) => {
        // Validación de inputs
        if (playerName !== socket.user.name) {
            return socket.emit('error', 'No puedes crear una partida con otro nombre');
        }

        if (!['timeline', 'matching'].includes(gameType)) {
            return socket.emit('error', 'Tipo de juego inválido');
        }

        const validPaperCounts = [3, 4, 5];
        const validMaxPlayers = [2, 3];

        if (!validPaperCounts.includes(paperCount) || !validMaxPlayers.includes(maxPlayers)) {
            return socket.emit('error', 'Parámetros inválidos');
        }

        // Usar crypto para generar ID seguro
        const crypto = require('crypto');
        const gameId = 'game_' + crypto.randomBytes(8).toString('hex');

        activeGames[gameId] = {
            id: gameId,
            host: sanitizeString(playerName),
            gameType: gameType,
            paperCount: paperCount,
            maxPlayers: maxPlayers,
            players: [{ id: socket.id, name: sanitizeString(playerName) }],
            state: 'waiting',
            finishOrder: []
        };

        socket.join(gameId);
        io.emit('lobby_update', activeGames);
        socket.emit('game_created', { gameId });
    });

    // Unirse a una partida existente
    socket.on('join_game', async ({ gameId, playerName }) => {
        // Validación
        if (playerName !== socket.user.name) {
            return socket.emit('error', 'No puedes unirte con otro nombre');
        }

        const game = activeGames[gameId];
        if (game && game.state === 'waiting' && game.players.length < game.maxPlayers) {
            game.players.push({ id: socket.id, name: sanitizeString(playerName) });
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
        // Validación
        if (playerName !== socket.user.name) {
            return socket.emit('error', 'No puedes terminar con otro nombre');
        }

        const game = activeGames['playing_' + gameId];
        if (!game || !correct) return;

        // Evitar duplicados
        const sanitizedName = sanitizeString(playerName);
        if (game.finishOrder.includes(sanitizedName)) return;

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

// Login con JWT
app.post('/api/login',
    strictLimiter,
    body('name').trim().isLength({ min: 1, max: 50 }).escape(),
    body('password').isLength({ min: 1 }),
    validate,
    async (req, res) => {
        try {
            const { name, password } = req.body;

            const player = await Player.findOne({ name });
            if (!player) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const validPassword = await bcrypt.compare(password, player.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const token = jwt.sign(
                { name: player.name, id: player._id },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                player: {
                    name: player.name,
                    stats: player.stats,
                    mustChangePassword: player.mustChangePassword
                }
            });
        } catch (e) {
            res.status(500).json({ error: 'Error en el servidor' });
        }
    }
);

// Cambiar contraseña
app.post('/api/change-password',
    authenticateToken,
    strictLimiter,
    body('currentPassword').isLength({ min: 1 }),
    body('newPassword').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    validate,
    async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            const playerName = req.user.name;

            const player = await Player.findOne({ name: playerName });
            if (!player) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            // Verificar contraseña actual
            const validPassword = await bcrypt.compare(currentPassword, player.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Contraseña actual incorrecta' });
            }

            // Hashear nueva contraseña
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Actualizar contraseña y marcar que ya no necesita cambio
            await Player.findOneAndUpdate(
                { name: playerName },
                {
                    password: hashedPassword,
                    mustChangePassword: false
                }
            );

            console.log(`Password changed by ${playerName}`);
            res.json({ success: true, message: 'Contraseña actualizada correctamente' });

        } catch (e) {
            console.error('Error changing password:', e);
            res.status(500).json({ error: 'Error al cambiar la contraseña' });
        }
    }
);

// Jugadores (sin contraseñas)
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find().select('-password').sort('name');
        res.json(players);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

// Papers CRUD - Protegidos con autenticación
app.post('/api/paper',
    authenticateToken,
    body('title').trim().isLength({ min: 1, max: 500 }).escape(),
    body('authors').trim().isLength({ min: 1, max: 300 }).escape(),
    body('journal').trim().isLength({ min: 1, max: 300 }).escape(),
    body('year').isInt({ min: 1800, max: 2100 }),
    validate,
    async (req, res) => {
        try {
            const { title, authors, journal, year } = req.body;
            const newPaper = new Paper({
                title: sanitizeString(title),
                authors: sanitizeString(authors),
                journal: sanitizeString(journal),
                year: parseInt(year),
                addedBy: req.user.name
            });
            await newPaper.save();
            res.json({ success: true });
        } catch(e) {
            res.status(500).json({ error: 'Error al guardar el paper' });
        }
    }
);

app.put('/api/paper/:id',
    authenticateToken,
    param('id').isMongoId(),
    body('title').trim().isLength({ min: 1, max: 500 }).escape(),
    body('authors').trim().isLength({ min: 1, max: 300 }).escape(),
    body('journal').trim().isLength({ min: 1, max: 300 }).escape(),
    body('year').isInt({ min: 1800, max: 2100 }),
    validate,
    async (req, res) => {
        try {
            const { title, authors, journal, year } = req.body;
            await Paper.findByIdAndUpdate(req.params.id, {
                title: sanitizeString(title),
                authors: sanitizeString(authors),
                journal: sanitizeString(journal),
                year: parseInt(year)
            });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Error al actualizar el paper' });
        }
    }
);

app.delete('/api/paper/:id',
    authenticateToken,
    param('id').isMongoId(),
    validate,
    async (req, res) => {
        try {
            await Paper.findByIdAndDelete(req.params.id);
            res.json({ success: true });
        } catch(e) {
            res.status(500).json({ error: 'Error al eliminar el paper' });
        }
    }
);

app.get('/api/papers/all', async (req, res) => {
    try {
        const papers = await Paper.find().sort({ year: -1 });
        res.json(papers);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Obtener papers para juego - Requiere autenticación
app.get('/api/game',
    authenticateToken,
    async (req, res) => {
        try {
            const count = parseInt(req.query.count) || 5;
            if (count < 2 || count > 5) {
                return res.status(400).json({ error: "Count debe ser entre 2 y 5" });
            }
            const papers = await getGamePapers(count);
            res.json(papers);
        } catch (e) {
            res.status(400).json({ error: "No hay suficientes papers" });
        }
    }
);

// Guardar puntuacion (modo solo) - Requiere autenticación
app.post('/api/score',
    authenticateToken,
    body('points').isInt({ min: -10, max: 10 }),
    body('gameType').isIn(['timeline', 'matching']),
    validate,
    async (req, res) => {
        try {
            const { points, gameType } = req.body;
            const playerName = req.user.name; // Usar el nombre del token

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
            res.status(500).json({ error: 'Error al guardar puntuación' });
        }
    }
);

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

// Admin - Protegido con autenticación y rate limit estricto
app.post('/api/admin/reset-weekly',
    authenticateToken,
    strictLimiter,
    async (req, res) => {
        try {
            await Player.updateMany({}, { $set: { "stats.weeklyPoints": 0 } });
            console.log(`Admin action: Weekly reset by ${req.user.name}`);
            res.json({ success: true });
        } catch(e) {
            res.status(500).json({ error: 'Error al reiniciar puntos semanales' });
        }
    }
);

app.post('/api/admin/reset-total',
    authenticateToken,
    strictLimiter,
    async (req, res) => {
        try {
            await Player.updateMany({}, { $set: { "stats.totalPoints": 0 } });
            console.log(`Admin action: Total reset by ${req.user.name}`);
            res.json({ success: true });
        } catch(e) {
            res.status(500).json({ error: 'Error al reiniciar puntos totales' });
        }
    }
);

// Inicializar jugadores con contraseña por defecto
// IMPORTANTE: Cambiar contraseñas después de la primera ejecución
app.get('/init-players', async (req, res) => {
    try {
        const defaultPassword = process.env.DEFAULT_PASSWORD || 'cambiar123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        const nombres = ["Berti", "Ismael", "Alfonso"];
        const results = [];

        for (const nombre of nombres) {
            const existing = await Player.findOne({ name: nombre });
            if (!existing) {
                await Player.create({
                    name: nombre,
                    password: hashedPassword
                });
                results.push(`${nombre}: creado con contraseña por defecto`);
            } else {
                results.push(`${nombre}: ya existe`);
            }
        }

        res.json({
            message: "Inicialización completa",
            results,
            warning: "CAMBIAR CONTRASEÑAS INMEDIATAMENTE"
        });
    } catch (e) {
        res.status(500).json({ error: 'Error al inicializar jugadores' });
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));
