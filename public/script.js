const socket = io();

// --- CONFIGURACION ---
const GAME_PASSWORD = 'bertismael';

// VARIABLES GLOBALES
let currentPlayer = null;
let currentPapers = [];
let currentHofData = null;
let attempts = 0;
let isDuel = false;
let currentDuelId = null;
let currentGameType = null;

// AL CARGAR LA PAGINA
document.addEventListener('DOMContentLoaded', () => {
    loadPlayers();
});

// ---------------------------------------------------------
// 1. GESTION DE USUARIOS (LOGIN)
// ---------------------------------------------------------

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
    }
}

function login() {
    const name = document.getElementById('player-select').value;
    const pass = document.getElementById('password-input').value;

    if (!name) {
        Swal.fire('Error', 'Debes seleccionar un nombre', 'warning');
        return;
    }

    if (pass !== GAME_PASSWORD) {
        Swal.fire('Error', 'Contrasena incorrecta', 'error');
        return;
    }

    currentPlayer = name;
    document.getElementById('welcome-msg').textContent = `Hola, ${currentPlayer}`;
    showScreen('menu-screen');
}

// ---------------------------------------------------------
// 2. LOGICA DEL MULTIJUGADOR (SOCKETS)
// ---------------------------------------------------------

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
        const res = await fetch(`/api/game?count=${count}`);
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

    // SortableJS
    if (window.sortableInstance) window.sortableInstance.destroy();
    window.sortableInstance = new Sortable(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        touchStartThreshold: 5
    });

    showScreen('timeline-screen');
}

async function checkTimeline() {
    attempts++;
    const container = document.getElementById('timeline-container');
    const playerOrderIds = Array.from(container.children).map(c => c.dataset.id);

    // Orden correcto por ano
    const correctOrder = [...currentPapers].sort((a, b) => a.year - b.year);
    const correctIds = correctOrder.map(p => p._id);

    const isWin = JSON.stringify(playerOrderIds) === JSON.stringify(correctIds);

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

// ---------------------------------------------------------
// 4. JUEGO MATCHING
// ---------------------------------------------------------

let draggedElement = null;

function renderMatching(titleText) {
    document.getElementById('matching-title').textContent = titleText;

    const papersContainer = document.getElementById('papers-list');
    const poolContainer = document.getElementById('attributes-pool');
    papersContainer.innerHTML = '';
    poolContainer.innerHTML = '';

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

        // Drag events
        chip.addEventListener('dragstart', handleDragStart);
        chip.addEventListener('dragend', handleDragEnd);

        poolContainer.appendChild(chip);
    });

    // Drop zones events
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.addEventListener('dragover', handleDragOver);
        zone.addEventListener('dragleave', handleDragLeave);
        zone.addEventListener('drop', handleDrop);
    });

    // Pool as drop target (para devolver chips)
    poolContainer.addEventListener('dragover', handleDragOver);
    poolContainer.addEventListener('drop', handleDropToPool);

    showScreen('matching-screen');
}

function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
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
    await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: currentPlayer, points, gameType })
    });
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
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, authors, journal, year, addedBy: currentPlayer })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire('Guardado!', '', 'success');
            if (id) showAdmin();
            else showScreen('menu-screen');
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
        await fetch(`/api/paper/${id}`, { method: 'DELETE' });
        showAdmin();
    }
}

async function resetWeekly() {
    const confirm = await Swal.fire({ title: 'Reiniciar puntos SEMANALES?', showCancelButton: true });
    if (confirm.isConfirmed) {
        await fetch('/api/admin/reset-weekly', { method: 'POST' });
        Swal.fire('Reiniciado', '', 'success');
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
        await fetch('/api/admin/reset-total', { method: 'POST' });
        Swal.fire('Historico a cero', '', 'success');
    }
}

// ---------------------------------------------------------
// 8. NAVEGACION
// ---------------------------------------------------------

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}
