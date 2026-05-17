require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ===== DADOS EM MEMÓRIA =====
let queue = [];
let matches = [];
let nextPlayerId = 1;
let nextMatchId = 1;

// Configuração da API da Riot
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const RIOT_REGION = 'br1';

// Cache para ranks
const rankCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000;

// ===== FUNÇÕES AUXILIARES =====

function tierToMMR(tier, division) {
    const tierValues = {
        'IRON': 400, 'BRONZE': 800, 'SILVER': 1200,
        'GOLD': 1600, 'PLATINUM': 2000, 'DIAMOND': 2400,
        'MASTER': 2800, 'GRANDMASTER': 3200, 'CHALLENGER': 3600,
        'UNRANKED': 800
    };

    const divisionValues = { 'IV': 0, 'III': 100, 'II': 200, 'I': 300 };

    let mmr = tierValues[tier] || 1200;
    if (division && divisionValues[division]) mmr += divisionValues[division];
    return mmr;
}

function formatRiotTier(tier) {
    if (!tier || tier === 'UNRANKED') return 'IRON';
    const validTiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
    return validTiers.includes(tier) ? tier : 'GOLD';
}

// ===== FUNÇÃO PARA ENCONTRAR LOCKFILE DO LOL =====
function findLockfile() {
    const paths = [
        'C:\\Riot Games\\League of Legends\\lockfile',
        'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
        process.env.LOL_LOCKFILE_PATH
    ].filter(Boolean);

    for (const p of paths) {
        if (fs.existsSync(p)) {
            console.log(`✅ Lockfile: ${p}`);
            return p;
        }
    }

    for (const drive of ['C:', 'D:', 'E:']) {
        const p = `${drive}\\Riot Games\\League of Legends\\lockfile`;
        if (fs.existsSync(p)) {
            console.log(`✅ Lockfile: ${p}`);
            return p;
        }
    }

    return null;
}

function getLCUCredentials() {
    const lockfile = findLockfile();
    if (!lockfile) return { port: 2999, password: null };

    try {
        const content = fs.readFileSync(lockfile, 'utf8');
        const parts = content.split(':');
        if (parts.length >= 4) {
            return { port: parseInt(parts[2]), password: parts[3] };
        }
    } catch (e) { }

    return { port: 2999, password: null };
}

