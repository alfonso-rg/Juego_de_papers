// VARIABLES GLOBALES
let socket = null;
let authToken = null;
let currentPlayer = null;
let currentPapers = [];
let currentHofData = null;
let attempts = 0;
let isDuel = false;
let currentDuelId = null;
let currentGameType = null;

// Variable para el sistema de click-to-select
let selectedChip = null;

// AL CARGAR LA PAGINA
document.addEventListener('DOMContentLoaded', () => {
    // Intentar recuperar sesión guardada
    const savedToken = localStorage.getItem('authToken');
    const savedPlayer = localStorage.getItem('currentPlayer');

    if (savedToken && savedPlayer) {
        authToken = savedToken;
        currentPlayer = savedPlayer;

        // Verificar si el token sigue siendo válido
        verifyTokenAndLogin();
    } else {
        loadPlayers();
    }
});

// ---------------------------------------------------------
// 1. GESTION DE USUARIOS (LOGIN)
// ---------------------------------------------------------

// Verificar token guardado y auto-login
async function verifyTokenAndLogin() {
    try {
        // Intentar obtener los jugadores (endpoint que no requiere auth)
        const res = await fetch('/api/players');
        if (!res.ok) throw new Error('Session expired');

        // Si funciona, conectar socket y mostrar menú
        initSocket();
        document.getElementById('welcome-msg').textContent = `Hola, ${currentPlayer}`;
        showScreen('menu-screen');
    } catch (e) {
        // Token expirado o inválido, limpiar y volver a login
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentPlayer');
        authToken = null;
        currentPlayer = null;
        loadPlayers();
    }
}

async function loadPlayers() {
    try {
        const res = await fetch('/api/players');
        const players = await res.json();
        const select = document.getElementById('player-select');
        select.innerHTML = '<option value="">Elige tu nombre...</option>';
        players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudieron cargar los jugadores', 'error');
    }
}

async function login() {
    const name = document.getElementById('player-select').value;
    const password = document.getElementById('password-input').value;

    if (!name) {
        Swal.fire('Error', 'Debes seleccionar un nombre', 'warning');
        return;
    }

    if (!password) {
        Swal.fire('Error', 'Debes introducir la contraseña', 'warning');
        return;
    }

    Swal.fire({ title: 'Autenticando...', didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            Swal.fire('Error', data.error || 'Credenciales incorrectas', 'error');
            return;
        }

        // Guardar token y usuario
        authToken = data.token;
        currentPlayer = data.player.name;

        // Guardar en localStorage para persistencia
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentPlayer', currentPlayer);

        // Conectar socket con autenticación
        initSocket();

        document.getElementById('welcome-msg').textContent = `Hola, ${currentPlayer}`;
        Swal.close();

        // Verificar si debe cambiar contraseña
        if (data.player.mustChangePassword) {
            showScreen('change-password-screen');
        } else {
            showScreen('menu-screen');
        }

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Error de conexión con el servidor', 'error');
    }
}

// Inicializar Socket.io con autenticación
function initSocket() {
    if (socket) {
        socket.disconnect();
    }

    socket = io({
        auth: {
            token: authToken
        }
    });

    setupSocketListeners();
}

