// Configuração da API
const API_URL = 'http://localhost:3000/api';

// Elementos do DOM
const playerNameInput = document.getElementById('playerName');
const playerRankSelect = document.getElementById('playerRank');
const addBtn = document.getElementById('addBtn');
const lcuImportBtn = document.getElementById('lcuImportBtn');
const queueCountSpan = document.getElementById('queueCount');
const queueListDiv = document.getElementById('queueList');
const blueTeamListDiv = document.getElementById('blueTeamList');
const redTeamListDiv = document.getElementById('redTeamList');
const startMatchBtn = document.getElementById('startMatchBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const sendToDiscordBtn = document.getElementById('sendToDiscordBtn');
const configWebhookBtn = document.getElementById('configWebhookBtn');
const exportDiscordBtn = document.getElementById('exportDiscordBtn');
const copyCommandBtn = document.getElementById('copyCommandBtn');
const statsBtn = document.getElementById('statsBtn');
const resetStatsBtn = document.getElementById('resetStatsBtn');

// Elementos do Modal
const statsModal = document.getElementById('statsModal');
const closeModalBtn = document.querySelector('.close-btn');

// Variáveis
let discordWebhookUrl = '';

// ===== FUNÇÕES DE MODAL =====

function openStatsModal() {
    if (statsModal) {
        statsModal.style.display = 'flex';
        loadStats(); // Carregar estatísticas ao abrir
    }
}

function closeStatsModal() {
    if (statsModal) {
        statsModal.style.display = 'none';
    }
}

// Fechar modal ao clicar fora
window.addEventListener('click', (e) => {
    if (e.target === statsModal) {
        closeStatsModal();
    }
});

// ===== FUNÇÕES DE CONEXÃO =====

async function checkConnection() {
    try {
        const response = await fetch('http://localhost:3000/api/health');
        const data = await response.json();
        console.log('✅ Conectado ao backend:', data);
        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar:', error);
        alert('Não foi possível conectar ao servidor. Verifique se o backend está rodando em http://localhost:3000');
        return false;
    }
}

// ===== FUNÇÕES DA FILA =====

async function loadQueue() {
    try {
        const response = await fetch(`${API_URL}/players/queue`);
        if (!response.ok) throw new Error('Erro ao carregar fila');
        const queue = await response.json();
        renderQueue(queue);
    } catch (error) {
        console.error('Erro ao carregar fila:', error);
        if (queueListDiv) {
            queueListDiv.innerHTML = '<div class="empty-message" style="color: #ff6666;">❌ Erro ao conectar com o servidor</div>';
        }
    }
}

async function addToQueue() {
    const summonerName = playerNameInput.value.trim();
    const rank = playerRankSelect ? playerRankSelect.value : 'GOLD';

    if (summonerName === "") {
        alert("Por favor, insira o nome do invocador.");
        return;
    }

    addBtn.disabled = true;
    addBtn.textContent = '⏳ Adicionando...';

    try {
        const response = await fetch(`${API_URL}/players/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summonerName, rank })
        });

        const data = await response.json();

        if (response.ok) {
            playerNameInput.value = '';
            loadQueue();
        } else {
            alert(`Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao adicionar:', error);
        alert('Erro ao conectar com o servidor');
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = '➕ Adicionar à Fila';
    }
}

async function addPlayerManually(name, rank, rankDivision, mmr) {
    try {
        const queueResponse = await fetch(`${API_URL}/players/queue`);
        const currentQueue = await queueResponse.json();

        if (currentQueue.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            console.log(`⚠️ ${name} já está na fila, ignorando...`);
            return false;
        }

        const response = await fetch(`${API_URL}/players/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summonerName: name,
                rank: rank,
                rankDivision: rankDivision,
                mmr: mmr
            })
        });

        if (response.ok) {
            console.log(`✅ ${name} (${rank} ${rankDivision}) adicionado!`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Erro ao adicionar ${name}:`, error);
        return false;
    }
}

async function importFromLobby() {
    console.log("🔄 Importando do saguão do LoL...");

    if (!lcuImportBtn) return;

    const originalText = lcuImportBtn.innerText;
    lcuImportBtn.disabled = true;
    lcuImportBtn.innerText = '⏳ Buscando jogadores...';

    try {
        const response = await fetch(`${API_URL}/lcu/lobby-members`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if (data.members && data.members.length > 0) {
                lcuImportBtn.innerText = '⏳ Importando ranks...';

                let successCount = 0;

                for (const member of data.members) {
                    const added = await addPlayerManually(
                        member.gameName,
                        member.rank,
                        member.rankDivision,
                        member.mmr
                    );
                    if (added) successCount++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                alert(`🎉 Importação concluída!\n\n${successCount} de ${data.members.length} jogadores adicionados à fila.`);
                loadQueue();
            } else {
                alert("ℹ️ Nenhum jogador encontrado no saguão.");
            }
        } else {
            alert(`❌ Erro ao importar: ${data.error || 'Cliente do LoL não encontrado'}`);
        }
    } catch (error) {
        console.error('Erro ao importar do saguão:', error);
        alert('❌ Erro ao conectar com o servidor backend.');
    } finally {
        lcuImportBtn.disabled = false;
        lcuImportBtn.innerText = originalText;
    }
}

async function removeFromQueue(playerId) {
    try {
        const response = await fetch(`${API_URL}/players/remove/${playerId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            loadQueue();
        }
    } catch (error) {
        console.error('Erro ao remover:', error);
        alert('Erro ao conectar com o servidor');
    }
}

async function clearQueue() {
    if (confirm("Tem certeza? Isso removerá TODOS os jogadores da fila.")) {
        try {
            const response = await fetch(`${API_URL}/players/clear-queue`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadQueue();
                clearTeamsDisplay();
            }
        } catch (error) {
            console.error('Erro ao limpar fila:', error);
            alert('Erro ao conectar com o servidor');
        }
    }
}

// ===== FUNÇÕES DE PARTIDA =====

async function startMatch() {
    console.log('Iniciando partida...');

    try {
        const queueResponse = await fetch(`${API_URL}/players/queue`);
        const queue = await queueResponse.json();

        if (queue.length < 2) {
            alert(`São necessários pelo menos 2 jogadores para formar times. Atualmente: ${queue.length}`);
            return;
        }

        if (queue.length % 2 !== 0) {
            const confirmar = confirm(`⚠️ Você tem ${queue.length} jogadores (número ímpar).\n\nOs times ficarão com números diferentes de jogadores.\n\nDeseja continuar mesmo assim?`);
            if (!confirmar) return;
        }

    } catch (error) {
        console.error('Erro ao verificar fila:', error);
    }

    try {
        const response = await fetch(`${API_URL}/players/balance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();
        console.log('Resposta do servidor:', data);

        if (response.ok) {
            displayTeams(data.blue, data.red);

            const diff = Math.abs(data.blueTotalMMR - data.redTotalMMR);
            const blueSize = data.blue.length;
            const redSize = data.red.length;

            alert(`✅ Partida criada!\n\n` +
                `🔵 Time Azul: ${blueSize} jogadores (MMR: ${data.blueTotalMMR})\n` +
                `🔴 Time Vermelho: ${redSize} jogadores (MMR: ${data.redTotalMMR})\n` +
                `📊 Diferença de MMR: ${diff} pontos`);

            loadStats();
            loadQueue();
        } else {
            alert(`Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao iniciar partida:', error);
        alert(`Erro ao conectar com o servidor: ${error.message}`);
    }
}

function displayTeams(blueTeam, redTeam) {
    if (!blueTeamListDiv || !redTeamListDiv) return;

    blueTeamListDiv.innerHTML = '';
    redTeamListDiv.innerHTML = '';

    if (!blueTeam || blueTeam.length === 0) {
        blueTeamListDiv.innerHTML = '<div class="empty-message">Time Azul vazio</div>';
    } else {
        blueTeam.forEach(player => {
            const card = document.createElement('div');
            card.classList.add('player-card');
            card.style.borderLeftColor = "#7aa2f7";
            card.style.margin = "8px";
            card.style.padding = "10px";
            card.style.background = "#0f121c";
            card.style.borderRadius = "8px";
            card.innerHTML = `
                <span>${getRankIcon(player.rank)} <strong>${player.name}</strong></span>
                <div>
                    <span class="rank-badge rank-${player.rank}">${formatRank(player.rank)} ${player.rankDivision || ''}</span>
                    <span class="mmr-badge">MMR: ${player.mmr}</span>
                </div>
            `;
            blueTeamListDiv.appendChild(card);
        });
    }

    if (!redTeam || redTeam.length === 0) {
        redTeamListDiv.innerHTML = '<div class="empty-message">Time Vermelho vazio</div>';
    } else {
        redTeam.forEach(player => {
            const card = document.createElement('div');
            card.classList.add('player-card');
            card.style.borderLeftColor = "#f77a7a";
            card.style.margin = "8px";
            card.style.padding = "10px";
            card.style.background = "#0f121c";
            card.style.borderRadius = "8px";
            card.innerHTML = `
                <span>${getRankIcon(player.rank)} <strong>${player.name}</strong></span>
                <div>
                    <span class="rank-badge rank-${player.rank}">${formatRank(player.rank)} ${player.rankDivision || ''}</span>
                    <span class="mmr-badge">MMR: ${player.mmr}</span>
                </div>
            `;
            redTeamListDiv.appendChild(card);
        });
    }

    const blueTotalMMR = blueTeam ? blueTeam.reduce((sum, p) => sum + (p.mmr || 0), 0) : 0;
    const redTotalMMR = redTeam ? redTeam.reduce((sum, p) => sum + (p.mmr || 0), 0) : 0;
    const blueSize = blueTeam ? blueTeam.length : 0;
    const redSize = redTeam ? redTeam.length : 0;

    const blueTitle = document.querySelector('.team.blue h2');
    const redTitle = document.querySelector('.team.red h2');

    if (blueTitle) blueTitle.innerHTML = `🔵 TIME AZUL (${blueSize} jog. | MMR: ${blueTotalMMR})`;
    if (redTitle) redTitle.innerHTML = `🔴 TIME VERMELHO (${redSize} jog. | MMR: ${redTotalMMR})`;
}

function clearTeamsDisplay() {
    if (blueTeamListDiv) {
        blueTeamListDiv.innerHTML = '<div class="empty-message">Aguardando formação</div>';
    }
    if (redTeamListDiv) {
        redTeamListDiv.innerHTML = '<div class="empty-message">Aguardando formação</div>';
    }
}

// ===== FUNÇÕES DE RENDERIZAÇÃO =====

function renderQueue(queue) {
    if (!queueCountSpan) return;

    queueCountSpan.innerText = queue.length;

    if (queue.length === 0) {
        if (queueListDiv) {
            queueListDiv.innerHTML = '<div class="empty-message">Nenhum jogador na fila. Adicione acima!</div>';
        }
        if (startMatchBtn) startMatchBtn.disabled = true;
        return;
    }

    if (startMatchBtn) startMatchBtn.disabled = (queue.length < 2);

    if (!queueListDiv) return;

    queueListDiv.innerHTML = '';
    queue.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.classList.add('player-card');

        const rankIcon = getRankIcon(player.rank);
        const rankName = formatRank(player.rank);

        playerCard.innerHTML = `
            <span>
                ${rankIcon} ${player.name}
                <small style="color: #888;">(MMR: ${player.mmr})</small>
            </span>
            <div>
                <span class="rank-badge rank-${player.rank}">${rankName} ${player.rankDivision || ''}</span>
                <button class="remove-player" data-id="${player.id}">❌ Remover</button>
            </div>
        `;

        queueListDiv.appendChild(playerCard);
    });

    document.querySelectorAll('.remove-player').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const playerId = btn.getAttribute('data-id');
            removeFromQueue(playerId);
        });
    });
}

// ===== FUNÇÕES AUXILIARES =====

function getRankIcon(rank) {
    const icons = {
        'IRON': '🥉', 'BRONZE': '🥉', 'SILVER': '⚪',
        'GOLD': '🟡', 'PLATINUM': '🔵', 'DIAMOND': '💎',
        'MASTER': '🌟', 'GRANDMASTER': '👑', 'CHALLENGER': '🏆',
        'UNRANKED': '❓'
    };
    return icons[rank] || '⭐';
}

function formatRank(rank) {
    const rankNames = {
        'IRON': 'Ferro', 'BRONZE': 'Bronze', 'SILVER': 'Prata',
        'GOLD': 'Ouro', 'PLATINUM': 'Platina', 'DIAMOND': 'Diamante',
        'MASTER': 'Mestre', 'GRANDMASTER': 'Grão-Mestre', 'CHALLENGER': 'Desafiante',
        'UNRANKED': 'Sem Rank'
    };
    return rankNames[rank] || rank;
}

// ===== ESTATÍSTICAS =====

async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/players/stats`);
        const stats = await response.json();

        const totalMatchesEl = document.getElementById('totalMatches');
        const uniquePlayersEl = document.getElementById('uniquePlayers');
        const averageRankEl = document.getElementById('averageRank');

        if (totalMatchesEl) totalMatchesEl.innerText = stats.totalMatches;
        if (uniquePlayersEl) uniquePlayersEl.innerText = stats.uniquePlayers;
        if (averageRankEl) averageRankEl.innerHTML = `🏆 MMR Médio: ${stats.averageMMR}`;
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

async function resetStats() {
    if (confirm("Tem certeza? Isso apagará TODAS as estatísticas permanentemente!")) {
        try {
            const response = await fetch(`${API_URL}/players/reset-stats`, {
                method: 'POST'
            });

            if (response.ok) {
                alert("Estatísticas resetadas com sucesso!");
                loadStats();
                clearTeamsDisplay();
            }
        } catch (error) {
            console.error('Erro ao resetar estatísticas:', error);
        }
    }
}

// ===== DISCORD WEBHOOK =====

function saveWebhookUrl() {
    const url = prompt(
        '🔗 Cole a URL do Webhook do Discord:\n\n' +
        '1. Vá em Integrações > Webhooks no seu servidor\n' +
        '2. Crie um novo webhook\n' +
        '3. Copie a URL e cole aqui\n\n' +
        '⚠️ Mantenha essa URL em segredo!'
    );

    if (url && url.startsWith('https://discord.com/api/webhooks/')) {
        discordWebhookUrl = url;
        localStorage.setItem('discord_webhook_url', url);
        alert('✅ Webhook salvo com sucesso!');
    } else if (url) {
        alert('❌ URL inválida! Certifique-se de copiar a URL completa do webhook.');
    }
}

async function sendToDiscord() {
    const savedUrl = localStorage.getItem('discord_webhook_url');
    if (savedUrl) {
        discordWebhookUrl = savedUrl;
    }

    if (!discordWebhookUrl) {
        const shouldSetup = confirm(
            '⚠️ Você ainda não configurou um Webhook do Discord!\n\n' +
            'Deseja configurar agora?'
        );
        if (shouldSetup) {
            saveWebhookUrl();
            if (!discordWebhookUrl) return;
        } else {
            return;
        }
    }

    const bluePlayers = [];
    const redPlayers = [];

    document.querySelectorAll('#blueTeamList .player-card').forEach(card => {
        const nameElement = card.querySelector('span:first-child');
        const rankElement = card.querySelector('.rank-badge');
        const mmrElement = card.querySelector('.mmr-badge');

        let name = nameElement?.innerText || '';
        name = name.replace(/[🥉⚪🟡🔵💎🌟👑🏆❓]/g, '').trim();

        bluePlayers.push({
            name: name,
            rank: rankElement?.innerText?.split(' ')[0] || 'N/A',
            rankDivision: rankElement?.innerText?.split(' ')[1] || '',
            mmr: parseInt(mmrElement?.innerText?.replace('MMR: ', '') || '0')
        });
    });

    document.querySelectorAll('#redTeamList .player-card').forEach(card => {
        const nameElement = card.querySelector('span:first-child');
        const rankElement = card.querySelector('.rank-badge');
        const mmrElement = card.querySelector('.mmr-badge');

        let name = nameElement?.innerText || '';
        name = name.replace(/[🥉⚪🟡🔵💎🌟👑🏆❓]/g, '').trim();

        redPlayers.push({
            name: name,
            rank: rankElement?.innerText?.split(' ')[0] || 'N/A',
            rankDivision: rankElement?.innerText?.split(' ')[1] || '',
            mmr: parseInt(mmrElement?.innerText?.replace('MMR: ', '') || '0')
        });
    });

    if (bluePlayers.length === 0 || redPlayers.length === 0) {
        alert('⚠️ Forme os times primeiro antes de enviar ao Discord!');
        return;
    }

    const totalMatches = parseInt(document.getElementById('totalMatches')?.innerText || '0');
    const matchNumber = totalMatches + 1;

    if (sendToDiscordBtn) {
        sendToDiscordBtn.disabled = true;
        sendToDiscordBtn.innerText = '⏳ Enviando...';
    }

    try {
        const response = await fetch(`${API_URL}/send-to-discord`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                webhookUrl: discordWebhookUrl,
                blueTeam: bluePlayers,
                redTeam: redPlayers,
                matchNumber: matchNumber
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert('✅ Partida enviada ao Discord com sucesso!');
        } else {
            alert(`❌ Erro: ${data.error}`);
        }
    } catch (error) {
        console.error('Erro ao enviar:', error);
        alert('❌ Erro ao conectar com o servidor');
    } finally {
        if (sendToDiscordBtn) {
            sendToDiscordBtn.disabled = false;
            sendToDiscordBtn.innerText = '💬 Enviar Partida ao Discord';
        }
    }
}

// ===== EXPORTAÇÃO MANUAL =====

function exportToDiscord() {
    if (!blueTeamListDiv || !redTeamListDiv) return;

    const bluePlayers = Array.from(blueTeamListDiv.querySelectorAll('.player-card')).map(card => {
        const text = card.querySelector('span:first-child')?.innerText || '';
        return text.replace(/[🥉⚪🟡🔵💎🌟👑🏆❓]/g, '').trim();
    });

    const redPlayers = Array.from(redTeamListDiv.querySelectorAll('.player-card')).map(card => {
        const text = card.querySelector('span:first-child')?.innerText || '';
        return text.replace(/[🥉⚪🟡🔵💎🌟👑🏆❓]/g, '').trim();
    });

    if (bluePlayers.length === 0 || redPlayers.length === 0) {
        alert("Forme os times primeiro antes de exportar!");
        return;
    }

    const totalMatches = document.getElementById('totalMatches')?.innerText || '0';
    const blueTotalMMR = Array.from(blueTeamListDiv.querySelectorAll('.mmr-badge')).reduce((sum, el) => {
        return sum + parseInt(el.innerText.replace('MMR: ', '') || 0);
    }, 0);
    const redTotalMMR = Array.from(redTeamListDiv.querySelectorAll('.mmr-badge')).reduce((sum, el) => {
        return sum + parseInt(el.innerText.replace('MMR: ', '') || 0);
    }, 0);

    const discordMessage = `**🏆 INHOUSE PARTIDA #${parseInt(totalMatches)}**\n\n` +
        `**🔵 TIME AZUL (MMR Total: ${blueTotalMMR})**\n${bluePlayers.map(n => `- ${n}`).join('\n')}\n\n` +
        `**🔴 TIME VERMELHO (MMR Total: ${redTotalMMR})**\n${redPlayers.map(n => `- ${n}`).join('\n')}\n\n` +
        `**📊 Como participar:**\n` +
        `1. Entre no lobby customizado\n` +
        `2. Vá para seu respectivo time\n` +
        `3. Boa sorte e divirta-se! 🎮`;

    const discordExport = document.getElementById('discordExport');
    const discordCommand = document.getElementById('discordCommand');

    if (discordCommand) discordCommand.innerText = discordMessage;
    if (discordExport) discordExport.style.display = 'block';
}

function copyToClipboard() {
    const command = document.getElementById('discordCommand')?.innerText;
    if (command) {
        navigator.clipboard.writeText(command).then(() => {
            alert("Comando copiado! Cole no Discord.");
        });
    }
}

// ===== EVENT LISTENERS =====

if (addBtn) addBtn.addEventListener('click', addToQueue);
if (clearQueueBtn) clearQueueBtn.addEventListener('click', clearQueue);
if (startMatchBtn) startMatchBtn.addEventListener('click', startMatch);
if (lcuImportBtn) lcuImportBtn.addEventListener('click', importFromLobby);
if (exportDiscordBtn) exportDiscordBtn.addEventListener('click', exportToDiscord);
if (copyCommandBtn) copyCommandBtn.addEventListener('click', copyToClipboard);
if (resetStatsBtn) resetStatsBtn.addEventListener('click', resetStats);
if (statsBtn) statsBtn.addEventListener('click', openStatsModal);
if (closeModalBtn) closeModalBtn.addEventListener('click', closeStatsModal);
if (sendToDiscordBtn) sendToDiscordBtn.addEventListener('click', sendToDiscord);
if (configWebhookBtn) configWebhookBtn.addEventListener('click', saveWebhookUrl);

if (playerNameInput) {
    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addToQueue();
    });
}

const savedWebhookUrl = localStorage.getItem('discord_webhook_url');
if (savedWebhookUrl) {
    discordWebhookUrl = savedWebhookUrl;
    console.log('✅ Webhook URL carregada do localStorage');
}

// ===== INICIALIZAÇÃO =====

async function init() {
    const connected = await checkConnection();
    if (connected) {
        loadQueue();
        loadStats();
    }
    clearTeamsDisplay();
}

init();