// ===== FUNÇÃO PARA FAZER REQUISIÇÕES AO LCU =====
async function lcuRequest(endpoint, method = 'GET', body = null) {
    const { port, password } = getLCUCredentials();
    const auth = password ? Buffer.from(`riot:${password}`).toString('base64') : null;

    const options = {
        method: method,
        url: `https://127.0.0.1:${port}${endpoint}`,
        headers: { 'Accept': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 10000
    };

    if (auth) options.headers['Authorization'] = `Basic ${auth}`;
    if (body) options.data = body;

    try {
        const response = await axios(options);
        return response.data;
    } catch (error) {
        console.error(`❌ Erro na requisição LCU ${endpoint}:`, error.message);
        throw error;
    }
}

// ===== BUSCAR NOME DO INVOCADOR ATUAL =====
async function getCurrentSummoner() {
    const { port, password } = getLCUCredentials();
    console.log(`   🔑 Tentando conectar na porta ${port}`);

    const auth = password ? Buffer.from(`riot:${password}`).toString('base64') : null;

    const options = {
        method: 'GET',
        url: `https://127.0.0.1:${port}/lol-summoner/v1/current-summoner`,
        headers: { 'Accept': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 10000
    };

    if (auth) options.headers['Authorization'] = `Basic ${auth}`;

    try {
        console.log(`   📡 Enviando requisição...`);
        const response = await axios(options);
        console.log(`   ✅ Resposta recebida!`);

        const data = response.data;

        // Tentar diferentes campos onde o nome pode estar
        let playerName = null;

        if (data.gameName && data.gameName.trim()) {
            playerName = data.gameName;
            console.log(`   👤 Nome encontrado em gameName: ${playerName}`);
        } else if (data.displayName && data.displayName.trim()) {
            playerName = data.displayName;
            console.log(`   👤 Nome encontrado em displayName: ${playerName}`);
        } else if (data.name && data.name.trim()) {
            playerName = data.name;
            console.log(`   👤 Nome encontrado em name: ${playerName}`);
        } else if (data.summonerName && data.summonerName.trim()) {
            playerName = data.summonerName;
            console.log(`   👤 Nome encontrado em summonerName: ${playerName}`);
        }

        if (playerName) {
            // Adicionar a tag se disponível (ex: #BR1)
            if (data.tagLine && data.tagLine.trim()) {
                // Alguns jogadores têm tag, mas a API da Riot pode não precisar
                console.log(`   📌 Tag: ${data.tagLine}`);
            }

            return {
                name: playerName,
                summonerId: data.summonerId,
                puuid: data.puuid,
                summonerLevel: data.summonerLevel
            };
        }

        console.log(`   ⚠️ Nenhum campo de nome encontrado. Dados recebidos:`, Object.keys(data));
        return null;

    } catch (error) {
        console.error(`   ❌ Erro: ${error.message}`);
        return null;
    }
}

// ===== BUSCAR MEMBROS DO LOBBY PELO LCU =====
async function getLobbyMembers() {
    try {
        const { port, password } = getLCUCredentials();
        const auth = password ? Buffer.from(`riot:${password}`).toString('base64') : null;

        // Tentar diferentes endpoints que podem conter os membros do lobby
        const endpoints = [
            '/lol-lobby/v2/lobby',
            '/lol-lobby/v2/party',
            '/lol-party/v1/parties/current'
        ];

        for (const endpoint of endpoints) {
            try {
                const options = {
                    method: 'GET',
                    url: `https://127.0.0.1:${port}${endpoint}`,
                    headers: { 'Accept': 'application/json' },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    timeout: 5000
                };
                if (auth) options.headers['Authorization'] = `Basic ${auth}`;

                const response = await axios(options);
                const data = response.data;

                // Verificar se encontrou membros
                let members = null;

                if (data && data.members && Array.isArray(data.members) && data.members.length > 0) {
                    members = data.members;
                    console.log(`   ✅ Encontrou ${members.length} membros via ${endpoint}`);
                    return members;
                } else if (data && data.party && data.party.members && Array.isArray(data.party.members)) {
                    members = data.party.members;
                    console.log(`   ✅ Encontrou ${members.length} membros via ${endpoint}.party.members`);
                    return members;
                } else if (data && data.players && Array.isArray(data.players)) {
                    members = data.players;
                    console.log(`   ✅ Encontrou ${members.length} membros via ${endpoint}.players`);
                    return members;
                }
            } catch (e) {
                // Tentar próximo endpoint
            }
        }

        return [];
    } catch (error) {
        console.error('❌ Erro ao buscar membros do lobby:', error.message);
        return [];
    }
}

// ===== OBTER NOME DO INVOCADOR PELO ID =====
async function getSummonerNameById(summonerId) {
    if (!summonerId) return null;

    try {
        const data = await lcuRequest(`/lol-summoner/v1/summoners/${summonerId}`);
        if (data && data.displayName) {
            return data.displayName;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// ===== BUSCAR RANK NA API DA RIOT =====
async function fetchSummonerRank(summonerName) {
    if (!summonerName || summonerName.trim() === '') {
        return { tier: 'UNRANKED', rank: '', lp: 0, wins: 0, losses: 0, summonerName: 'Unknown' };
    }

    const cleanName = summonerName.trim();

    // Verificar cache
    const cached = rankCache.get(cleanName);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`   📦 Cache: ${cleanName} -> ${cached.tier}`);
        return cached;
    }

    try {
        console.log(`   🔍 Buscando na API Riot: "${cleanName}"...`);

        const summonerUrl = `https://${RIOT_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(cleanName)}`;
        const summonerRes = await axios.get(summonerUrl, {
            headers: { 'X-Riot-Token': RIOT_API_KEY }
        });

        const rankUrl = `https://${RIOT_REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerRes.data.id}`;
        const rankRes = await axios.get(rankUrl, {
            headers: { 'X-Riot-Token': RIOT_API_KEY }
        });

        const soloRank = rankRes.data.find(entry => entry.queueType === 'RANKED_SOLO_5x5');

        const rankData = soloRank ? {
            tier: soloRank.tier,
            rank: soloRank.rank,
            lp: soloRank.leaguePoints,
            wins: soloRank.wins,
            losses: soloRank.losses,
            summonerName: summonerRes.data.name
        } : {
            tier: 'UNRANKED', rank: '', lp: 0, wins: 0, losses: 0,
            summonerName: summonerRes.data.name
        };

        rankCache.set(cleanName, { ...rankData, timestamp: Date.now() });
        console.log(`   ✅ ${rankData.summonerName} -> ${rankData.tier} ${rankData.rank}`);

        return rankData;

    } catch (error) {
        if (error.response?.status === 404) {
            console.log(`   ❌ "${cleanName}" não encontrado na API Riot`);
        } else if (error.response?.status === 403) {
            console.log(`   ⚠️ API Key inválida!`);
        }
        return { tier: 'UNRANKED', rank: '', lp: 0, wins: 0, losses: 0, summonerName: cleanName };
    }
}

// ===== FUNÇÃO PRINCIPAL: IMPORTAR DO SAGUÃO =====
async function getLobbyMembersWithRanks() {
    console.log(`🔍 Conectando ao LCU...`);

    // Primeiro, obter o invocador atual (você)
    const currentSummoner = await getCurrentSummoner();

    if (!currentSummoner) {
        throw new Error('Não foi possível obter seu invocador. Certifique-se de que o LoL está aberto.');
    }

    console.log(`\n👤 Invocador atual: ${currentSummoner.name} (Nível ${currentSummoner.summonerLevel})`);

    // Tentar buscar membros do lobby
    let members = await getLobbyMembers();

    // Se não encontrou membros, usar apenas o invocador atual
    if (members.length === 0) {
        console.log(`\n📋 Nenhum membro encontrado no lobby. Adicionando apenas você.`);
        const rankData = await fetchSummonerRank(currentSummoner.name);
        return [{
            gameName: rankData.summonerName || currentSummoner.name,
            rank: formatRiotTier(rankData.tier),
            rankDivision: rankData.rank || 'IV',
            lp: rankData.lp || 0,
            mmr: tierToMMR(rankData.tier, rankData.rank),
            tier: rankData.tier
        }];
    }

    console.log(`\n📋 ${members.length} membro(s) encontrado(s) no lobby`);

    // Processar cada membro para obter o nome
    const playersInfo = [];

    for (const member of members) {
        let playerName = null;

        if (typeof member === 'object') {
            // Tentar extrair nome dos diferentes campos possíveis
            playerName = member.summonerName || member.gameName || member.name || member.displayName;

            // Se não encontrou nome, tentar buscar pelo summonerId
            if (!playerName && member.summonerId) {
                try {
                    const summonerData = await getSummonerById(member.summonerId);
                    if (summonerData) {
                        playerName = summonerData.gameName || summonerData.displayName;
                    }
                } catch (e) { }
            }
        }

        if (playerName && playerName.trim() && playerName.length > 2) {
            console.log(`   📝 Jogador: ${playerName}`);
            playersInfo.push({ name: playerName.trim() });
        }
    }

    // Se não conseguiu extrair nomes dos membros, usar apenas o invocador atual
    if (playersInfo.length === 0) {
        console.log(`\n⚠️ Não foi possível extrair nomes dos membros. Usando apenas seu invocador.`);
        const rankData = await fetchSummonerRank(currentSummoner.name);
        return [{
            gameName: rankData.summonerName || currentSummoner.name,
            rank: formatRiotTier(rankData.tier),
            rankDivision: rankData.rank || 'IV',
            lp: rankData.lp || 0,
            mmr: tierToMMR(rankData.tier, rankData.rank),
            tier: rankData.tier
        }];
    }

    // Remover duplicatas (incluindo o invocador atual se estiver na lista)
    const uniquePlayers = [];
    const seenNames = new Set();

    for (const player of playersInfo) {
        if (!seenNames.has(player.name.toLowerCase())) {
            seenNames.add(player.name.toLowerCase());
            uniquePlayers.push(player);
        }
    }

    console.log(`\n🔍 Buscando ranks na API da Riot...\n`);

    const results = [];

    for (const player of uniquePlayers) {
        console.log(`   📡 Buscando rank de: "${player.name}"...`);
        const rankData = await fetchSummonerRank(player.name);

        results.push({
            gameName: rankData.summonerName || player.name,
            rank: formatRiotTier(rankData.tier),
            rankDivision: rankData.rank || 'IV',
            lp: rankData.lp || 0,
            mmr: tierToMMR(rankData.tier, rankData.rank),
            tier: rankData.tier
        });

        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n✅ Importação concluída! ${results.length} jogador(es).\n`);
    return results;
}

// Função auxiliar para buscar summoner por ID
async function getSummonerById(summonerId) {
    const { port, password } = getLCUCredentials();
    const auth = password ? Buffer.from(`riot:${password}`).toString('base64') : null;

    const options = {
        method: 'GET',
        url: `https://127.0.0.1:${port}/lol-summoner/v1/summoners/${summonerId}`,
        headers: { 'Accept': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 5000
    };
    if (auth) options.headers['Authorization'] = `Basic ${auth}`;

    try {
        const response = await axios(options);
        return response.data;
    } catch (error) {
        return null;
    }
}

// ===== ROTAS DA API =====

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor funcionando!' });
});

// Rota principal de importação
app.get('/api/lcu/lobby-members', async (req, res) => {
    console.log('\n📡 ===== IMPORTANDO SAGUÃO =====');

    if (!RIOT_API_KEY || RIOT_API_KEY === 'SUA_CHAVE_AQUI') {
        return res.status(500).json({
            success: false,
            error: 'API Key da Riot não configurada. Crie o arquivo .env com RIOT_API_KEY=sua_chave'
        });
    }

    try {
        const members = await getLobbyMembersWithRanks();
        res.json({ success: true, members, count: members.length });
    } catch (error) {
        console.error('❌ Erro:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rota de debug para ver informações do invocador atual
app.get('/api/lcu/me', async (req, res) => {
    try {
        const data = await getCurrentSummoner();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Adicionar jogador
app.post('/api/players/add', (req, res) => {
    const { summonerName, rank, rankDivision, mmr } = req.body;

    if (!summonerName) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    if (queue.some(p => p.name.toLowerCase() === summonerName.toLowerCase())) {
        return res.status(400).json({ error: 'Jogador já está na fila' });
    }

    const playerRank = rank || 'GOLD';
    const playerDivision = rankDivision || 'I';
    const playerMmr = mmr || tierToMMR(playerRank, playerDivision);

    const player = {
        id: nextPlayerId++,
        name: summonerName,
        rank: playerRank,
        rankDivision: playerDivision,
        lp: 0,
        mmr: playerMmr,
        joinedAt: new Date().toISOString()
    };

    queue.push(player);
    console.log(`➕ Adicionado: ${summonerName} - ${playerRank} ${playerDivision} (${playerMmr} MMR)`);

    res.json({ success: true, player });
});

// Buscar fila
app.get('/api/players/queue', (req, res) => {
    res.json(queue);
});

// Remover jogador
app.delete('/api/players/remove/:playerId', (req, res) => {
    const playerId = parseInt(req.params.playerId);
    const index = queue.findIndex(p => p.id === playerId);

    if (index !== -1) {
        queue.splice(index, 1);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Jogador não encontrado' });
    }
});

// Limpar fila
app.delete('/api/players/clear-queue', (req, res) => {
    queue = [];
    res.json({ success: true });
});

// Balancear times (agora aceita qualquer número de jogadores)
app.post('/api/players/balance', (req, res) => {
    if (queue.length < 2) {
        return res.status(400).json({
            error: `São necessários pelo menos 2 jogadores para formar times. Atualmente: ${queue.length}`
        });
    }

    // Ordenar por MMR (do maior para o menor)
    const sorted = [...queue].sort((a, b) => b.mmr - a.mmr);

    const blue = [];
    const red = [];

    // Distribuição serpentina balanceada para qualquer número
    sorted.forEach((player, index) => {
        // Estratégia: distribuir alternadamente, mas com vantagem para o time mais fraco
        if (index % 2 === 0) {
            blue.push(player);
        } else {
            red.push(player);
        }
    });

    // Calcular MMRs totais
    const blueTotalMMR = blue.reduce((sum, p) => sum + p.mmr, 0);
    const redTotalMMR = red.reduce((sum, p) => sum + p.mmr, 0);

    // Salvar partida no histórico
    const match = {
        id: nextMatchId++,
        blueTeam: blue,
        redTeam: red,
        blueTotalMMR,
        redTotalMMR,
        totalPlayers: queue.length,
        playedAt: new Date().toISOString()
    };
    matches.push(match);

    // Limpar fila
    const playersInMatch = [...queue];
    queue = [];

    res.json({
        success: true,
        matchId: match.id,
        blue,
        red,
        blueTotalMMR,
        redTotalMMR,
        totalPlayers: playersInMatch.length
    });
});

// Enviar para Discord
app.post('/api/send-to-discord', async (req, res) => {
    const { webhookUrl, blueTeam, redTeam, matchNumber } = req.body;

    if (!webhookUrl) return res.status(400).json({ error: 'Webhook URL é obrigatório' });
    if (!blueTeam?.length || !redTeam?.length) return res.status(400).json({ error: 'Times não formados' });

    try {
        const blueTotalMMR = blueTeam.reduce((s, p) => s + (p.mmr || 0), 0);
        const redTotalMMR = redTeam.reduce((s, p) => s + (p.mmr || 0), 0);

        const embed = {
            title: `🏆 INHOUSE PARTIDA #${matchNumber}`,
            color: 0x0099ff,
            timestamp: new Date().toISOString(),
            fields: [
                { name: `🔵 TIME AZUL (${blueTotalMMR} MMR)`, value: blueTeam.map(p => `• ${p.name} - ${p.rank} ${p.rankDivision}`).join('\n'), inline: true },
                { name: `🔴 TIME VERMELHO (${redTotalMMR} MMR)`, value: redTeam.map(p => `• ${p.name} - ${p.rank} ${p.rankDivision}`).join('\n'), inline: true }
            ]
        };

        await axios.post(webhookUrl, { content: '🎮 Nova partida!', embeds: [embed], username: 'Inhouse Queue' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estatísticas
app.get('/api/players/stats', (req, res) => {
    const uniquePlayers = new Set();
    matches.forEach(m => [...m.blueTeam, ...m.redTeam].forEach(p => uniquePlayers.add(p.name)));

    let totalMMR = 0, count = 0;
    matches.forEach(m => [...m.blueTeam, ...m.redTeam].forEach(p => { totalMMR += p.mmr; count++; }));

    res.json({
        totalMatches: matches.length,
        uniquePlayers: uniquePlayers.size,
        averageMMR: count > 0 ? Math.round(totalMMR / count) : 1200
    });
});

app.post('/api/players/reset-stats', (req, res) => {
    matches = [];
    queue = [];
    res.json({ success: true });
});

// Rota de teste para debug do LCU
app.get('/api/lcu/test', async (req, res) => {
    const { port, password } = getLCUCredentials();

    console.log(`Testando LCU na porta: ${port}`);
    console.log(`Password encontrada: ${password ? 'Sim' : 'Não'}`);

    const auth = password ? Buffer.from(`riot:${password}`).toString('base64') : null;

    const endpoints = [
        '/lol-summoner/v1/current-summoner',
        '/lol-lobby/v2/lobby',
        '/lol-game-queues/v1/queues'
    ];

    const results = {};

    for (const endpoint of endpoints) {
        try {
            const options = {
                method: 'GET',
                url: `https://127.0.0.1:${port}${endpoint}`,
                headers: { 'Accept': 'application/json' },
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 5000
            };
            if (auth) options.headers['Authorization'] = `Basic ${auth}`;

            const response = await axios(options);
            results[endpoint] = { success: true, data: response.data };
            console.log(`✅ ${endpoint} funcionou!`);
        } catch (error) {
            results[endpoint] = { success: false, error: error.message };
            console.log(`❌ ${endpoint} falhou: ${error.message}`);
        }
    }

    res.json(results);
});

// Frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Iniciar
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor: http://localhost:${PORT}`);
    console.log(`📡 API Key: ${RIOT_API_KEY && RIOT_API_KEY !== 'SUA_CHAVE_AQUI' ? '✅ Configurada' : '❌ Não configurada'}`);

    if (!RIOT_API_KEY || RIOT_API_KEY === 'SUA_CHAVE_AQUI') {
        console.log(`\n⚠️ Para usar a importação, crie o arquivo .env com:`);
        console.log(`   RIOT_API_KEY=sua_chave_aqui`);
        console.log(`   Obtenha uma em: https://developer.riotgames.com/\n`);
    }
});