// Configurar listeners de Socket.io
function setupSocketListeners() {
    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        Swal.fire('Error', 'Error de autenticación. Por favor, vuelve a iniciar sesión.', 'error');
        showScreen('login-screen');
    });

    socket.on('lobby_update', (games) => {
        if (document.getElementById('duel-lobby-screen').classList.contains('hidden')) return;

        const list = document.getElementById('lobbies-list');
        list.innerHTML = '';

        const availableGames = Object.values(games).filter(g => g.state === 'waiting');

        if (availableGames.length === 0) {
            list.innerHTML = '<p style="color:#7f8c8d; font-style:italic;">No hay partidas creadas. Crea una!</p>';
            return;
        }

        availableGames.forEach(game => {
            const div = document.createElement('div');
            div.className = 'lobby-item';

            const typeLabel = game.gameType === 'timeline' ? 'Timeline' : 'Matching';
            const playersNeeded = game.maxPlayers - game.players.length;

            let actionBtn = '';
            if (!game.players.find(p => p.name === currentPlayer)) {
                actionBtn = `<button class="btn-green small" onclick="joinDuel('${game.id}')">Unirse</button>`;
            } else {
                actionBtn = `<span style="color:#f1c40f; font-size:0.8em;">(Tu partida)</span>`;
            }

            div.innerHTML = `
                <div class="info">
                    <div class="host">${game.host}</div>
                    <div class="details">${typeLabel} | ${game.paperCount} papers | Faltan ${playersNeeded}</div>
                </div>
                ${actionBtn}
            `;
            list.appendChild(div);
        });
    });

    socket.on('game_created', ({ gameId }) => {
        currentDuelId = gameId;
        showScreen('duel-wait-screen');
    });

    socket.on('player_joined', ({ players, needed }) => {
        const waitDiv = document.getElementById('players-waiting');
        waitDiv.innerHTML = `<p>Jugadores: ${players.join(', ')}</p><p>Faltan: ${needed}</p>`;
    });

    socket.on('game_start', ({ papers, gameType, players }) => {
        isDuel = true;
        currentPapers = papers;
        currentGameType = gameType;
        attempts = 0;

        const opponents = players.filter(p => p !== currentPlayer).join(', ');
        const title = `Duelo vs ${opponents}`;

        if (gameType === 'timeline') {
            renderTimeline(title);
        } else {
            renderMatching(title);
        }
    });

    socket.on('duel_position', ({ playerName, position, points, finishOrder }) => {
        if (playerName === currentPlayer) {
            const medals = ['', '1ro', '2do', '3ro'];
            Swal.fire({
                title: `${medals[position]}! +${points} puntos`,
                icon: position === 1 ? 'success' : 'info',
                timer: 2000,
                showConfirmButton: false
            });
        }
    });

    socket.on('duel_complete', ({ finishOrder, winner }) => {
        showDuelResults(finishOrder);
    });

    socket.on('error', (message) => {
        Swal.fire('Error', message, 'error');
    });
}

// ---------------------------------------------------------
// 2. LOGICA DEL MULTIJUGADOR (SOCKETS)
// ---------------------------------------------------------

// Helper para hacer fetch con autenticación
async function authenticatedFetch(url, options = {}) {
    if (!authToken) {
        throw new Error('No autenticado');
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        ...options.headers
    };

    return fetch(url, { ...options, headers });
}

function enterDuelLobby() {
    showScreen('duel-lobby-screen');
    socket.emit('enter_lobby');
}

function createDuel() {
    const gameType = document.getElementById('duel-type').value;
    const paperCount = parseInt(document.getElementById('duel-papers').value);
    const maxPlayers = parseInt(document.getElementById('duel-players').value);

    socket.emit('create_game', {
        playerName: currentPlayer,
        gameType,
        paperCount,
        maxPlayers
    });
}

function joinDuel(gameId) {
    currentDuelId = gameId;
    socket.emit('join_game', { gameId, playerName: currentPlayer });
    showScreen('duel-wait-screen');
}

function leaveDuel() {
    if (currentDuelId) {
        socket.emit('leave_game', { gameId: currentDuelId });
        currentDuelId = null;
    }
    showScreen('duel-lobby-screen');
    socket.emit('enter_lobby');
}

function showDuelResults(finishOrder) {
    const container = document.getElementById('duel-results');
    const medals = ['', '1ro', '2do', '3ro'];
    const points = [0, 3, 2, 1];
    const classes = ['', 'first', 'second', 'third'];
    const emojis = ['', '', '', ''];

    let html = '';
    finishOrder.forEach((name, idx) => {
        const pos = idx + 1;
        html += `
            <div class="result-item ${classes[pos]}">
                <div style="display:flex; align-items:center;">
                    <span class="position-badge">${emojis[pos]}</span>
                    <span class="result-name">${name}</span>
                </div>
                <span class="result-points">+${points[pos]} pts</span>
            </div>
        `;
    });

    container.innerHTML = html;
    showScreen('duel-result-screen');
}

// ---------------------------------------------------------
// 3. JUEGO TIMELINE
// ---------------------------------------------------------

async function setupGame(gameType, mode) {
    isDuel = false;
    currentGameType = gameType;

    const { value: count } = await Swal.fire({
        title: 'Cuantos papers?',
        input: 'range',
        inputLabel: 'Elige dificultad',
        inputAttributes: { min: 2, max: 5, step: 1 },
        inputValue: 3
    });

    if (count) {
        startSoloGame(gameType, count);
    }
}

async function startSoloGame(gameType, count) {
    Swal.fire({ title: 'Cargando...', didOpen: () => Swal.showLoading() });
    attempts = 0;

    try {
        const res = await authenticatedFetch(`/api/game?count=${count}`);
        if (!res.ok) throw new Error('Error');
        currentPapers = await res.json();

        if (gameType === 'timeline') {
            renderTimeline('Modo Solitario');
        } else {
            renderMatching('Modo Solitario');
        }
        Swal.close();
    } catch (e) {
        Swal.fire('Ups', 'No hay suficientes papers en la base de datos.', 'info');
    }
}

function renderTimeline(titleText) {
    document.getElementById('timeline-title').textContent = titleText;
    const container = document.getElementById('timeline-container');
    container.innerHTML = '';

    // Barajar
    const shuffled = [...currentPapers].sort(() => Math.random() - 0.5);

    shuffled.forEach(paper => {
        const div = document.createElement('div');
        div.className = 'timeline-card';
        div.dataset.id = paper._id;
        div.innerHTML = `
            <span class="title">${paper.title}</span>
            <span class="drag-handle">&#8801;</span>
        `;
        container.appendChild(div);
    });

    // SortableJS con soporte mejorado para touch
    if (window.sortableInstance) window.sortableInstance.destroy();
    window.sortableInstance = new Sortable(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        touchStartThreshold: 3,
        delay: 100,
        delayOnTouchOnly: true,
        forceFallback: true, // Mejor soporte movil
        fallbackTolerance: 3
    });

    showScreen('timeline-screen');
}

async function checkTimeline() {
    attempts++;
    const container = document.getElementById('timeline-container');
    const playerOrderIds = Array.from(container.children).map(c => c.dataset.id);

    // Orden correcto por ano
    const correctOrder = [...currentPapers].sort((a, b) => a.year - b.year);

    // NUEVA LOGICA: Verificar si el orden es valido considerando empates de ano
    const isWin = isValidTimelineOrder(playerOrderIds, correctOrder);

    if (isWin) {
        if (isDuel) {
            socket.emit('duel_finish', { gameId: currentDuelId, playerName: currentPlayer, correct: true });
        } else {
            if (attempts === 1) {
                const points = currentPapers.length;
                Swal.fire('PERFECTO!', `A la primera: +${points} puntos`, 'success');
                await saveScore(points, 'timeline');
            } else {
                Swal.fire('Correcto!', 'Orden correcto, pero sin puntos (no fue al primer intento).', 'info');
            }
            showScreen('menu-screen');
        }
    } else {
        if (isDuel) {
            Swal.fire('Incorrecto!', 'Rapido, intentalo de nuevo!', 'error');
        } else {
            if (attempts === 1) {
                const penalty = -(currentPapers.length - 1);
                Swal.fire('Fallaste!', `Primer intento fallido: ${penalty} puntos.`, 'error');
                await saveScore(penalty, 'timeline');
            } else {
                Swal.fire('Sigue mal...', 'Revisa los anos.', 'error');
            }
        }
    }
}

// NUEVA FUNCION: Verificar orden valido permitiendo cualquier orden entre papers del mismo ano
function isValidTimelineOrder(playerOrderIds, correctOrder) {
    // Crear un mapa de id -> paper para acceso rapido
    const paperMap = {};
    currentPapers.forEach(p => paperMap[p._id] = p);

    // Obtener los anos en el orden del jugador
    const playerYears = playerOrderIds.map(id => paperMap[id].year);

    // Verificar que los anos esten en orden no decreciente
    for (let i = 1; i < playerYears.length; i++) {
        if (playerYears[i] < playerYears[i - 1]) {
            return false; // Un paper mas reciente esta antes que uno mas antiguo
        }
    }

    return true;
}

// ---------------------------------------------------------
// 4. JUEGO MATCHING (con soporte click-to-select y touch)
// ---------------------------------------------------------

let draggedElement = null;

function renderMatching(titleText) {
    document.getElementById('matching-title').textContent = titleText;

    const papersContainer = document.getElementById('papers-list');
    const poolContainer = document.getElementById('attributes-pool');
    papersContainer.innerHTML = '';
    poolContainer.innerHTML = '';
    
    // Resetear seleccion
    selectedChip = null;

    // Crear cards de papers
    currentPapers.forEach(paper => {
        const div = document.createElement('div');
        div.className = 'paper-card';
        div.dataset.id = paper._id;
        div.innerHTML = `
            <div class="paper-title">${paper.title}</div>
            <div class="drop-zones">
                <div class="drop-zone" data-type="year" data-paper="${paper._id}">Ano: ?</div>
                <div class="drop-zone" data-type="authors" data-paper="${paper._id}">Autores: ?</div>
                <div class="drop-zone" data-type="journal" data-paper="${paper._id}">Journal: ?</div>
            </div>
        `;
        papersContainer.appendChild(div);
    });

    // Crear chips de atributos (mezclados)
    const allAttributes = [];
    currentPapers.forEach(paper => {
        allAttributes.push({ type: 'year', value: paper.year, paperId: paper._id });
        allAttributes.push({ type: 'authors', value: paper.authors, paperId: paper._id });
        allAttributes.push({ type: 'journal', value: paper.journal, paperId: paper._id });
    });

    // Barajar
    allAttributes.sort(() => Math.random() - 0.5);

    allAttributes.forEach((attr, idx) => {
        const chip = document.createElement('div');
        chip.className = `attribute-chip ${attr.type}`;
        chip.draggable = true;
        chip.dataset.type = attr.type;
        chip.dataset.value = attr.value;
        chip.dataset.paperId = attr.paperId;
        chip.id = `chip-${idx}`;
        chip.textContent = attr.value;

        // Drag events (para desktop)
        chip.addEventListener('dragstart', handleDragStart);
        chip.addEventListener('dragend', handleDragEnd);
        
        // Click event (para click-to-select, funciona en movil y desktop)
        chip.addEventListener('click', handleChipClick);
        
        // Touch events para drag en movil
        chip.addEventListener('touchstart', handleTouchStart, { passive: false });
        chip.addEventListener('touchmove', handleTouchMove, { passive: false });
        chip.addEventListener('touchend', handleTouchEnd, { passive: false });

        poolContainer.appendChild(chip);
    });

    // Drop zones events
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.addEventListener('dragover', handleDragOver);
        zone.addEventListener('dragleave', handleDragLeave);
        zone.addEventListener('drop', handleDrop);
        
        // Click en zona (para click-to-select)
        zone.addEventListener('click', handleZoneClick);
    });

    // Pool as drop target (para devolver chips)
    poolContainer.addEventListener('dragover', handleDragOver);
    poolContainer.addEventListener('drop', handleDropToPool);
    poolContainer.addEventListener('click', handlePoolClick);

    showScreen('matching-screen');
}

// ---------------------------------------------------------
// SISTEMA CLICK-TO-SELECT (nuevo)
// ---------------------------------------------------------

function handleChipClick(e) {
    e.stopPropagation();
    const chip = e.target.closest('.attribute-chip');
    if (!chip) return;
    
    // Si ya esta seleccionado, deseleccionar
    if (selectedChip === chip) {
        deselectChip();
        return;
    }
    
    // Deseleccionar el anterior si habia uno
    deselectChip();
    
    // Seleccionar este chip
    selectedChip = chip;
    chip.classList.add('selected');
}

function handleZoneClick(e) {
    e.stopPropagation();
    const zone = e.target.closest('.drop-zone');
    if (!zone) return;
    
    // Si hay un chip seleccionado, intentar colocarlo
    if (selectedChip) {
        // Verificar que el tipo coincide
        if (zone.dataset.type !== selectedChip.dataset.type) {
            Swal.fire({
                title: 'Tipo incorrecto',
                text: `Esta zona es para ${zone.dataset.type}`,
                icon: 'warning',
                timer: 1500,
                showConfirmButton: false
            });
            return;
        }
        
        // Si ya tiene un chip, devolverlo al pool
        const existingChip = zone.querySelector('.attribute-chip');
        if (existingChip) {
            document.getElementById('attributes-pool').appendChild(existingChip);
        }
        
        // Mover chip a la zona
        zone.appendChild(selectedChip);
        zone.classList.add('filled');
        updateDropZoneText(zone);
        
        // Deseleccionar
        deselectChip();
    } else {
        // Si no hay chip seleccionado pero la zona tiene uno, seleccionarlo
        const chipInZone = zone.querySelector('.attribute-chip');
        if (chipInZone) {
            selectedChip = chipInZone;
            chipInZone.classList.add('selected');
        }
    }
}

function handlePoolClick(e) {
    // Si hacemos click en el pool con un chip seleccionado, devolverlo
    if (selectedChip && e.target.id === 'attributes-pool') {
        // Restaurar zona original si venia de una
        const originalZone = selectedChip.parentElement;
        if (originalZone.classList.contains('drop-zone')) {
            originalZone.classList.remove('filled');
            updateDropZoneText(originalZone);
        }
        document.getElementById('attributes-pool').appendChild(selectedChip);
        deselectChip();
    }
}

function deselectChip() {
    if (selectedChip) {
        selectedChip.classList.remove('selected');
        selectedChip = null;
    }
}

// ---------------------------------------------------------
// SISTEMA TOUCH DRAG (para movil)
// ---------------------------------------------------------

let touchDragElement = null;
let touchClone = null;
let touchStartX = 0;
let touchStartY = 0;
let isTouchDragging = false;

function handleTouchStart(e) {
    const chip = e.target.closest('.attribute-chip');
    if (!chip) return;
    
    touchDragElement = chip;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isTouchDragging = false;
}

function handleTouchMove(e) {
    if (!touchDragElement) return;
    
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);
    
    // Solo iniciar drag si se movio suficiente
    if (!isTouchDragging && (deltaX > 10 || deltaY > 10)) {
        isTouchDragging = true;
        
        // Crear clon visual para el drag
        touchClone = touchDragElement.cloneNode(true);
        touchClone.classList.add('touch-dragging');
        touchClone.style.position = 'fixed';
        touchClone.style.zIndex = '9999';
        touchClone.style.pointerEvents = 'none';
        touchClone.style.opacity = '0.8';
        touchClone.style.transform = 'scale(1.1)';
        document.body.appendChild(touchClone);
        
        touchDragElement.classList.add('dragging');
    }
    
    if (isTouchDragging && touchClone) {
        e.preventDefault();
        touchClone.style.left = (touch.clientX - 50) + 'px';
        touchClone.style.top = (touch.clientY - 20) + 'px';
        
        // Highlight drop zones
        highlightDropZone(touch.clientX, touch.clientY);
    }
}

function handleTouchEnd(e) {
    if (!touchDragElement) return;
    
    if (isTouchDragging) {
        // Encontrar donde soltar
        const touch = e.changedTouches[0];
        const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Limpiar highlights
        document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('over'));
        
        if (dropTarget) {
            const zone = dropTarget.closest('.drop-zone');
            const pool = dropTarget.closest('#attributes-pool');
            
            if (zone) {
                // Intentar soltar en zona
                if (zone.dataset.type === touchDragElement.dataset.type) {
                    const existingChip = zone.querySelector('.attribute-chip');
                    if (existingChip) {
                        document.getElementById('attributes-pool').appendChild(existingChip);
                    }
                    zone.appendChild(touchDragElement);
                    zone.classList.add('filled');
                    updateDropZoneText(zone);
                } else {
                    Swal.fire({
                        title: 'Tipo incorrecto',
                        text: `Esta zona es para ${zone.dataset.type}`,
                        icon: 'warning',
                        timer: 1500,
                        showConfirmButton: false
                    });
                }
            } else if (pool || dropTarget.id === 'attributes-pool') {
                // Devolver al pool
                const originalZone = touchDragElement.parentElement;
                if (originalZone.classList.contains('drop-zone')) {
                    originalZone.classList.remove('filled');
                    updateDropZoneText(originalZone);
                }
                document.getElementById('attributes-pool').appendChild(touchDragElement);
            }
        }
        
        // Limpiar
        if (touchClone) {
            touchClone.remove();
            touchClone = null;
        }
        touchDragElement.classList.remove('dragging');
    }
    
    touchDragElement = null;
    isTouchDragging = false;
}

function highlightDropZone(x, y) {
    document.querySelectorAll('.drop-zone').forEach(zone => {
        const rect = zone.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            if (touchDragElement && zone.dataset.type === touchDragElement.dataset.type) {
                zone.classList.add('over');
            }
        } else {
            zone.classList.remove('over');
        }
    });
}

// ---------------------------------------------------------
// DRAG & DROP CLASICO (desktop)
// ---------------------------------------------------------

function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    
    // Deseleccionar si habia algo seleccionado
    deselectChip();
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedElement = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (e.target.classList.contains('drop-zone')) {
        e.target.classList.add('over');
    }
}

function handleDragLeave(e) {
    if (e.target.classList.contains('drop-zone')) {
        e.target.classList.remove('over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const zone = e.target.closest('.drop-zone');
    if (!zone || !draggedElement) return;

    zone.classList.remove('over');

    // Verificar que el tipo coincide
    if (zone.dataset.type !== draggedElement.dataset.type) {
        Swal.fire({
            title: 'Tipo incorrecto',
            text: `Esta zona es para ${zone.dataset.type}`,
            icon: 'warning',
            timer: 1500,
            showConfirmButton: false
        });
        return;
    }

    // Si ya tiene un chip, devolverlo al pool
    const existingChip = zone.querySelector('.attribute-chip');
    if (existingChip) {
        document.getElementById('attributes-pool').appendChild(existingChip);
    }

    // Mover chip a la zona
    zone.appendChild(draggedElement);
    zone.classList.add('filled');
    updateDropZoneText(zone);
}

function handleDropToPool(e) {
    e.preventDefault();
    if (!draggedElement) return;

    const pool = document.getElementById('attributes-pool');
    if (e.target === pool || pool.contains(e.target)) {
        // Restaurar zona original si venia de una
        const originalZone = draggedElement.parentElement;
        if (originalZone.classList.contains('drop-zone')) {
            originalZone.classList.remove('filled');
            updateDropZoneText(originalZone);
        }
        pool.appendChild(draggedElement);
    }
}

function updateDropZoneText(zone) {
    const chip = zone.querySelector('.attribute-chip');
    const type = zone.dataset.type;
    const labels = { year: 'Ano', authors: 'Autores', journal: 'Journal' };

    if (chip) {
        zone.textContent = '';
        zone.appendChild(chip);
    } else {
        zone.textContent = `${labels[type]}: ?`;
    }
}

async function checkMatching() {
    attempts++;

    let correct = 0;
    let total = currentPapers.length * 3;

    document.querySelectorAll('.drop-zone').forEach(zone => {
        const chip = zone.querySelector('.attribute-chip');
        if (chip && chip.dataset.paperId === zone.dataset.paper) {
            correct++;
        }
    });

    const allFilled = document.querySelectorAll('.drop-zone .attribute-chip').length === total;

    if (!allFilled) {
        Swal.fire('Incompleto', 'Asigna todos los atributos primero.', 'warning');
        return;
    }

    const isWin = correct === total;

    if (isWin) {
        if (isDuel) {
            socket.emit('duel_finish', { gameId: currentDuelId, playerName: currentPlayer, correct: true });
        } else {
            if (attempts === 1) {
                const points = currentPapers.length;
                Swal.fire('PERFECTO!', `Todo correcto a la primera: +${points} puntos`, 'success');
                await saveScore(points, 'matching');
            } else {
                Swal.fire('Correcto!', 'Todo bien, pero sin puntos (no fue al primer intento).', 'info');
            }
            showScreen('menu-screen');
        }
    } else {
        if (isDuel) {
            Swal.fire('Incorrecto!', `${correct}/${total} correctos. Sigue intentando!`, 'error');
        } else {
            if (attempts === 1) {
                const penalty = -(currentPapers.length - 1);
                Swal.fire('Fallaste!', `${correct}/${total} correctos. ${penalty} puntos.`, 'error');
                await saveScore(penalty, 'matching');
            } else {
                Swal.fire('Sigue mal...', `${correct}/${total} correctos.`, 'error');
            }
        }
    }
}

function abandonGame() {
    if (isDuel && currentDuelId) {
        socket.emit('duel_finish', { gameId: currentDuelId, playerName: currentPlayer, correct: false });
    }
    showScreen('menu-screen');
}

// ---------------------------------------------------------
// 5. PUNTUACION
// ---------------------------------------------------------

async function saveScore(points, gameType) {
    try {
        await authenticatedFetch('/api/score', {
            method: 'POST',
            body: JSON.stringify({ points, gameType })
        });
    } catch (e) {
        console.error('Error al guardar puntuación:', e);
    }
}

// ---------------------------------------------------------
// 6. GESTION DE PAPERS
// ---------------------------------------------------------

function resetPaperForm() {
    document.getElementById('form-title').textContent = 'Nuevo Paper';
    document.getElementById('paper-id').value = '';
    document.getElementById('paper-title').value = '';
    document.getElementById('paper-authors').value = '';
    document.getElementById('paper-journal').value = '';
    document.getElementById('paper-year').value = '';
}

async function savePaper() {
    const id = document.getElementById('paper-id').value;
    const title = document.getElementById('paper-title').value;
    const authors = document.getElementById('paper-authors').value;
    const journal = document.getElementById('paper-journal').value;
    const year = document.getElementById('paper-year').value;

    if (!title || !authors || !journal || !year) {
        return Swal.fire('Faltan datos', 'Completa todos los campos', 'warning');
    }

    const url = id ? `/api/paper/${id}` : '/api/paper';
    const method = id ? 'PUT' : 'POST';

    Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });

    try {
        const res = await authenticatedFetch(url, {
            method: method,
            body: JSON.stringify({ title, authors, journal, year })
        });
        const data = await res.json();
        if (data.success || res.ok) {
            Swal.fire('Guardado!', '', 'success');
            if (id) showAdmin();
            else showScreen('menu-screen');
        } else {
            throw new Error('Error al guardar');
        }
    } catch (e) {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
}

// ---------------------------------------------------------
// 7. RANKINGS Y ADMIN
// ---------------------------------------------------------

async function showHallOfFame() {
    const res = await fetch('/api/hof');
    currentHofData = await res.json();
    showScreen('hof-screen');
    switchTab('weekly');
}

function switchTab(type) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('.tab-btn');
    if (type === 'weekly') btns[0].classList.add('active');
    else btns[1].classList.add('active');

    const list = type === 'weekly' ? currentHofData.weekly : currentHofData.total;
    let html = '<ol>';
    list.forEach(p => {
        const pts = type === 'weekly' ? p.stats.weeklyPoints : p.stats.totalPoints;
        html += `<li><strong>${p.name}</strong>: ${pts} pts</li>`;
    });
    html += '</ol>';
    document.getElementById('hof-list').innerHTML = html;
}

async function showAdmin() {
    showScreen('admin-screen');
    try {
        const res = await fetch('/api/papers/all');
        const papers = await res.json();

        document.getElementById('papers-count').textContent = papers.length;

        const list = document.getElementById('admin-papers-list');
        list.innerHTML = '';

        papers.forEach(paper => {
            const div = document.createElement('div');
            div.className = 'admin-item';
            div.innerHTML = `
                <span>${paper.year} - ${paper.title}</span>
                <div class="admin-actions">
                    <button class="btn-yellow small" onclick='editPaper(${JSON.stringify(paper)})'>E</button>
                    <button class="btn-red small" onclick="deletePaper('${paper._id}')">X</button>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        Swal.fire('Error', 'No se pudieron cargar los papers', 'error');
    }
}

function editPaper(paper) {
    showScreen('add-paper-screen');
    document.getElementById('form-title').textContent = 'Editar Paper';
    document.getElementById('paper-id').value = paper._id;
    document.getElementById('paper-title').value = paper.title;
    document.getElementById('paper-authors').value = paper.authors;
    document.getElementById('paper-journal').value = paper.journal;
    document.getElementById('paper-year').value = paper.year;
}

async function deletePaper(id) {
    const confirm = await Swal.fire({ title: 'Borrar este paper?', icon: 'warning', showCancelButton: true });
    if (confirm.isConfirmed) {
        try {
            await authenticatedFetch(`/api/paper/${id}`, { method: 'DELETE' });
            showAdmin();
        } catch (e) {
            Swal.fire('Error', 'No se pudo eliminar el paper', 'error');
        }
    }
}

async function resetWeekly() {
    const confirm = await Swal.fire({ title: 'Reiniciar puntos SEMANALES?', showCancelButton: true });
    if (confirm.isConfirmed) {
        try {
            await authenticatedFetch('/api/admin/reset-weekly', { method: 'POST' });
            Swal.fire('Reiniciado', '', 'success');
        } catch (e) {
            Swal.fire('Error', 'No se pudo reiniciar', 'error');
        }
    }
}

async function resetTotal() {
    const confirm = await Swal.fire({
        title: 'Reiniciar HISTORICO?',
        text: 'Se borraran todos los puntos',
        icon: 'warning',
        showCancelButton: true
    });
    if (confirm.isConfirmed) {
        try {
            await authenticatedFetch('/api/admin/reset-total', { method: 'POST' });
            Swal.fire('Historico a cero', '', 'success');
        } catch (e) {
            Swal.fire('Error', 'No se pudo reiniciar', 'error');
        }
    }
}

// ---------------------------------------------------------
// 8. CAMBIAR CONTRASEÑA
// ---------------------------------------------------------

function showChangePasswordScreen() {
    // Limpiar campos
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    showScreen('change-password-screen');
}

async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return Swal.fire('Error', 'Completa todos los campos', 'warning');
    }

    if (newPassword.length < 6) {
        return Swal.fire('Error', 'La contraseña debe tener al menos 6 caracteres', 'warning');
    }

    if (newPassword !== confirmPassword) {
        return Swal.fire('Error', 'Las contraseñas no coinciden', 'warning');
    }

    Swal.fire({ title: 'Cambiando contraseña...', didOpen: () => Swal.showLoading() });

    try {
        const res = await authenticatedFetch('/api/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();

        if (!res.ok) {
            Swal.fire('Error', data.error || 'No se pudo cambiar la contraseña', 'error');
            return;
        }

        await Swal.fire('¡Listo!', 'Contraseña actualizada correctamente', 'success');
        showScreen('menu-screen');

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Error al cambiar la contraseña', 'error');
    }
}

// ---------------------------------------------------------
// 9. NAVEGACION
// ---------------------------------------------------------

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');

    // Limpiar seleccion al cambiar de pantalla
    deselectChip();
}
